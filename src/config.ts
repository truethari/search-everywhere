import * as vscode from 'vscode';

// Centralized access to the extension's settings (contributes.configuration in
// package.json) with sensible defaults, plus exclude-glob construction that can
// honor the user's files.exclude / search.exclude.

const SECTION = 'searchEverywhere';

const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/.next/**'
];

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export interface ResultLimits {
  file: number;
  symbol: number;
  text: number;
}

export function getLimits(): ResultLimits {
  const c = cfg();
  return {
    file: c.get<number>('maxFileResults', 30),
    symbol: c.get<number>('maxSymbolResults', 30),
    text: c.get<number>('maxTextResults', 20)
  };
}

export function getDebounce(): { primary: number; text: number } {
  const c = cfg();
  return {
    primary: c.get<number>('primaryDebounce', 300),
    text: c.get<number>('textDebounce', 500)
  };
}

export function getTextMinQuery(): number {
  return cfg().get<number>('textMinQueryLength', 3);
}

/** Upper bound on files scanned by file and text search. */
export function getFileCandidateCap(): number {
  return cfg().get<number>('maxFileCandidates', 5000);
}

export function getRecentCount(): number {
  return cfg().get<number>('recentFilesCount', 10);
}

/**
 * Build a single exclude glob combining our defaults, any user-supplied
 * additional excludes, and (optionally) the enabled keys from the user's
 * files.exclude / search.exclude settings.
 */
export function buildExcludeGlob(): string {
  const c = cfg();
  const globs = new Set<string>(DEFAULT_EXCLUDES);

  for (const extra of c.get<string[]>('additionalExcludes', [])) {
    if (extra) {
      globs.add(extra);
    }
  }

  if (c.get<boolean>('respectEditorExcludes', true)) {
    const filesExclude = vscode.workspace
      .getConfiguration('files')
      .get<Record<string, boolean>>('exclude', {});
    const searchExclude = vscode.workspace
      .getConfiguration('search')
      .get<Record<string, boolean>>('exclude', {});
    for (const [pattern, enabled] of Object.entries({
      ...filesExclude,
      ...searchExclude
    })) {
      if (enabled) {
        globs.add(pattern);
      }
    }
  }

  const list = [...globs];
  return list.length > 0 ? `{${list.join(',')}}` : '';
}
