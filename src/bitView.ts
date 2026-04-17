/**
 * Live bit-breakdown webview.
 *
 * A side panel that shows the 64-bit microinstruction word for the
 * instruction under the cursor, broken down into its named fields
 * with per-field values (octal + decimal) and colour-coded by category.
 *
 * The view subscribes to cursor changes in any .uc editor and updates
 * automatically. When the cursor moves into a new instruction, the
 * entire bit grid refreshes.
 */

import * as vscode from "vscode";
import {
  preprocess,
  translateInstruction,
  decodeFields,
  type Model,
  type DecodedFields,
} from "@nd100uc/microcode";
import { loadEmbeddedDefinitions } from "./loadDefsEmbedded";

const BIT_VIEW_VIEW_TYPE = "nd-microcode.bitView";

interface FieldSpec {
  name: string;
  bitHi: number;
  bitLo: number;
  color: string;        // CSS class name
  description: string;
}

/**
 * The microinstruction field map. Hi/lo inclusive. Order matters -
 * the view renders fields in this order from MSB (bit 63) down to
 * bit 0 for the 64-bit word.
 */
const FIELDS: FieldSpec[] = [
  { name: "ALUI",      bitHi: 63, bitLo: 55, color: "alu",     description: "ALU function (composite src+func+dest, 9 bits)" },
  { name: "STS",       bitHi: 54, bitLo: 53, color: "sts",     description: "Status update / ALU shift mode" },
  { name: "RASEL",     bitHi: 52, bitLo: 51, color: "reg",     description: "A-operand select" },
  { name: "XRF",       bitHi: 50, bitLo: 50, color: "special", description: "Extended register file" },
  { name: "RBSEL",     bitHi: 49, bitLo: 48, color: "reg",     description: "B-operand select" },
  { name: "CIN",       bitHi: 47, bitLo: 46, color: "alu",     description: "Carry-in select" },
  { name: "ALUM",      bitHi: 45, bitLo: 44, color: "alu",     description: "ALU mode modifier" },
  { name: "MIS",       bitHi: 43, bitLo: 42, color: "alu",     description: "Shift mode (when ALUM=MIC)" },
  { name: "IDBS",      bitHi: 41, bitLo: 37, color: "idbs",    description: "Internal Data Bus source" },
  { name: "COMM",      bitHi: 36, bitLo: 32, color: "comm",    description: "Command" },
  { name: "T_SEQ",     bitHi: 31, bitLo: 30, color: "seq",     description: "True-path sequence" },
  { name: "T_STK",     bitHi: 29, bitLo: 28, color: "seq",     description: "True-path stack op" },
  { name: "csdelay",   bitHi: 27, bitLo: 26, color: "timing",  description: "Delay / timing bits" },
  { name: "VECT",      bitHi: 25, bitLo: 25, color: "seq",     description: "Vector-jump selector" },
  { name: "SCOND",     bitHi: 24, bitLo: 24, color: "cond",    description: "Set condition (low 12 bits carry cond fields)" },
  { name: "ECOND",     bitHi: 23, bitLo: 23, color: "cond",    description: "CONDENABL - enable conditional sequencing" },
  { name: "LOOP",      bitHi: 22, bitLo: 22, color: "special", description: "LCOUNT - count loop counter" },
  { name: "csdelay21", bitHi: 21, bitLo: 21, color: "timing",  description: "Delay bit (timing)" },
  { name: "CSBIT20",   bitHi: 20, bitLo: 20, color: "branch",  description: "Address extension (high bit of 13-bit branch addr)" },
  { name: "BOP",       bitHi: 19, bitLo: 16, color: "reg",     description: "B-operand register" },
  { name: "AOP",       bitHi: 15, bitLo: 12, color: "reg",     description: "A-operand register" },
  { name: "BRANCH",    bitHi: 11, bitLo: 0,  color: "branch",  description: "SCOND=0: branch addr bits 11:0. SCOND=1: LCC/TSEL/F_SEQ/F_STK" },
];

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function extractField(v: bigint, hi: number, lo: number): number {
  const width = BigInt(hi - lo + 1);
  const mask = (1n << width) - 1n;
  return Number((v >> BigInt(lo)) & mask);
}

