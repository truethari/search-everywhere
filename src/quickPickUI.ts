import * as vscode from 'vscode';
import { SearchProvider, SearchFilter } from './searchProvider';
import {
  SearchResult,
  rankAndMerge,
  CATEGORY_SEPARATORS,
  ResultCategory
} from './resultRanker';
import { getDebounce, getLimits } from './config';
import { RecencyStore } from './recency';

const PLACEHOLDER =
  'Search files, symbols, and text… (@ symbols, # text, :line)';

/** A QuickPick item that may carry an underlying search result. */
interface ResultItem extends vscode.QuickPickItem {
  result?: SearchResult;
}

/** Definition of one filter tab button. */
interface FilterButton extends vscode.QuickInputButton {
  filter: SearchFilter;
}

const FILTER_LABELS: Record<SearchFilter, string> = {
  all: 'All',
  files: 'Files',
  symbols: 'Symbols',
  text: 'Text'
};

/** Inline button shown on each result to open it in a split editor. */
const OPEN_SIDE_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('split-horizontal'),
  tooltip: 'Open to the Side'
};

/** Parsed query: either a goto-line directive or a scoped search term. */
type ParsedQuery =
  { line: number } | { scopeOverride?: SearchFilter; term: string };

function parseQuery(raw: string): ParsedQuery {
  const t = raw.trim();
  const lineMatch = /^:(\d+)$/.exec(t);
  if (lineMatch) {
    return { line: parseInt(lineMatch[1], 10) };
  }
  if (t.startsWith('@')) {
    return { scopeOverride: 'symbols', term: t.slice(1).trim() };
  }
  if (t.startsWith('#')) {
    return { scopeOverride: 'text', term: t.slice(1).trim() };
  }
  return { term: t };
}

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

/**
 * Owns the QuickPick experience: filter tabs, query prefixes, debounced search
 * across the three sources, busy state, ranked rendering with separators, and
 * opening the chosen result (optionally to the side).
 */
export class QuickPickUI {
  private readonly provider = new SearchProvider();
  private quickPick: vscode.QuickPick<ResultItem> | undefined;

  private filter: SearchFilter = 'all';
  private primaryTimer: NodeJS.Timeout | undefined;
  private textTimer: NodeJS.Timeout | undefined;

  private files: SearchResult[] = [];
  private symbols: SearchResult[] = [];
  private text: SearchResult[] = [];
  private currentQuery = '';

  private pendingPrimary = false;
  private pendingText = false;

  private readonly buttons: FilterButton[] = [
    {
      filter: 'all',
      iconPath: new vscode.ThemeIcon('list-selection'),
      tooltip: 'All'
    },
    {
      filter: 'files',
      iconPath: new vscode.ThemeIcon('files'),
      tooltip: 'Files'
    },
    {
      filter: 'symbols',
      iconPath: new vscode.ThemeIcon('symbol-class'),
      tooltip: 'Symbols'
    },
    {
      filter: 'text',
      iconPath: new vscode.ThemeIcon('search'),
      tooltip: 'Text'
    }
  ];

  constructor(private readonly recency: RecencyStore) {}

  /** Open the Search Everywhere QuickPick. */
  open(): void {
    if (
      !vscode.workspace.workspaceFolders ||
      vscode.workspace.workspaceFolders.length === 0
    ) {
      vscode.window.showInformationMessage('No workspace folder open');
      return;
    }

    // Reset per-session state.
    this.filter = 'all';
    this.files = [];
    this.symbols = [];
    this.text = [];
    this.currentQuery = '';

    const qp = vscode.window.createQuickPick<ResultItem>();
    this.quickPick = qp;
    qp.placeholder = PLACEHOLDER;
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;
    qp.buttons = this.buttons;
    this.updateTitle();

    qp.onDidChangeValue((value) => this.onValueChange(value));
    qp.onDidTriggerButton((button) =>
      this.onTriggerButton(button as FilterButton)
    );
    qp.onDidTriggerItemButton((e) => this.onTriggerItemButton(e));
    qp.onDidAccept(() => this.onAccept());
    qp.onDidHide(() => this.dispose());

    qp.show();

    // Seed with the empty-query fallback (recent / fallback files).
    this.onValueChange('');
  }

  private updateTitle(): void {
    if (this.quickPick) {
      this.quickPick.title = `Search Everywhere — ${FILTER_LABELS[this.filter]}`;
    }
  }

  private onTriggerButton(button: FilterButton): void {
    if (!button || !button.filter || button.filter === this.filter) {
      return;
    }
    this.filter = button.filter;
    this.updateTitle();
    // Re-run for the current query so newly-in-scope sources get fetched.
    this.onValueChange(this.quickPick?.value ?? '');
  }

