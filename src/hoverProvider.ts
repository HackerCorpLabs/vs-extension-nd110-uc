/**
 * Hover provider for ND-100/110/120 microcode tokens and numerics.
 *
 * For TOKENS under the cursor: show name, description, category, line,
 *   model availability, encoding, and operand requirements.
 *
 * For NUMERIC literals under the cursor: walk the surrounding
 *   instruction (backwards to the previous ";" and forwards to the
 *   next ";"), collect all tokens, then infer what the numeric will
 *   be used for based on which COMM / IDBS / T,JMP / COND tokens are
 *   present. Show octal/decimal/hex value + the inferred role.
 *
 * Examples:
 *   `IDBS,ARG T,NEXT T,HOLD 14000;` -> "14000: 16-bit data on IDB via IDBS,ARG"
 *   `IDBS,ARG COMM,LDGPR T,NEXT 10000;` -> "10000: value loaded into GPR"
 *   `T,JMP T,HOLD 1752;` -> "1752: 12-bit branch target (no bit 20)"
 *   `T,JMP T,HOLD 14000;` -> "14000: 13-bit branch target (bit 20 set + low 12 = 0x800)"
 *   `COND,LC=0 F,JMP F,HOLD 400;` -> "400: LCC=1 (loop counter compare)"
 */

import * as vscode from "vscode";
import hoverData from "./generated/token-hover.json";

interface TokenEntry {
  name: string;
  category: string;
  displayLine: 1 | 2 | 3;
  description: string;
  models: string[];
  nd120Only: boolean;
  provides?: string;
  requires?: string;
  encoding: { w1: string; w2: string; w3: string; w4: string };
}

interface RuntimeData {
  alufFormulas: Record<string, string>;
  idbsSources: Record<string, string>;
  commEffects: Record<string, {
    reads?: string;
    writes?: string;
    uses_a?: boolean;
    uses_b?: boolean;
    notes?: string;
    timing_note?: string;
  }>;
  aludBehavior: Record<string, {
    name?: string;
    y_bus?: string;
    q_update?: string | null;
    b_register_write?: string | null;
    shift?: string;
    note?: string;
  }>;
}

interface HoverData {
  tokens: Record<string, TokenEntry>;
  runtime: RuntimeData;
}

const data = hoverData as unknown as HoverData;

// Regex-like char class for identifying a single "word" under the cursor.
// Tokens contain commas, +, -, *, =. Numerics contain only digits (octal
// is the default ND convention, hex uses 0x prefix).
const TOKEN_CHAR_RE = /[A-Z0-9,+\-*=_]/;
const NUMERIC_RE = /^[0-9]+$/;

function wordRangeAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Range | undefined {
  const line = document.lineAt(position.line).text;
  let start = position.character;
  let end = position.character;
  while (start > 0 && TOKEN_CHAR_RE.test(line[start - 1]!)) start--;
  while (end < line.length && TOKEN_CHAR_RE.test(line[end]!)) end++;
  if (start === end) return undefined;
  return new vscode.Range(
    new vscode.Position(position.line, start),
    new vscode.Position(position.line, end),
  );
}

/**
 * Extract all whitespace-separated tokens from the microcode instruction
 * containing the cursor. An instruction starts immediately after the
 * PREVIOUS `;` (or at document start) and ends at the NEXT `;` at or
 * after the cursor.
 *
 * Comments (`% ... EOL`) are stripped. Labels (`NAME:`) and address
 * markers (`NNN/`) are NOT included in the returned token list.
 *
 * Returns [] if no `;` terminator exists after the cursor (instruction
 * is incomplete); callers may still want to render a partial hover.
 */
