# Search Everywhere

A VS Code extension that brings JetBrains WebStorm's **Search Everywhere** to VS Code: one popup that searches **files**, **workspace symbols**, and **full text** at once, merges the results into a single ranked list, and lets you jump straight to the match.

## Features

- **Unified search** across three sources in one QuickPick:
  - **Files** — by name and relative path.
  - **Symbols** — classes, functions, variables, interfaces, and more, via VS Code's workspace symbol provider.
  - **Text** — full-text matches across the workspace (for queries of 3+ characters).
- **Filter tabs** at the top of the popup: `All`, `Files`, `Symbols`, `Text`.
- **Category sections** with separators — `— Files —`, `— Symbols —`, `— Text Matches —`.
- **Type-aware icons and chips** — each result shows its kind (`$(file) File`, `$(symbol-class) Symbol`, `$(search) Text Match`) plus a detail line with the relative path and line number.
- **Smart ranking** — within each category, exact name matches rank above prefix matches above substring matches.
- **Recent files on open** — an empty query shows your most recently opened files.
- **Jump to location** — selecting a symbol or text match opens the file and centers the cursor on the exact line and column.

## How to trigger it

- **Keybinding:** `Ctrl+T` (`Cmd+T` on macOS).
- **Command Palette:** run **`Search Everywhere: Open`**.

### Double-press Shift (opt-in)

JetBrains opens Search Everywhere with a double-press of `Shift`. VS Code does **not** expose raw key events to extensions, and binding a bare `shift` key would intercept every capital letter and break typing — so double-Shift cannot be enabled safely by default.

The machinery is shipped and ready: the extension registers an internal command `search-everywhere.shiftPressed` and a 400 ms double-press detector. If you want to opt in, add a keybinding (Preferences → Keyboard Shortcuts → `keybindings.json`):

```jsonc
{
  "key": "shift",
  "command": "search-everywhere.shiftPressed",
  "when": "editorTextFocus"
}
```

Be aware this captures Shift in the editor and will interfere with typing capitals; most users should stick with `Ctrl/Cmd+T`.

## Filter tabs

Click a tab button at the top of the popup to scope results:

| Tab       | Shows                                  |
| --------- | -------------------------------------- |
| `All`     | Files, symbols, and text matches       |
| `Files`   | File-name / path matches only          |
| `Symbols` | Workspace symbols only                 |
| `Text`    | Full-text matches only (3+ characters) |

The active tab is reflected in the popup title.

## Performance

- **No custom indexing.** Every source uses VS Code's own built-in providers (`findFiles`, the workspace symbol provider, and the text-search provider), so there is no separate index to build or keep in sync.
- **Debounced.** Files and symbols search after a 300 ms pause; the heavier full-text search waits 500 ms.
- **Cancellable.** Each keystroke cancels the in-flight search via a `CancellationToken`, so stale work is dropped.
- **Fault-isolated.** If one source errors, the others still return results.
- **Bounded.** Files and symbols cap at 30 results each; text matches cap at 20.

Excluded from search: `node_modules`, `.git`, `dist`, `out`, and `.next`.

## Build and run locally

```bash
npm install
npm run compile      # one-off dev build
npm run watch        # rebuild on change
npm run build        # minified production bundle
npm run package      # produce a .vsix via vsce
```

To try it live, open this folder in VS Code and press **`F5`**. That launches an **Extension Development Host** window with the extension loaded — open a project folder there and hit `Ctrl/Cmd+T` (or run `Search Everywhere: Open`).

## Project structure

```
search-everywhere/
├── src/
│   ├── extension.ts       # activate(), command + double-Shift detector wiring
│   ├── quickPickUI.ts     # QuickPick UI: filter tabs, debounce, rendering, open
│   ├── searchProvider.ts  # orchestrates the three sources, cancellation
│   ├── fileSearch.ts      # file search
│   ├── symbolSearch.ts    # workspace symbol search
│   ├── textSearch.ts      # full-text search
│   └── resultRanker.ts    # SearchResult type, merging and ranking
├── package.json
├── tsconfig.json
├── esbuild.js
└── README.md
```
