/**
 * ND-100/110/120 Microcode VSCode extension - entry point.
 *
 * Registers:
 *   - Hover provider for .uc files (token docs + context-aware numeric
 *     interpretation)
 *   - Commands for assembling, disassembling, and burning ROMs (backed
 *     by the @nd100uc/microcode TS library)
 *
 * The syntax highlighter is declarative (TextMate grammar under
 * syntaxes/uc.tmLanguage.json) and needs no runtime code.
 */

import * as vscode from "vscode";
import { registerHoverProvider } from "./hoverProvider";
import { registerCommands } from "./commands";
import { registerBitView } from "./bitView";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerHoverProvider());
  context.subscriptions.push(registerBitView(context));
  registerCommands(context);
}

export function deactivate(): void {
  // Nothing to clean up - subscriptions are handled by the extension host.
}
