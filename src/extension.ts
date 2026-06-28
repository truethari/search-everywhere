import * as vscode from 'vscode';
import { QuickPickUI } from './quickPickUI';

/** Max gap between two Shift presses to count as a double-press. */
const DOUBLE_SHIFT_WINDOW_MS = 400;

/**
 * Tracks Shift presses and fires `onDouble` when two land within the window.
 *
 * Note on platform limits: VS Code does not expose raw key events to
 * extensions, and a bare-modifier keybinding (`"key": "shift"`) would intercept
 * every capital letter and break typing. So this detector is wired to an
 * internal command (`search-everywhere.shiftPressed`) that users may opt into
 * binding to `shift`. The default, always-working triggers are the `Ctrl/Cmd+T`
 * keybinding and the `Search Everywhere: Open` command in the palette.
 */
class ShiftDetector {
  private lastPress = 0;

  constructor(private readonly onDouble: () => void) {}

  /** Record a Shift press; invoke the callback on a qualifying double-press. */
  press(now: number = Date.now()): void {
    if (now - this.lastPress <= DOUBLE_SHIFT_WINDOW_MS) {
      this.lastPress = 0; // reset so a third press doesn't immediately re-fire
      this.onDouble();
      return;
    }
    this.lastPress = now;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const ui = new QuickPickUI();

  const open = () => ui.open();
  const detector = new ShiftDetector(open);

  context.subscriptions.push(
    vscode.commands.registerCommand('search-everywhere.open', open),
    vscode.commands.registerCommand('search-everywhere.shiftPressed', () =>
      detector.press()
    ),
    { dispose: () => ui.dispose() }
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables registered in activate().
}
