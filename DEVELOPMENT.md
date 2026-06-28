# Development Guide

How to set up, run, test, and iterate on the **OmniSearch** extension locally.

## Prerequisites

- **Node.js** 18 or newer (`node --version`)
- **VS Code** 1.85.0 or newer (this is also the engine the extension targets)
- **npm** (ships with Node)

Optional, for packaging a `.vsix`:

- `@vscode/vsce` — already a devDependency, run via `npm run package`.

## First-time setup

```bash
git clone <this-repo>            # or just open the existing folder
cd OmniSearch
npm install                      # installs devDependencies (no runtime deps)
npm run compile                  # produces dist/extension.js
```

If `npm install` fails with a network error (`ECONNRESET`), just re-run it — the
`@vscode/vsce` dependency tree is large and the install is resumable.

## Running it (the F5 workflow)

This is the main loop for testing the extension by hand.

1. Open the project folder in VS Code.
2. Press **`F5`** (Run → Start Debugging).
   - This triggers the `preLaunchTask` (`npm: compile`) defined in
     [.vscode/tasks.json](.vscode/tasks.json), then launches a second VS Code
     window — the **Extension Development Host** — with the extension loaded.
   - The launch config lives in [.vscode/launch.json](.vscode/launch.json).
3. In the Extension Development Host window, **open a real project folder**
   (File → Open Folder). The extension needs an open workspace — with none it
   shows `No workspace folder open`.
4. Trigger the feature:
   - Press **`Ctrl+T`** (`Cmd+T` on macOS), or
   - Open the Command Palette (`Ctrl/Cmd+Shift+P`) → **`OmniSearch: Open`**.

To reload the extension after a code change: in the Extension Development Host,
run **`Developer: Reload Window`** (`Ctrl/Cmd+R`), or stop and re-press `F5`.

### Fast iteration with watch mode

Instead of recompiling on every change, run the bundler in watch mode:

```bash
npm run watch
```

Then each time you edit a file:

1. esbuild rebuilds `dist/extension.js` automatically.
2. In the Extension Development Host, run `Developer: Reload Window` to pick up
   the new bundle.

You can also launch with watch as the background task by switching the
`preLaunchTask` in `launch.json` to `npm: watch` (it is already defined as a
background task in `tasks.json`).

## Manual test checklist

With the Extension Development Host open on a project that has source files:

| What to test     | How                                        | Expect                                                   |
| ---------------- | ------------------------------------------ | -------------------------------------------------------- |
| Empty query      | Open the popup, type nothing               | Up to 10 recent / fallback files                         |
| File search      | Type part of a filename                    | `— Files —` section with `$(file) File` chips            |
| Symbol search    | Type a class/function name                 | `— Symbols —` section with kind-specific icons           |
| Text search      | Type 3+ chars present in code              | `— Text Matches —` with the matching line as detail      |
| Ranking          | Type an exact filename                     | Exact match appears at the top of Files                  |
| Filter tabs      | Click `Files` / `Symbols` / `Text` buttons | Title updates; only that category shows                  |
| Jump to location | Select a symbol or text match              | File opens, cursor centered on the line/column           |
| No workspace     | Close the folder, trigger the command      | `No workspace folder open` message                       |
| Cancellation     | Type quickly                               | No stale results flash in; only the latest query renders |
| Busy indicator   | Type a query                               | Spinner shows while searching, clears when done          |

## Debugging

- **Breakpoints:** set them in the `src/*.ts` files. The launch config maps
  source via `outFiles` + sourcemaps (sourcemaps are on for the dev build, off
  for `--production`). Hitting `F5` attaches the debugger automatically.
- **Logs:** the extension logs source failures with `console.error`
  (`[omnisearch] ...`). View them in the **main** VS Code window's
  Debug Console (the one you pressed `F5` from), not the Host window.
- **Inspect the running extension:** in the Host window,
  `Developer: Show Running Extensions` confirms it activated
  (`onStartupFinished`).

## Project layout

See [CLAUDE.md](CLAUDE.md) for the full architecture and component contracts.
Short version of the data flow:

```
extension.ts  →  quickPickUI.ts  →  searchProvider.ts  →  fileSearch.ts
   (wiring)        (UI + debounce)     (orchestration,       symbolSearch.ts
                                        cancellation)        textSearch.ts
                                                                 ↓
                                          resultRanker.ts (merge + rank + separators)
```

## Where to start developing

Pick the file that matches the change:

- **Tune debounce / result caps / the double-Shift window** — the named
  constants at the top of each module (`DEBOUNCE_PRIMARY` / `DEBOUNCE_TEXT` in
  `quickPickUI.ts`, `FILE_LIMIT` in `fileSearch.ts`, `TEXT_LIMIT` /
  `TEXT_MIN_QUERY` in `textSearch.ts`, `DOUBLE_SHIFT_WINDOW_MS` in
  `extension.ts`).
- **Change ranking behavior** — `resultRanker.ts` (`scoreMatch`, `applyScore`,
  `rankAndMerge`).
- **Add/adjust a search source** — the matching `*Search.ts` file, then wire it
  through `searchProvider.ts`.
- **Change the popup look or interaction** — `quickPickUI.ts` (items, icons,
  filter buttons, separators, selection handling).
- **Change icons for symbol kinds** — `iconForKind` in `symbolSearch.ts`.

### Adding a new search source (example)

1. Create `src/mySearch.ts` exporting
   `searchMine(query, token): Promise<SearchResult[]>`, returning items with a
   new `category`.
2. Add the category to `ResultCategory`, `CATEGORY_ORDER`, and
   `CATEGORY_SEPARATORS` in `resultRanker.ts`.
3. Call it from `SearchProvider` (in `primary()` for a fast source, or with its
   own debounce path like `text()` for a slow one), wrapped in `runSource(...)`
   so failures stay isolated.
4. Surface it in `quickPickUI.ts` rendering and (if needed) the filter tabs.

## Build & package reference

| Command             | Does                                         |
| ------------------- | -------------------------------------------- |
| `npm run compile`   | One-off dev bundle → `dist/extension.js`     |
| `npm run watch`     | Rebuild on file change                       |
| `npm run build`     | Minified production bundle (no sourcemap)    |
| `npm run typecheck` | `tsc --noEmit` — type errors only, no output |
| `npm run package`   | Produce a `.vsix` with `vsce`                |

### Installing the packaged build

```bash
npm run package                       # creates omnisearch-<version>.vsix
code --install-extension omnisearch-1.0.0.vsix
```

## Troubleshooting

- **Popup never opens / command missing** — confirm the extension activated
  (`Developer: Show Running Extensions`); check the Debug Console for activation
  errors.
- **No text-match results** — text search requires 3+ characters and depends on
  the host's `findTextInFiles` provider; if unavailable the source degrades to
  empty while files and symbols keep working.
- **No symbol results** — workspace symbols come from language extensions; make
  sure the relevant language support is installed and has finished indexing in
  the Host window.
- **`tsc` errors about proposed APIs** — `findTextInFiles` is accessed
  defensively via `any` on purpose; don't re-add a static type import for it.

```

```
