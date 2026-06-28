// Lightweight fuzzy (subsequence) matcher used to rank file and symbol results.
// Returns a score where higher is better; null means the query is not a
// subsequence of the target at all.

const SEP_RE = /[\/\\_\-. ]/;

// Scoring weights — tuned so word-boundary and consecutive matches dominate.
const BOUNDARY_BONUS = 16; // match at start or right after a separator
const CAMEL_BONUS = 14; // match at a camelHump boundary (aB)
const CONSECUTIVE_BONUS = 8; // match immediately after the previous match
const IN_WORD_BONUS = 1; // match in the middle of a word
const GAP_PENALTY = 0.5; // per skipped char between matches (capped)
const EXACT_BONUS = 50; // whole target equals the query
const PREFIX_BONUS = 20; // target starts with the query
const LEN_WEIGHT = 10; // tie-break: shorter targets score slightly higher

/** Cheap boolean check: is `query` a (case-insensitive) subsequence of `text`? */
export function isSubsequence(query: string, text: string): boolean {
  if (!query) {
    return true;
  }
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    ti = t.indexOf(q[qi], ti);
    if (ti === -1) {
      return false;
    }
    ti++;
  }
  return true;
}

/**
 * Score how well `query` matches `text`. Higher is better; returns null when
 * `query` is not a subsequence of `text`.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  if (q.length === 0) {
    // Empty query matches everything equally; favor shorter targets a touch.
    return text.length > 0 ? LEN_WEIGHT / text.length : 0;
  }

  // Greedy left-to-right subsequence with position tracking.
  const positions: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) {
      return null;
    }
    positions.push(idx);
    ti = idx + 1;
  }

  let score = 0;
  let prev = -2;
  for (let k = 0; k < positions.length; k++) {
    const pos = positions[k];

    let bonus: number;
    if (pos === 0) {
      bonus = BOUNDARY_BONUS;
    } else {
      const before = text[pos - 1];
      const here = text[pos];
      if (SEP_RE.test(before)) {
        bonus = BOUNDARY_BONUS;
      } else if (/[a-z]/.test(before) && /[A-Z]/.test(here)) {
        bonus = CAMEL_BONUS;
      } else {
        bonus = IN_WORD_BONUS;
      }
    }

    if (pos === prev + 1) {
      bonus += CONSECUTIVE_BONUS;
    } else if (k > 0) {
      const gap = pos - prev - 1;
      score -= Math.min(gap, 6) * GAP_PENALTY;
    }

    score += bonus;
    prev = pos;
  }

  if (t === q) {
    score += EXACT_BONUS;
  } else if (t.startsWith(q)) {
    score += PREFIX_BONUS;
  }

  score += LEN_WEIGHT / text.length;
  return score;
}
