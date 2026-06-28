import * as vscode from 'vscode';
import { SearchProvider, SearchFilter } from './searchProvider';
import {
  SearchResult,
  rankAndMerge,
  CATEGORY_SEPARATORS,
  ResultCategory
} from './resultRanker';

/** Debounce for the fast sources (files + symbols). */
const DEBOUNCE_PRIMARY = 300;
/** Debounce for the slower full-text search. */
const DEBOUNCE_TEXT = 500;

const PLACEHOLDER = 'Search files, symbols, and text...';

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

/**
 * Owns the QuickPick experience: filter tabs, debounced searching across the
 * three sources, busy state, rendering with category separators, and opening
 * the chosen result.
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
    const query = rawValue.trim();
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
      this.provider.fallbackFiles(token).then((files) => {
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

    this.pendingPrimary = true;
    this.pendingText = this.filter === 'all' || this.filter === 'text';
    this.updateBusy();

    this.primaryTimer = setTimeout(() => {
      this.provider.primary(query, this.filter, token).then((res) => {
        if (token.isCancellationRequested) {
          return;
        }
        this.files = res.files;
        this.symbols = res.symbols;
        this.pendingPrimary = false;
        this.render();
        this.updateBusy();
      });
    }, DEBOUNCE_PRIMARY);

    if (this.pendingText) {
      this.textTimer = setTimeout(() => {
        this.provider.text(query, this.filter, token).then((res) => {
          if (token.isCancellationRequested) {
            return;
          }
          this.text = res;
          this.pendingText = false;
          this.render();
          this.updateBusy();
        });
      }, DEBOUNCE_TEXT);
    }
  }

  private render(): void {
    if (!this.quickPick) {
      return;
    }

    const merged = rankAndMerge(
      [this.files, this.symbols, this.text],
      this.currentQuery
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
      items.push({
        label: result.label,
        description: result.description,
        detail: result.detail,
        iconPath: new vscode.ThemeIcon(result.iconId),
        result
      });
    }

    this.quickPick.items = items;
  }

  private updateBusy(): void {
    if (this.quickPick) {
      this.quickPick.busy = this.pendingPrimary || this.pendingText;
    }
  }

  private async onAccept(): Promise<void> {
    const selected = this.quickPick?.selectedItems[0];
    const result = selected?.result;
    if (!result) {
      return;
    }

    // Close first so focus returns to the editor cleanly.
    this.quickPick?.hide();

    try {
      const doc = await vscode.workspace.openTextDocument(result.uri);
      const editor = await vscode.window.showTextDocument(doc);

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