function extractInstructionTokens(
  document: vscode.TextDocument,
  cursor: vscode.Position,
): string[] {
  // Use the document's native text so our offsets match
  // document.offsetAt(cursor) exactly - critical for CRLF files where
  // joining lines with "\n" would shift every subsequent character.
  const raw = document.getText();
  // Strip comments (% to end-of-line) in place, preserving length so
  // offsets stay valid.
  const fullText = raw.replace(/%[^\r\n]*/g, (m) => " ".repeat(m.length));

  const cursorOffset = document.offsetAt(cursor);

  // Scan backwards for the previous `;` (previous instruction's end).
  let start = 0;
  for (let i = cursorOffset - 1; i >= 0; i--) {
    if (fullText[i] === ";") {
      start = i + 1;
      break;
    }
  }
  // Scan forwards for the next `;` (this instruction's end).
  let end = fullText.length;
  for (let i = cursorOffset; i < fullText.length; i++) {
    if (fullText[i] === ";") {
      end = i;
      break;
    }
  }

  let instrText = fullText.slice(start, end);

  // Strip labels and address markers so they don't appear as tokens.
  instrText = instrText.replace(/[A-Z_][A-Z0-9_]*:/gi, " ");
  instrText = instrText.replace(/(^|\r?\n)\s*[0-7]+\//g, "$1");

  // Normalise comma spacing (like the assembler's preprocessor).
  instrText = instrText.replace(/ ,/g, ",").replace(/, /g, ",");

  return instrText.split(/\s+/).filter((s) => s.length > 0);
}

/**
 * Parse a numeric literal per the ND assembler convention.
 *   d123  - decimal
 *   0xAB  - hex
 *   $AB   - hex
 *   oNNN  - explicit octal
 *   plain - octal (default)
 */
function parseNumeric(s: string): number | undefined {
  if (!s) return undefined;
  if (s[0] === "d" || s[0] === "D") return Number.parseInt(s.slice(1), 10);
  if (s.startsWith("0x") || s.startsWith("0X")) return Number.parseInt(s.slice(2), 16);
  if (s[0] === "$") return Number.parseInt(s.slice(1), 16);
  if (s[0] === "o" || s[0] === "O") return Number.parseInt(s.slice(1), 8);
  if (/^[0-7]+$/.test(s)) return Number.parseInt(s, 8);
  return undefined;
}

// ---------------------------------------------------------------------------
// Numeric interpretation: trace the full data-flow path through the ALU
// based on the full set of tokens in the enclosing microinstruction.
//
// Runtime data is sourced from defs/runtime/data-flow.yaml via the
// generated hover-data JSON. The fallback tables below are kept as a
// last-resort in case the YAML misses an entry.
// ---------------------------------------------------------------------------

const IDBS_ROLE_FALLBACK: Record<string, string> = {
  "IDBS,ALU":    "ALU output → IDB",
  "IDBS,ARG":    "microinstruction argument (bits 15:0) → IDB",
  "IDBS,BARG":   "B-operand argument (bits 16-19, value 0-17) → IDB",
  "IDBS,AARG":   "A-operand argument ×8 (value 0-170) → IDB",
  "IDBS,BMG":    "Bit-mask generator → IDB",
  "IDBS,GPR":    "General-purpose register → IDB",
  "IDBS,DBR":    "Data bus register → IDB",
  "IDBS,REG":    "Register file[A-OP, B-OP] → IDB",
  "IDBS,STS":    "STATUS register → IDB",
  "IDBS,SWAP":   "Byte-swap of previous IDB → IDB",
  "IDBS,PEA":    "PEA register → IDB",
  "IDBS,PES":    "PES register → IDB",
  "IDBS,PIC":    "PIC status register → IDB",
  "IDBS,IOR":    "UART data/status → IDB",
  "IDBS,PGS":    "Paging status → IDB",
  "IDBS,CSR":    "Cache status register → IDB",
  "IDBS,PCR":    "Paging control register → IDB",
  "IDBS,ALD":    "Auto-load descriptor → IDB",
  "IDBS,PANEL":  "Panel interrupt vector → IDB",
  "IDBS,PICVC":  "PIC interrupt vector → IDB",
  "IDBS,LBR":    "Logical bank register → IDB",
  "IDBS,LA":     "Logical address (jump) → IDB",
  "IDBS,INR":    "Installation number → IDB",
  "IDBS,UART":   "UART register → IDB",
  "IDBS,PICM":   "PIC mask register → IDB",
};

const ALUF_DESC_FALLBACK: Record<string, string> = {
  "ALUF,PASSD": "F = D (pass IDB through)",
  "ALUF,PASSA": "F = A",
  "ALUF,PASSB": "F = B",
  "ALUF,PASSQ": "F = Q",
  "ALUF,ZERO":  "F = 0",
  "ALUF,INVD":  "F = ~D",
  "ALUF,INVA":  "F = ~A",
  "ALUF,INVB":  "F = ~B",
  "ALUF,INVQ":  "F = ~Q",
  "ALUF,D":     "F = D",
  "ALUF,A":     "F = A",
  "ALUF,B":     "F = B",
  "ALUF,Q":     "F = Q",
  "ALUF,D+1":   "F = D + 1",
  "ALUF,A+1":   "F = A + 1",
  "ALUF,B+1":   "F = B + 1",
  "ALUF,Q+1":   "F = Q + 1",
  "ALUF,D-1":   "F = D - 1",
  "ALUF,A-1":   "F = A - 1",
  "ALUF,B-1":   "F = B - 1",
  "ALUF,Q-1":   "F = Q - 1",
  "ALUF,D+A":   "F = D + A",
  "ALUF,D+Q":   "F = D + Q",
  "ALUF,A+B":   "F = A + B",
  "ALUF,A+Q":   "F = A + Q",
  "ALUF,A+B+1": "F = A + B + 1",
  "ALUF,D+A+1": "F = D + A + 1",
  "ALUF,D+Q+1": "F = D + Q + 1",
  "ALUF,A+Q+1": "F = A + Q + 1",
  "ALUF,ANDDA": "F = D & A",
  "ALUF,ANDDQ": "F = D & Q",
  "ALUF,ANDAB": "F = A & B",
  "ALUF,ANDAQ": "F = A & Q",
  "ALUF,ORDA":  "F = D | A",
  "ALUF,ORDQ":  "F = D | Q",
  "ALUF,ORAB":  "F = A | B",
  "ALUF,ORAQ":  "F = A | Q",
  "ALUF,XORDA": "F = D ^ A",
  "ALUF,XORDQ": "F = D ^ Q",
  "ALUF,XORAB": "F = A ^ B",
  "ALUF,XORAQ": "F = A ^ Q",
};

/** Description of the ALU destination (fallback). */
const ALUD_DEST_FALLBACK: Record<string, string> = {
  "ALUD,Q":    "F → Q register (internal) & F → Y bus",
  "ALUD,NONE": "F → Y bus only (no register write)",
  "ALUD,B":    "F → B register & F → Y bus",
  "ALUD,B,YA": "F → B register, A-register value → Y bus",
  "ALUD,SRD":  "F → Y bus, (F, Q) shifted right /2 → (B, Q)",
  "ALUD,SRB":  "F → Y bus, F/2 → B register",
  "ALUD,SLD":  "F → Y bus, (F, Q) × 2 → (B, Q)",
  "ALUD,SLB":  "F → Y bus, F × 2 → B register",
};

/** COMM commands that consume data from the IDB (fallback). */
const COMM_CONSUMES_IDB_FALLBACK: Record<string, string> = {
  "COMM,LDPIL":  "Load PIL (IDB[8:15] → STATUS[8:15])",
  "COMM,LDGPR":  "Load GPR (IDB → General Purpose Register)",
  "COMM,LDLC":   "Load Loop Counter (IDB[0:5] → LC)",
  "COMM,LDPCR":  "Load Paging Control Register (selected by PIL) ← IDB",
  "COMM,LDSEG":  "Load Segment Register ← IDB",
  "COMM,LDDOMI": "Load SINTRAN-IV Domain Register ← IDB",
  "COMM,LDPS":   "Load SINTRAN-IV PS Register ← IDB",
  "COMM,LDIRV":  "Load Instruction Register (OR-logic) ← IDB",
  "COMM,LDEXM":  "Load Examine Mode ← IDB",
  "COMM,LDPANC": "Send one byte to IR0 (panel character)",
  "COMM,EWRF":   "Register File[A-OP, B-OP] ← IDB",
  "COMM,SMPID":  "Set Micro-PID from IDB (bits where IDB=1 forced to 1)",
  "COMM,SIOC":   "I/O Control Register ← IDB",
  "COMM,WCIHM":  "Write Cache Inhibit Map ← IDB",
};

/** Extract the register-name portion from an `A,X` / `B,X` / `AB,X` token. */
function regName(t: string): string {
  const comma = t.indexOf(",");
  return comma >= 0 ? t.slice(comma + 1) : t;
}

/** Runtime lookup helpers that prefer the YAML-sourced data over fallbacks. */
const runtime = data.runtime;

function idbsRole(name: string): string | undefined {
  return runtime?.idbsSources?.[name] ?? IDBS_ROLE_FALLBACK[name];
}
function alufFormula(name: string): string | undefined {
  return runtime?.alufFormulas?.[name] ?? ALUF_DESC_FALLBACK[name];
}
function aludDescText(name: string): string | undefined {
  const entry = runtime?.aludBehavior?.[name];
  if (entry) {
    const parts: string[] = [];
    if (entry.b_register_write) parts.push(entry.b_register_write);
    else if (entry.q_update) parts.push(entry.q_update);
    else if (entry.y_bus) parts.push(`Y = ${entry.y_bus}`);
    if (entry.note) parts.push(entry.note);
    return parts.join("; ");
  }
  return ALUD_DEST_FALLBACK[name];
}
function commConsumesIdb(name: string): string | undefined {
  const entry = runtime?.commEffects?.[name];
  if (entry) {
    if (entry.reads === "IDB" || entry.reads?.startsWith("IDB")) {
      return entry.writes ?? COMM_CONSUMES_IDB_FALLBACK[name];
    }
  }
  return COMM_CONSUMES_IDB_FALLBACK[name];
}

/**
 * Figure out how a numeric literal is used based on the full token set
 * of the enclosing microinstruction (everything between two `;` markers).
 * Traces the data flow: literal → IDB → ALU → destination register, or
 * handles jump-context / SCOND / COMM-consumed cases.
 */
function interpretNumeric(
  value: number,
  siblingTokens: string[],
): string {
  const toks = new Set(siblingTokens);
  const idbsToken  = siblingTokens.find((t) => t.startsWith("IDBS,"));
  const alufToken  = siblingTokens.find((t) => t.startsWith("ALUF,"));
  const aludToken  = siblingTokens.find((t) => t.startsWith("ALUD,"));
  const aRegToken  = siblingTokens.find(
    (t) => /^A,/.test(t) && !t.startsWith("ALU"),
  );
  const bRegToken  = siblingTokens.find(
    (t) => /^B,/.test(t) && !t.startsWith("ALU"),
  );
  const abRegToken = siblingTokens.find((t) => t.startsWith("AB,"));
  const commToken  = siblingTokens.find((t) => t.startsWith("COMM,"));
  const condToken  = siblingTokens.find((t) => t.startsWith("COND,"));

  const hasScond = condToken !== undefined;
  const isJumpContext =
    toks.has("T,JMP") || toks.has("T,JMP0-3") || toks.has("T,JMPAOPR");

  const oct = "0o" + value.toString(8);
  const dec = value.toString(10);
  const hex = "0x" + value.toString(16).toUpperCase();

  const out: string[] = [];
  out.push(`**Value:** \`${oct}\` (${dec} decimal, ${hex})`);

  // -------------------------------------------------------------------
  // SCOND=1: low 12 bits carry LCC / TSEL / F_SEQ / F_STK.
  // -------------------------------------------------------------------
  if (hasScond) {
    const lcc  = (value >> 8) & 0xF;
    const tsel = (value >> 4) & 0xF;
    const fSeq = (value >> 2) & 0x3;
    const fStk = value & 0x3;
    out.push("\n**Used as:** condition fields (SCOND=1 reinterprets bits 11:0)");
    out.push("");
    out.push("| LCC[11:8] | TSEL[7:4] | F_SEQ[3:2] | F_STK[1:0] |");
    out.push("|:--:|:--:|:--:|:--:|");
    out.push(`| ${lcc} | ${tsel} | ${fSeq} | ${fStk} |`);
    return out.join("\n");
  }

  // -------------------------------------------------------------------
  // Jump context: numeric is a 13-bit branch target.
  // -------------------------------------------------------------------
  if (isJumpContext && value <= 0x1FFF) {
    out.push("\n**Used as:** 13-bit branch target");
    out.push("");
    if (value >= 0x1000) {
      out.push(`- bit 20 (address extension) = **1**`);
      out.push(`- bits 11:0 = \`0o${(value & 0xFFF).toString(8)}\``);
      out.push(`- effective branch address = \`0o${value.toString(8)}\``);
    } else {
      out.push(`- bit 20 = 0, bits 11:0 = \`0o${value.toString(8)}\``);
      out.push(`- branch target = \`0o${value.toString(8)}\``);
    }
    return out.join("\n");
  }

  // -------------------------------------------------------------------
  // Data-flow trace. Everything below follows the value from numeric
  // literal → IDB → ALU → destination, naming each step.
  // -------------------------------------------------------------------

  // A COMM that directly consumes the IDB shortcuts the flow - it
  // doesn't go through the ALU.
  const commConsumesText = commToken ? commConsumesIdb(commToken) : undefined;
  if (commToken && commConsumesText) {
    out.push("\n**Data flow:**");
    out.push("");
    out.push(`1. \`${oct}\` → IDB via \`${idbsToken ?? "IDBS,ARG"}\``);
    out.push(`2. \`${commToken}\` consumes IDB: ${commConsumesText}`);
    return out.join("\n");
  }

  if (idbsToken) {
    // Step 1: value reaches the IDB (if IDBS,ARG or similar takes the
    // microword argument; other IDBS sources ignore our numeric).
    const idbsDesc = idbsRole(idbsToken) ?? idbsToken;
    const numericReachesIdb =
      idbsToken === "IDBS,ARG" || idbsToken === "IDBS,BARG" || idbsToken === "IDBS,AARG";

    out.push("\n**Data flow:**");
    out.push("");
    if (numericReachesIdb) {
      out.push(`1. \`${oct}\` → IDB via \`${idbsToken}\` *(${idbsDesc})*`);
    } else {
      out.push(`1. \`${idbsToken}\` is active → IDB source is **${idbsDesc}**`);
      out.push(`   *(this numeric still ORs into bits 15:0 of the word but is not the IDB producer)*`);
    }

    // Step 2: ALU computation - D is the IDB. Describe what F becomes.
    if (alufToken) {
      const formula = alufFormula(alufToken) ?? alufToken;
      // If the ALUF uses D (or PASSD), and the IDB source is our numeric,
      // we can say "F = <value>". Otherwise just show the formula.
      const aluUsesD = /\bD\b/.test(formula);
      if (aluUsesD && numericReachesIdb) {
        const resolved = formula.replace(/\bD\b/g, oct);
        out.push(`2. ALU: \`${alufToken}\` computes **${resolved}**`);
      } else {
        out.push(`2. ALU: \`${alufToken}\` (${formula})`);
      }
    }

    // Step 3: ALU destination.
    if (aludToken) {
      const destDesc = aludDescText(aludToken) ?? aludToken;
      // If ALUD,B and a B,xxx register is selected, show the final
      // destination register (the dual-role B-port write).
      if (aludToken === "ALUD,B" && bRegToken) {
        const reg = regName(bRegToken);
        out.push(`3. \`${aludToken}\` writes F to B register (dual-role: \`${bRegToken}\` selects **${reg}** as both ALU input and write destination)`);
        out.push("");
        if (alufToken === "ALUF,PASSD" && idbsToken === "IDBS,ARG") {
          out.push(`**Result:** \`${reg}\` register = \`${oct}\``);
        } else {
          out.push(`**Result:** \`${reg}\` register = F`);
        }
        return out.join("\n");
      }
      if (aludToken === "ALUD,Q") {
        out.push(`3. \`${aludToken}\` writes F to **Q register** (internal)`);
        out.push("");
        if (alufToken === "ALUF,PASSD" && idbsToken === "IDBS,ARG") {
          out.push(`**Result:** Q register = \`${oct}\``);
        }
        return out.join("\n");
      }
      out.push(`3. Destination: \`${aludToken}\` - ${destDesc}`);
    }

    // COMM happens alongside the ALU dest but doesn't consume IDB.
    if (commToken) {
      out.push(`4. Also: \`${commToken}\``);
    }
    return out.join("\n");
  }

  // No IDBS at all. If there's still a COMM that consumes the numeric,
  // mention it; otherwise this is just OR'd data.
  const fallbackCommText = commToken ? commConsumesIdb(commToken) : undefined;
  if (commToken && fallbackCommText) {
    out.push(`\n**Used as:** ${fallbackCommText}`);
    return out.join("\n");
  }
  out.push("\n**Used as:** 16-bit literal (OR'd into bits 15:0)");
  out.push("");
  out.push("*No `IDBS,*` in this instruction - the value contributes to the word bits but is not routed onto the IDB this cycle.*");
  void aRegToken; void abRegToken;
  return out.join("\n");
}

function formatTokenHover(entry: TokenEntry): vscode.MarkdownString {
  const config = vscode.workspace.getConfiguration("nd-microcode");
  const showEncoding = config.get<boolean>("hover.showEncoding", true);
  const showModelWarnings = config.get<boolean>(
    "hover.showModelWarnings",
    true,
  );

  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportHtml = false;

  let badge = "";
  if (entry.nd120Only && showModelWarnings) {
    badge = " &nbsp; `[ND-120 only]`";
  } else if (entry.models.length > 1) {
    badge = " &nbsp; `[ND-110 + ND-120]`";
  } else {
    badge = ` &nbsp; \`[${entry.models.join(", ").toUpperCase()}]\``;
  }
  md.appendMarkdown(`**\`${entry.name}\`**${badge}\n\n`);

  if (entry.description) {
    md.appendMarkdown(`${entry.description}\n\n`);
  }

  const lineNames: Record<number, string> = {
    1: "Line 1 (registers / ALU)",
    2: "Line 2 (bus / command / T-seq)",
    3: "Line 3 (branch / condition)",
  };
  md.appendMarkdown(
    `*Category: \`${entry.category}\`* &nbsp;&middot;&nbsp; ` +
    `*${lineNames[entry.displayLine] ?? "Line ?"}*\n\n`,
  );

  if (entry.provides || entry.requires) {
    const parts: string[] = [];
    if (entry.provides) parts.push(`provides ${entry.provides}`);
    if (entry.requires) parts.push(`requires ${entry.requires}`);
    md.appendMarkdown(`*${parts.join(", ")}*\n\n`);
  }

  if (showEncoding) {
    const { w4, w3, w2, w1 } = entry.encoding;
    md.appendMarkdown(
      "| w4 (63:48) | w3 (47:32) | w2 (31:16) | w1 (15:0) |\n" +
      "|:--:|:--:|:--:|:--:|\n" +
      `| \`${w4}\` | \`${w3}\` | \`${w2}\` | \`${w1}\` |\n`,
    );
  }

  return md;
}

function formatNumericHover(
  word: string,
  value: number,
  siblingTokens: string[],
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportHtml = false;
  md.appendMarkdown(`**\`${word}\`** &nbsp; *numeric literal*\n\n`);
  md.appendMarkdown(interpretNumeric(value, siblingTokens));
  return md;
}

export function registerHoverProvider(): vscode.Disposable {
  return vscode.languages.registerHoverProvider(
    { language: "uc" },
    {
      provideHover(document, position) {
        const range = wordRangeAtPosition(document, position);
        if (!range) return undefined;
        const word = document.getText(range);

        // Token lookup wins first.
        const entry = data.tokens[word];
        if (entry) {
          return new vscode.Hover(formatTokenHover(entry), range);
        }

        // Is this a numeric? Gather tokens from the SAME instruction
        // (between the enclosing `;` markers) and interpret.
        if (NUMERIC_RE.test(word)) {
          const value = parseNumeric(word);
          if (value === undefined || !Number.isFinite(value)) return undefined;
          const siblings = extractInstructionTokens(document, position);
          return new vscode.Hover(
            formatNumericHover(word, value, siblings),
            range,
          );
        }

        return undefined;
      },
    },
  );
}
