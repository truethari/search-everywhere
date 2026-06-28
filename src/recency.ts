import * as vscode from 'vscode';

/** How many recently-opened entries to remember. */
const MAX_RECENT = 50;
const STORAGE_KEY = 'omnisearch.recent';

/**
 * Tracks files opened through OmniSearch (most-recent-first), persisted
 * per workspace. Used both to seed the empty-query view and to boost ranking.
 */
export class RecencyStore {
  constructor(private readonly memento: vscode.Memento) {}

  /** Recently opened URIs as strings, most recent first. */
  list(): string[] {
    return this.memento.get<string[]>(STORAGE_KEY, []);
  }

  /** Record an opened URI, moving it to the front. */
  record(uri: vscode.Uri): void {
    const key = uri.toString();
    const next = [key, ...this.list().filter((u) => u !== key)].slice(
      0,
      MAX_RECENT
    );
    void this.memento.update(STORAGE_KEY, next);
  }

  /** A map of uri -> recency rank (0 = most recent) plus the total count. */
  ranks(): { map: Map<string, number>; count: number } {
    const list = this.list();
    const map = new Map<string, number>();
    list.forEach((u, i) => map.set(u, i));
    return { map, count: list.length };
  }
}
