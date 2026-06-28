import * as vscode from 'vscode';
import { SearchResult } from './resultRanker';
import { isSubsequence } from './fuzzyMatch';
import { buildExcludeGlob, getFileCandidateCap } from './config';

/** Upper bound on file results handed to the ranker (which caps further). */
const FILE_CANDIDATE_RESULTS = 300;

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** Build a file SearchResult; icon is rendered from the real file type by the UI. */
export function makeFileResult(uri: vscode.Uri, recent = false): SearchResult {
  const rel = relativePath(uri);
  return {
    category: 'file',
    label: basename(rel),
    description: recent ? '$(history) Recent' : '$(file) File',
    detail: rel,
    iconId: 'file',
    uri,
    score: 0
  };
}

/**
 * Find files whose name or relative path fuzzily matches the query. Fetches a
 * broad candidate set and filters by subsequence so queries like `sft` match
 * `searchFileText.ts`; final scoring/cap happens in the ranker.
 */
export async function searchFiles(
  query: string,
  token: vscode.CancellationToken
): Promise<SearchResult[]> {
  if (!query) {
    return [];
  }

  const uris = await vscode.workspace.findFiles(
    '**/*',
    buildExcludeGlob(),
    getFileCandidateCap(),
    token
  );
  if (token.isCancellationRequested) {
    return [];
  }

  const results: SearchResult[] = [];
  for (const uri of uris) {
    if (results.length >= FILE_CANDIDATE_RESULTS) {
      break;
    }
    const rel = relativePath(uri);
    const name = basename(rel);
    if (isSubsequence(query, name) || isSubsequence(query, rel)) {
      results.push(makeFileResult(uri));
    }
  }
  return results;
}

/**
 * Files shown for an empty query: the extension's own recently-opened files
 * first (still on disk), then filled out with a plain workspace listing.
 */
export async function listFallbackFiles(
  recent: string[],
  limit: number,
  token: vscode.CancellationToken
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const raw of recent) {
    if (results.length >= limit) {
      break;
    }
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(raw);
      await vscode.workspace.fs.stat(uri); // skip entries that no longer exist
    } catch {
      continue;
    }
    seen.add(uri.toString());
    results.push(makeFileResult(uri, true));
  }

  if (results.length < limit && !token.isCancellationRequested) {
    const uris = await vscode.workspace.findFiles(
      '**/*',
      buildExcludeGlob(),
      limit * 3,
      token
    );
    for (const uri of uris) {
      if (results.length >= limit) {
        break;
      }
      if (seen.has(uri.toString())) {
        continue;
      }
      results.push(makeFileResult(uri));
    }
  }

  return results;
}