  private onValueChange(rawValue: string): void {
    const parsed = parseQuery(rawValue);
    if ('line' in parsed) {
      this.renderGotoLine(parsed.line);
      return;
    }

    const query = parsed.term;
    const scope: SearchFilter = parsed.scopeOverride ?? this.filter;
    this.currentQuery = query;

    this.clearTimers();
    // Start a fresh cancellable generation; cancels any in-flight search.
    const token = this.provider.newSearch();

    // Reset results for the new query.
    this.files = [];
    this.symbols = [];
    this.text = [];

    if (query.length === 0) {
      this.pendingPrimary = true;
      this.pendingText = false;
      this.updateBusy();
      this.provider.fallbackFiles(this.recency.list(), token).then((files) => {
        if (token.isCancellationRequested) {
          return;
        }
        this.files = files;
        this.pendingPrimary = false;
        this.render();
        this.updateBusy();
      });
      return;
    }

    const wantText = scope === 'all' || scope === 'text';
    this.pendingPrimary = true;
    this.pendingText = wantText;
    this.updateBusy();

    const { primary, text } = getDebounce();

    this.primaryTimer = setTimeout(() => {
      this.provider.primary(query, scope, token).then((res) => {
        if (token.isCancellationRequested) {
          return;
        }
        this.files = res.files;
        this.symbols = res.symbols;
        this.pendingPrimary = false;
        this.render();
        this.updateBusy();
      });
    }, primary);

    if (wantText) {
      this.textTimer = setTimeout(() => {
        this.provider.text(query, scope, token).then((res) => {
          if (token.isCancellationRequested) {
            return;
          }
          this.text = res;
          this.pendingText = false;
          this.render();
          this.updateBusy();
        });
      }, text);
    }
  }

  /** Render a single "Go to line N" entry for the active editor. */
  private renderGotoLine(line: number): void {
    this.clearTimers();
    this.provider.cancel();
    this.pendingPrimary = false;
    this.pendingText = false;
    this.updateBusy();

    if (!this.quickPick) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.quickPick.items = [];
      return;
    }

    const max = Math.max(editor.document.lineCount, 1);
    const target = Math.min(Math.max(line, 1), max);
    const uri = editor.document.uri;
    const result: SearchResult = {
      category: 'file',
      label: `Go to line ${target}`,
      description: '$(go-to-file) Line',
      detail: `${relativePath(uri)}:${target}`,
      iconId: 'go-to-file',
      uri,
      position: new vscode.Position(target - 1, 0),
      score: 0
    };

    this.quickPick.items = [
      {
        label: result.label,
        description: result.description,
        detail: result.detail,
        iconPath: new vscode.ThemeIcon(result.iconId),
        alwaysShow: true,
        result
      }
    ];
  }

  private render(): void {
    if (!this.quickPick) {
      return;
    }

    const { map, count } = this.recency.ranks();
    const merged = rankAndMerge(
      [this.files, this.symbols, this.text],
      this.currentQuery,
      {
        limits: getLimits(),
        recent: map,
        recentCount: count
      }
    );

    const items: ResultItem[] = [];
    let lastCategory: ResultCategory | undefined;

    for (const result of merged) {
      if (result.category !== lastCategory) {
        items.push({
          label: CATEGORY_SEPARATORS[result.category],
          kind: vscode.QuickPickItemKind.Separator
        });
        lastCategory = result.category;
      }

      const item: ResultItem = {
        label: result.label,
        description: result.description,
        detail: result.detail,
        alwaysShow: true,
        buttons: [OPEN_SIDE_BUTTON],
        result
      };
      // Use the real file-type icon for files; codicon for symbols/text.
      if (result.category === 'file') {
        item.resourceUri = result.uri;
      } else {
        item.iconPath = new vscode.ThemeIcon(result.iconId);
      }
      items.push(item);
    }

    this.quickPick.items = items;
  }

  private updateBusy(): void {
    if (this.quickPick) {
      this.quickPick.busy = this.pendingPrimary || this.pendingText;
    }
  }

  private onAccept(): void {
    const result = this.quickPick?.selectedItems[0]?.result;
    if (!result) {
      return;
    }
    this.quickPick?.hide();
    void this.openResult(result, false);
  }

  private onTriggerItemButton(
    e: vscode.QuickPickItemButtonEvent<ResultItem>
  ): void {
    const result = e.item.result;
    if (!result) {
      return;
    }
    this.quickPick?.hide();
    void this.openResult(result, true);
  }

  /** Open a result, optionally in a split to the side, and reveal its position. */
  private async openResult(
    result: SearchResult,
    toSide: boolean
  ): Promise<void> {
    this.recency.record(result.uri);
    try {
      const doc = await vscode.workspace.openTextDocument(result.uri);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: toSide ? vscode.ViewColumn.Beside : undefined,
        preserveFocus: false
      });

      if (result.position) {
        const pos = result.position;
        const range = new vscode.Range(pos, pos);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Search Everywhere: could not open ${result.uri.fsPath}`
      );
      console.error('[search-everywhere] open failed:', err);
    }
  }

  private clearTimers(): void {
    if (this.primaryTimer) {
      clearTimeout(this.primaryTimer);
      this.primaryTimer = undefined;
    }
    if (this.textTimer) {
      clearTimeout(this.textTimer);
      this.textTimer = undefined;
    }
  }

  dispose(): void {
    this.clearTimers();
    this.provider.cancel();
    const qp = this.quickPick;
    this.quickPick = undefined;
    qp?.dispose();
  }
}
