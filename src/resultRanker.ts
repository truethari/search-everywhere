import * as vscode from 'vscode';
import { fuzzyScore } from './fuzzyMatch';
import { ResultLimits } from './config';

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
  /** ThemeIcon id, e.g. 'symbol-class', 'search'. Ignored for file items. */
  iconId: string;
  /** Target document. */
  uri: vscode.Uri;
  /** Optional cursor target for symbols / text matches. */
  position?: vscode.Position;
  /** Similarity score assigned by the ranker; higher is better. */
  score: number;
}

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

/** Max contribution of recency to a result's score. */
const RECENCY_WEIGHT = 12;

export interface RankOptions {
  limits: ResultLimits;
  /** uri.toString() -> recency rank (0 = most recent). */
  recent: Map<string, number>;
  recentCount: number;
}

/** Recency contribution: most-recent gets the full weight, tapering to 0. */
function recencyBonus(result: SearchResult, opts: RankOptions): number {
  if (opts.recentCount === 0) {
    return 0;
  }
  const rank = opts.recent.get(result.uri.toString());
  if (rank === undefined) {
    return 0;
  }
  return RECENCY_WEIGHT * (1 - rank / opts.recentCount);
}

/**
 * Score one result against the query. Files and symbols are fuzzy-matched on
 * their name (and, for files, their path) and dropped when there is no match.
 * Text matches already matched literally upstream, so they are kept as-is.
 * Returns null when the result should be filtered out.
 */
function scoreResult(
  result: SearchResult,
  query: string,
  opts: RankOptions
): number | null {
  let base: number;

  if (result.category === 'text') {
    base = 0;
  } else {
    const nameScore = fuzzyScore(query, result.label);
    const pathScore = result.detail ? fuzzyScore(query, result.detail) : null;
    if (nameScore === null && pathScore === null) {
      return null;
    }
    // Prefer name matches; discount path-only matches.
    base = Math.max(
      nameScore ?? -Infinity,
      pathScore === null ? -Infinity : pathScore * 0.6
    );
  }

  return base + recencyBonus(result, opts);
}

/**
 * Merge results from all sources into one list ordered by category
 * (files, symbols, text), fuzzy-scored and capped per category.
 */
export function rankAndMerge(
  groups: SearchResult[][],
  query: string,
  opts: RankOptions
): SearchResult[] {
  const limitFor = (c: ResultCategory): number =>
    c === 'file'
      ? opts.limits.file
      : c === 'symbol'
        ? opts.limits.symbol
        : opts.limits.text;

  const out: SearchResult[] = [];

  for (const group of groups) {
    const scored: SearchResult[] = [];
    for (const result of group) {
      const score = scoreResult(result, query, opts);
      if (score === null) {
        continue;
      }
      result.score = score;
      scored.push(result);
    }
    scored.sort((a, b) => b.score - a.score);
    const category = scored[0]?.category;
    out.push(...(category ? scored.slice(0, limitFor(category)) : scored));
  }

  // Stable category ordering across groups.
  out.sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return catDiff !== 0 ? catDiff : b.score - a.score;
  });

  return out;
}
