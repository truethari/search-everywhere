import * as vscode from 'vscode';
import { SearchResult } from './resultRanker';
import { searchFiles, listFallbackFiles } from './fileSearch';
import { searchSymbols } from './symbolSearch';
import { searchText } from './textSearch';

/** Which category scope the UI is currently filtered to. */
export type SearchFilter = 'all' | 'files' | 'symbols' | 'text';

/** Number of fallback files shown for an empty query. */
const EMPTY_QUERY_FILE_COUNT = 10;

/** Files + symbols results for one query (the "primary", faster sources). */
export interface PrimaryResults {
  files: SearchResult[];
  symbols: SearchResult[];
}

/**
 * Run one search source, isolating failures so a single rejected/throwing
 * source never empties the merged result list.
 */
async function runSource(
  name: string,
  fn: () => Promise<SearchResult[]>
): Promise<SearchResult[]> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[search-everywhere] ${name} search failed:`, err);
    return [];
  }
}

/**
 * Orchestrates the three search sources. Owns a single CancellationTokenSource
 * per query so both the primary (files/symbols) and the slower text search can
 * be cancelled together the moment the query changes.
 */
export class SearchProvider {
  private cts: vscode.CancellationTokenSource | undefined;

  /** Start a new query: cancel the previous one and hand back a fresh token. */
  newSearch(): vscode.CancellationToken {
    this.cancel();
    this.cts = new vscode.CancellationTokenSource();
    return this.cts.token;
  }

  cancel(): void {
    this.cts?.cancel();
    this.cts?.dispose();
    this.cts = undefined;
  }

  dispose(): void {
    this.cancel();
  }

  /** Files shown when the query is empty (recently opened, then fallback). */
  fallbackFiles(token: vscode.CancellationToken): Promise<SearchResult[]> {
    return runSource('fallback', () =>
      listFallbackFiles(EMPTY_QUERY_FILE_COUNT, token)
    );
  }

  /** The faster sources: files and symbols, each fault-isolated. */
  async primary(
    query: string,
    filter: SearchFilter,
    token: vscode.CancellationToken
  ): Promise<PrimaryResults> {
    const wantFiles = filter === 'all' || filter === 'files';
    const wantSymbols = filter === 'all' || filter === 'symbols';

    const [files, symbols] = await Promise.all([
      wantFiles ? runSource('file', () => searchFiles(query, token)) : [],
      wantSymbols ? runSource('symbol', () => searchSymbols(query, token)) : []
    ]);

    return { files, symbols };
  }

  /** The slower source: full-text search, run on a longer debounce. */
  text(
    query: string,
    filter: SearchFilter,
    token: vscode.CancellationToken
  ): Promise<SearchResult[]> {
    const want = filter === 'all' || filter === 'text';
    if (!want) {
      return Promise.resolve([]);
    }
    return runSource('text', () => searchText(query, token));
  }
}