function toBinary(v: bigint, bits: number): string {
  let out = "";
  for (let i = bits - 1; i >= 0; i--) {
    out += (v >> BigInt(i)) & 1n ? "1" : "0";
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface RenderState {
  address: number;
  line: number;
  model: Model;
  tokens: string[];
  canonical: bigint;
  storage: bigint;
  fields: DecodedFields;
  errors: string[];
}

function renderHtml(state: RenderState | undefined): string {
  const styles = `
    body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 8px;
    }
    .header { font-weight: bold; margin-bottom: 8px; }
    .header .addr { color: var(--vscode-textLink-foreground); }
    .tokens { margin-bottom: 12px; opacity: 0.8; font-family: monospace; }
    .bit-grid { display: flex; flex-wrap: wrap; margin-bottom: 8px; }
    .bit {
      width: 18px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--vscode-panel-border);
      font-size: 10px; font-weight: bold;
      margin: 1px;
    }
    .bit.set { background: var(--vscode-editorInfo-foreground); color: var(--vscode-editor-background); }
    .bit.clear { background: var(--vscode-editor-background); opacity: 0.5; }
    .bit-row { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
    .bit-range { width: 70px; opacity: 0.7; font-size: 10px; }
    table { border-collapse: collapse; width: 100%; font-size: 11px; }
    th, td {
      text-align: left;
      padding: 4px 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    th { opacity: 0.8; font-weight: normal; }
    td.value { font-family: monospace; font-weight: bold; }
    td.desc { opacity: 0.7; font-size: 10px; }
    .color-alu     td:first-child { border-left: 3px solid #4fc3f7; padding-left: 4px; }
    .color-reg     td:first-child { border-left: 3px solid #81c784; padding-left: 4px; }
    .color-idbs    td:first-child { border-left: 3px solid #ffb74d; padding-left: 4px; }
    .color-comm    td:first-child { border-left: 3px solid #f06292; padding-left: 4px; }
    .color-seq     td:first-child { border-left: 3px solid #ba68c8; padding-left: 4px; }
    .color-cond    td:first-child { border-left: 3px solid #ff8a65; padding-left: 4px; }
    .color-sts     td:first-child { border-left: 3px solid #90a4ae; padding-left: 4px; }
    .color-timing  td:first-child { border-left: 3px solid #9e9e9e; padding-left: 4px; opacity: 0.6; }
    .color-special td:first-child { border-left: 3px solid #ffd54f; padding-left: 4px; }
    .color-branch  td:first-child { border-left: 3px solid #7986cb; padding-left: 4px; }
    .empty {
      display: flex; align-items: center; justify-content: center;
      min-height: 200px;
      opacity: 0.5;
      text-align: center;
    }
    .error { color: var(--vscode-errorForeground); }
  `;

  if (!state) {
    return `<!DOCTYPE html>
<html><head><style>${styles}</style></head><body>
<div class="empty">
  <div>Place cursor in a .uc microcode file<br>to see the bit breakdown.</div>
</div>
</body></html>`;
  }

  // Visual bit grid - 8 rows of 8 bits each, MSB first.
  const binary = toBinary(state.canonical, 64);
  const bitGrid: string[] = [];
  for (let row = 0; row < 8; row++) {
    const hi = 63 - row * 8;
    const lo = hi - 7;
    const rowBits: string[] = [];
    for (let i = 0; i < 8; i++) {
      const bitIdx = hi - i;
      const bit = binary[63 - bitIdx];
      rowBits.push(
        `<div class="bit ${bit === "1" ? "set" : "clear"}" title="bit ${bitIdx}">${bitIdx}</div>`,
      );
    }
    bitGrid.push(
      `<div class="bit-row"><span class="bit-range">${hi}..${lo}</span>${rowBits.join("")}</div>`,
    );
  }

  // Field table.
  const rows: string[] = [];
  for (const f of FIELDS) {
    const val = extractField(state.canonical, f.bitHi, f.bitLo);
    const width = f.bitHi - f.bitLo + 1;
    const binStr = val.toString(2).padStart(width, "0");
    const octStr = "0o" + val.toString(8);
    const bitsLabel = f.bitHi === f.bitLo ? `${f.bitHi}` : `${f.bitHi}:${f.bitLo}`;
    rows.push(
      `<tr class="color-${f.color}">` +
      `<td>${escapeHtml(f.name)}</td>` +
      `<td><code>${bitsLabel}</code></td>` +
      `<td class="value"><code>${binStr}</code></td>` +
      `<td class="value">${octStr}</td>` +
      `<td class="value">${val}</td>` +
      `<td class="desc">${escapeHtml(f.description)}</td>` +
      `</tr>`,
    );
  }

  const errorsBlock = state.errors.length > 0
    ? `<div class="error"><strong>Validation:</strong><ul>${state.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul></div>`
    : "";

  return `<!DOCTYPE html>
<html><head><style>${styles}</style></head><body>
<div class="header">
  <span class="addr">0o${state.address.toString(8).padStart(6, "0")}</span>
  <span>&middot; line ${state.line}</span>
  <span>&middot; model ${state.model}</span>
</div>
<div class="tokens">${escapeHtml(state.tokens.join(" "))}</div>
<div class="bit-grid">${bitGrid.join("")}</div>
<div>
  <strong>Canonical:</strong> <code>0x${state.canonical.toString(16).padStart(16, "0")}</code><br>
  <strong>ROM storage:</strong> <code>0x${state.storage.toString(16).padStart(16, "0")}</code>
</div>
<br>
<table>
  <thead>
    <tr>
      <th>Field</th><th>Bits</th><th>Binary</th><th>Octal</th><th>Decimal</th><th>Meaning</th>
    </tr>
  </thead>
  <tbody>${rows.join("")}</tbody>
</table>
${errorsBlock}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Panel lifecycle
// ---------------------------------------------------------------------------

class BitViewController {
  private panel: vscode.WebviewPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private packs = new Map<Model, ReturnType<typeof loadEmbeddedDefinitions>>();
  private lastInstructionKey = "";

  open(context: vscode.ExtensionContext): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      BIT_VIEW_VIEW_TYPE,
      "ND MicroCode Bit View",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: false, retainContextWhenHidden: true },
    );
    this.panel.webview.html = renderHtml(undefined);

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      for (const d of this.disposables) d.dispose();
      this.disposables = [];
      this.lastInstructionKey = "";
    }, null, context.subscriptions);

    // Refresh on cursor moves / active-editor changes / document edits.
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.refresh(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((e) => this.refresh(e)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const active = vscode.window.activeTextEditor;
        if (active && e.document === active.document) this.refresh(active, true);
      }),
    );

    // Initial render from the currently-active editor, if any.
    this.refresh(vscode.window.activeTextEditor);
  }

  private refresh(editor: vscode.TextEditor | undefined, force = false): void {
    if (!this.panel) return;
    if (!editor || editor.document.languageId !== "uc") {
      this.panel.webview.html = renderHtml(undefined);
      this.lastInstructionKey = "";
      return;
    }
    const state = this.computeState(editor);
    if (!state) {
      this.panel.webview.html = renderHtml(undefined);
      this.lastInstructionKey = "";
      return;
    }
    // Avoid redundant re-renders when the cursor stays within the same
    // instruction (unless a file-edit forced us to re-evaluate).
    const key = `${editor.document.uri.toString()}|${state.address}|${state.line}|${state.canonical.toString(16)}`;
    if (key === this.lastInstructionKey && !force) return;
    this.lastInstructionKey = key;
    this.panel.webview.html = renderHtml(state);
  }

  private computeState(editor: vscode.TextEditor): RenderState | undefined {
    const source = editor.document.getText();
    const model = detectModel(source);
    const pack = this.loadPack(model);
    if (!pack) return undefined;
    const sm = preprocess(source);
    if (sm.instructions.length === 0) return undefined;
    const cursorLine = editor.selection.active.line + 1;
    let target = sm.instructions[0]!;
    for (const ins of sm.instructions) {
      if (ins.line <= cursorLine) target = ins;
    }
    const diagnostics: Parameters<typeof translateInstruction>[3] = [];
    const canonical = translateInstruction(target, pack, sm.labels, diagnostics);
    const storage = model === "nd110" ? canonical ^ 0x0FC00000n : canonical;
    const fields = decodeFields(canonical, target.address);
    return {
      address: target.address,
      line: target.line,
      model,
      tokens: target.args,
      canonical,
      storage,
      fields,
      errors: diagnostics.map((d) => `line ${d.line}: ${d.message}`),
    };
  }

  private loadPack(model: Model) {
    const cached = this.packs.get(model);
    if (cached) return cached;
    try {
      const pack = loadEmbeddedDefinitions(model);
      this.packs.set(model, pack);
      return pack;
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Failed to load ${model} definitions: ${e instanceof Error ? e.message : String(e)}`,
      );
      return undefined;
    }
  }
}

function detectModel(source: string): Model {
  const first = source.split(/\r?\n/, 50).join("\n");
  const m = /^%#MODEL\s+(nd110|nd120)\b/im.exec(first);
  if (m) return m[1] as Model;
  const config = vscode.workspace.getConfiguration("nd-microcode");
  const c = config.get<string>("defaultModel", "nd110");
  return c === "nd120" ? "nd120" : "nd110";
}

// Module-level singleton; the panel is unique per VSCode session.
const controller = new BitViewController();

export function registerBitView(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand(
    "nd-microcode.openBitView",
    () => controller.open(context),
  );
}
