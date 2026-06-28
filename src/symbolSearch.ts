import * as vscode from 'vscode';
import { SearchResult } from './resultRanker';

/** Safety cap on raw symbols processed; the ranker caps the displayed count. */
const SYMBOL_SAFETY_CAP = 200;

/** Map a SymbolKind to a codicon id. */
function iconForKind(kind: vscode.SymbolKind): string {
  switch (kind) {
    case vscode.SymbolKind.Class:
      return 'symbol-class';
    case vscode.SymbolKind.Method:
    case vscode.SymbolKind.Function:
    case vscode.SymbolKind.Constructor:
      return 'symbol-method';
    case vscode.SymbolKind.Variable:
      return 'symbol-variable';
    case vscode.SymbolKind.Interface:
      return 'symbol-interface';
    case vscode.SymbolKind.Enum:
      return 'symbol-enum';
    case vscode.SymbolKind.EnumMember:
      return 'symbol-enum-member';
    case vscode.SymbolKind.Field:
    case vscode.SymbolKind.Property:
      return 'symbol-field';
    case vscode.SymbolKind.Constant:
      return 'symbol-constant';
    case vscode.SymbolKind.Module:
    case vscode.SymbolKind.Namespace:
    case vscode.SymbolKind.Package:
      return 'symbol-namespace';
    case vscode.SymbolKind.Struct:
      return 'symbol-structure';
    case vscode.SymbolKind.String:
      return 'symbol-string';
    case vscode.SymbolKind.Number:
      return 'symbol-numeric';
    case vscode.SymbolKind.Boolean:
      return 'symbol-boolean';
    case vscode.SymbolKind.Array:
      return 'symbol-array';
    case vscode.SymbolKind.Key:
      return 'symbol-key';
    case vscode.SymbolKind.Event:
      return 'symbol-event';
    case vscode.SymbolKind.Operator:
      return 'symbol-operator';
    case vscode.SymbolKind.TypeParameter:
      return 'symbol-parameter';
    default:
      return 'symbol-misc';
  }
}

/** Human-readable name for a SymbolKind, used in the detail line. */
function kindName(kind: vscode.SymbolKind): string {
  return vscode.SymbolKind[kind] ?? 'Symbol';
}

function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

/**
 * Search workspace symbols via the built-in symbol provider.
 */
export async function searchSymbols(
  query: string,
  token: vscode.CancellationToken
): Promise<SearchResult[]> {
  if (!query) {
    return [];
  }

  const symbols = await vscode.commands.executeCommand<
    vscode.SymbolInformation[]
  >('vscode.executeWorkspaceSymbolProvider', query);

  if (token.isCancellationRequested || !symbols) {
    return [];
  }

  const results: SearchResult[] = [];
  for (const sym of symbols.slice(0, SYMBOL_SAFETY_CAP)) {
    const uri = sym.location.uri;
    const start = sym.location.range.start;
    const rel = relativePath(uri);
    const kind = kindName(sym.kind);
    results.push({
      category: 'symbol',
      label: sym.name,
      description: `$(${iconForKind(sym.kind)}) Symbol`,
      detail: `${kind} · ${rel}:${start.line + 1}`,
      iconId: iconForKind(sym.kind),
      uri,
      position: new vscode.Position(start.line, start.character),
      score: 0
    });
  }

  return results;
}
