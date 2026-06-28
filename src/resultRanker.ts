import * as vscode from 'vscode';

/** The category a result belongs to. Drives ordering and the section separators. */
export type ResultCategory = 'file' | 'symbol' | 'text';

/** A single normalized search result flowing from sources -> ranker -> UI. */
export interface SearchResult {
  category: ResultCategory;
  /** Primary text: filename / symbol name / matched line snippet. */
  label: string;
  /** Category chip text shown on the right, e.g. "File". */
  description: string;
  /** Secondary line: relative path + line number where applicable. */
  detail: string;
  /** ThemeIcon id, e.g. 'file', 'symbol-class', 'search'. */
  iconId: string;
  /** Target document. */
  uri: vscode.Uri;
  /** Optional cursor target for symbols / text matches. */
  position?: vscode.Position;
  /** Similarity score assigned by the ranker; higher is better. */
  score: number;
}

/** Scoring weights so the ordering intent is readable. */
const SCORE_EXACT = 1000;
const SCORE_PREFIX = 500;
const SCORE_CONTAINS = 200;
const SCORE_NONE = 0;

/** Category ordering: files first, then symbols, then text. */
const CATEGORY_ORDER: Record<ResultCategory, number> = {
  file: 0,
  symbol: 1,
  text: 2
};

/** Human-readable section headers used for separator rows in the UI. */
export const CATEGORY_SEPARATORS: Record<ResultCategory, string> = {
  file: '— Files —',
  symbol: '— Symbols —',
  text: '— Text Matches —'
};

/**
 * Compute a string-similarity score of `label` against `query`.
 * exact match > starts-with > contains > none. Case-insensitive.
 */
export function scoreMatch(label: string, query: string): number {
  if (!query) {
    return SCORE_NONE;
  }
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l === q) {
    return SCORE_EXACT;
  }
  if (l.startsWith(q)) {
    return SCORE_PREFIX;
  }
  if (l.includes(q)) {
    return SCORE_CONTAINS;
  }
  return SCORE_NONE;
}

/**
 * Assign a score to a result based on its label vs the query.
 * Shorter labels win ties (a small fractional bonus), so tighter matches float up.
 */
export function applyScore(result: SearchResult, query: string): SearchResult {
  const base = scoreMatch(result.label, query);
  const lengthBonus = result.label.length > 0 ? 1 / result.label.length : 0;
  result.score = base + lengthBonus;
  return result;
}

/**
 * Merge results from all sources into one list ordered by category
 * (files, symbols, text) and, within each category, by descending score.
 */
export function rankAndMerge(
  groups: SearchResult[][],
  query: string
): SearchResult[] {
  const all = groups.flat().map((r) => applyScore(r, query));

  all.sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (catDiff !== 0) {
      return catDiff;
    }
    return b.score - a.score;
  });

  return all;
}
