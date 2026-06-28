import * as vscode from 'vscode';
import { SearchResult } from './resultRanker';

/** Globs excluded from file search. */
const EXCLUDE_GLOB =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.next/**}';

/** Max file results returned. */
const FILE_LIMIT = 30;

/** Build a relative, forward-slashed path for display. */
function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Find files whose name or relative path matches the query.
 * Uses workspace.findFiles with a fuzzy substring glob; final filtering and
 * scoring against the filename happen in the caller's ranker.
 */
export async function searchFiles(
  query: string,
  token: vscode.CancellationToken
): Promise<SearchResult[]> {
  if (!query) {
    return [];
  }

  // A permissive glob: match the query anywhere in the path, case-insensitively
  // by letting findFiles do the heavy lifting and refining below.
  const includeGlob = `**/*${query}*`;
  const uris = await vscode.workspace.findFiles(
    includeGlob,
    EXCLUDE_GLOB,
    FILE_LIMIT * 3,
    token
  );

  if (token.isCancellationRequested) {
    return [];
  }

  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const uri of uris) {
    const rel = relativePath(uri);
    const name = basename(rel);
    // Keep matches against either the filename or the full relative path.
    if (!name.toLowerCase().includes(q) && !rel.toLowerCase().includes(q)) {
      continue;
    }
    results.push({
      category: 'file',
      label: name,
      description: '$(file) File',
      detail: rel,
      iconId: 'file',
      uri,
      score: 0
    });
  }

  return results.slice(0, FILE_LIMIT);
}

/**
 * Return up to `limit` files for the empty-query case (recently opened, with a
 * plain file listing as fallback).
 */
export async function listFallbackFiles(
  limit: number,
  token: vscode.CancellationToken
): Promise<SearchResult[]> {
  // Try the recently-opened list first.
  try {
    const recent: any = await vscode.commands.executeCommand(
      'vscode.getRecentlyOpenedInWorkspace'
    );
    const entries: any[] = recent?.workspaces ?? recent?.files ?? [];
    const fromRecent: SearchResult[] = [];
    for (const entry of entries) {
      const uri: vscode.Uri | undefined =
        entry?.folderUri ?? entry?.fileUri ?? entry?.uri;
      if (!uri) {
        continue;
      }
      const rel = relativePath(uri);
      fromRecent.push({
        category: 'file',
        label: basename(rel),
        description: '$(history) Recent',
        detail: rel,
        iconId: 'history',
        uri,
        score: 0
      });
      if (fromRecent.length >= limit) {
        break;
      }
    }
    if (fromRecent.length > 0) {
      return fromRecent;
    }
  } catch {
    // Command may be unavailable; fall through to a plain listing.
  }

  // Fallback: a plain file list from the workspace.
  const uris = await vscode.workspace.findFiles(
    '**/*',
    EXCLUDE_GLOB,
    limit,
    token
  );
  return uris.map((uri) => {
    const rel = relativePath(uri);
    return {
      category: 'file' as const,
      label: basename(rel),
      description: '$(file) File',
      detail: rel,
      iconId: 'file',
      uri,
      score: 0
    };
  });
}
