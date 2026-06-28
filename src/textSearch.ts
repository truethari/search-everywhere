import * as vscode from 'vscode';
import { SearchResult } from './resultRanker';
import {
  buildExcludeGlob,
  getFileCandidateCap,
  getLimits,
  getTextMinQuery
} from './config';

/** Cap on matches taken from a single file, so one file can't flood results. */
const MAX_PER_FILE = 5;

/** Skip files larger than this (bytes) — likely generated or binary. */
const MAX_FILE_SIZE = 1_000_000;

const decoder = new TextDecoder('utf-8', { fatal: false });

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

/**
 * Full-text search across the workspace.
 *
 * VS Code has no stable API that returns text-search results programmatically
 * (`findTextInFiles` is proposed and unavailable to installed extensions), so
 * we enumerate candidate files with `findFiles` and scan their contents
 * ourselves, bounded by caps and the cancellation token.
 */
export async function searchText(
  query: string,
  token: vscode.CancellationToken
): Promise<SearchResult[]> {
  if (query.length < getTextMinQuery()) {
    return [];
  }

  const textLimit = getLimits().text;
  const uris = await vscode.workspace.findFiles(
    '**/*',
    buildExcludeGlob(),
    getFileCandidateCap(),
    token
  );
  if (token.isCancellationRequested) {
    return [];
  }

  const needle = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const uri of uris) {
    if (token.isCancellationRequested || results.length >= textLimit) {
      break;
    }

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      continue; // unreadable / deleted — skip
    }

    if (bytes.byteLength > MAX_FILE_SIZE || isBinary(bytes)) {
      continue;
    }

    const text = decoder.decode(bytes);
    const lines = text.split(/\r?\n/);
    const rel = relativePath(uri);
    let perFile = 0;

    for (let i = 0; i < lines.length; i++) {
      if (results.length >= textLimit || perFile >= MAX_PER_FILE) {
        break;
      }
      const line = lines[i];
      const col = line.toLowerCase().indexOf(needle);
      if (col === -1) {
        continue;
      }
      const preview = line.trim();
      results.push({
        category: 'text',
        label: preview.length > 0 ? preview : query,
        description: '$(search) Text Match',
        detail: `${rel}:${i + 1}`,
        iconId: 'search',
        uri,
        position: new vscode.Position(i, col),
        score: 0
      });
      perFile++;
    }
  }

  return results;
}

/** Heuristic: treat content with a NUL byte in the first chunk as binary. */
function isBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength, 8000);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) {
      return true;
    }
  }
  return false;
}
