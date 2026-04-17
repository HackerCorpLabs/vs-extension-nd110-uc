#!/usr/bin/env node
/**
 * Generate the hover-data JSON consumed by the VSCode extension.
 *
 * Reads defs/tokens/nd110-tokens.yaml and defs/tokens/nd120-tokens.yaml
 * and produces src/generated/token-hover.json - a flat lookup table
 * keyed by token name. Each entry carries the description, models,
 * category, and (for ND-120-only) a marker flag.
 *
 * Re-run whenever the YAML changes:
 *   node scripts/generate-hover-data.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");

// YAML source: the nd-microcode-meta submodule at external/meta/
const META = resolve(REPO_ROOT, "external", "meta");

function load(relPath) {
  const text = readFileSync(resolve(META, relPath), "utf8");
  return yamlLoad(text);
}

const nd110 = load("defs/tokens/nd110-tokens.yaml");
const nd120 = load("defs/tokens/nd120-tokens.yaml");
const runtime = load("defs/runtime/data-flow.yaml");

// Build a union keyed by token name. ND-120 overrides ND-110 when the
// token exists in both (the encodings may differ by timing-bit variants).
const entries = new Map();

function addToken(t, sourceModel) {
  const existing = entries.get(t.token);
  if (existing) {
    // Merge: add the new model's availability.
    if (!existing.models.includes(sourceModel)) {
      existing.models.push(sourceModel);
    }
    return;
  }
  entries.set(t.token, {
    name: t.token,
    category: t.category,
    displayLine: t.display_line,
    description: t.description ?? "",
    models: [sourceModel],
    nd120Only: t.nd120_only === true,
    provides: t.provides,
    requires: t.requires,
    encoding: t.encoding,
  });
}

for (const t of nd110.tokens) addToken(t, "nd110");
for (const t of nd120.tokens) addToken(t, "nd120");

// Flag ND-120-only tokens explicitly based on which models the token
// is available in.
for (const entry of entries.values()) {
  entry.nd120Only = entry.models.length === 1 && entry.models[0] === "nd120";
}

const outDir = resolve(here, "..", "src", "generated");
mkdirSync(outDir, { recursive: true });

const output = {
  generatedFrom: "defs/tokens/nd110-tokens.yaml + nd120-tokens.yaml + defs/runtime/data-flow.yaml",
  generatedAt: new Date().toISOString(),
  tokenCount: entries.size,
  tokens: Object.fromEntries(
    [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)),
  ),
  // Runtime semantics for context-aware hover. Keyed by token name.
  runtime: {
    alufFormulas: runtime.aluf_formulas ?? {},
    idbsSources: runtime.idbs_sources ?? {},
    commEffects: runtime.comm_effects ?? {},
    aludBehavior: runtime.alud_behavior ?? {},
    aluSources: runtime.alu_sources ?? {},
  },
};

writeFileSync(
  resolve(outDir, "token-hover.json"),
  JSON.stringify(output, null, 2) + "\n",
);

// Also emit a list of ND-120-only names for fast matching in the grammar
// generator.
const nd120OnlyNames = [...entries.values()]
  .filter((e) => e.nd120Only)
  .map((e) => e.name)
  .sort();

writeFileSync(
  resolve(outDir, "nd120-only-tokens.json"),
  JSON.stringify(nd120OnlyNames, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Also generate syntaxes/uc.tmLanguage.json so the highlighter stays in
// sync with the canonical YAML token set.
// ---------------------------------------------------------------------------

/**
 * Escape a token name for use in a TextMate regex.
 * Tokens can contain special chars: `,` `+` `-` `*` `=` `0` (in F=0).
 */
function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\=]/g, "\\$&");
}

function groupPattern(tokens) {
  // Sort longer first so that e.g. `COMM,AWRITE,NEXT` matches before
  // `COMM,AWRITE,*` (which is a prefix of it in TextMate's regex engine).
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  return sorted.map(escapeForRegex).join("|");
}

function category(predicate) {
  return [...entries.values()].filter(predicate).map((e) => e.name);
}

const aReg = category((e) => e.category === "A_REG");
const bReg = category((e) => e.category === "B_REG");
const abReg = category((e) => e.category === "AB_REG");
const pic = category((e) => e.category === "PIC");
const aluf = category((e) => e.category === "ALUF");
const alud = category((e) => e.category === "ALUD");
const alum = category((e) => e.category === "ALUM");
const sts = category((e) => e.category === "STS");
const cry = category((e) => e.category === "CRY");
const mis = category((e) => e.category === "MIS");
const idbs = category((e) => e.category === "IDBS" && !e.nd120Only);
const idbsNd120 = category((e) => e.category === "IDBS" && e.nd120Only);
const comm = category((e) => e.category === "COMM" && !e.nd120Only);
const commNd120 = category((e) => e.category === "COMM" && e.nd120Only);
const abNd120 = category((e) => e.category === "AB_REG" && e.nd120Only);
const tSeq = category((e) => e.category === "T_SEQ");
const tStk = category((e) => e.category === "T_STK");
const fSeq = category((e) => e.category === "F_SEQ");
const fStk = category((e) => e.category === "F_STK");
const cond = category((e) => e.category === "COND");
const special = category((e) => e.category === "SPECIAL");

const grammar = {
  $schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  scopeName: "source.uc",
  name: "ND-100/110/120 MicroCode",
  patterns: [
    { include: "#comments" },
    { include: "#labels" },
    { include: "#addressMarker" },
    { include: "#nd120Only" },
    { include: "#opcodes" },
    { include: "#end" },
    { include: "#numerics" },
  ],
  repository: {
    comments: {
      patterns: [
        { match: "(%).*$", name: "comment.line.percent.uc" },
      ],
    },
    labels: {
      patterns: [
        { match: "^\\s*([A-Z_][A-Z0-9_]*):", name: "entity.name.function.label.uc" },
      ],
    },
    addressMarker: {
      patterns: [
        { match: "^\\s*([0-7]+)/", name: "entity.name.section.address.uc" },
      ],
    },
    end: {
      patterns: [{ match: ";", name: "punctuation.terminator.statement.uc" }],
    },
    // ND-120-only opcodes get a distinct scope so they can be coloured
    // differently in user themes.
    nd120Only: {
      patterns: [
        {
          match: `\\b(?:${groupPattern([...commNd120, ...idbsNd120, ...abNd120])})\\b`,
          name: "keyword.other.nd120-only.uc",
        },
      ],
    },
    opcodes: {
      patterns: [
        { include: "#AB_REG" },
        { include: "#A_REG" },
        { include: "#B_REG" },
        { include: "#PIC" },
        { include: "#ALUF" },
        { include: "#ALUD" },
        { include: "#ALUM" },
        { include: "#STS" },
        { include: "#CRY" },
        { include: "#MIS" },
        { include: "#IDBS" },
        { include: "#COMM" },
        { include: "#TF" },
        { include: "#COND" },
        { include: "#SPECIAL" },
      ],
    },
    AB_REG: {
      patterns: [{ match: `\\b(?:${groupPattern(abReg)})\\b`, name: "keyword.operator.ab.uc" }],
    },
    A_REG: {
      patterns: [{ match: `\\b(?:${groupPattern(aReg)})\\b`, name: "keyword.operator.a.uc" }],
    },
    B_REG: {
      patterns: [{ match: `\\b(?:${groupPattern(bReg)})\\b`, name: "keyword.operator.b.uc" }],
    },
    PIC: {
      patterns: [{ match: `\\b(?:${groupPattern(pic)})\\b`, name: "keyword.operator.pic.uc" }],
    },
    ALUF: {
      patterns: [{ match: `\\b(?:${groupPattern(aluf)})`, name: "keyword.operator.aluf.uc" }],
    },
    ALUD: {
      patterns: [{ match: `\\b(?:${groupPattern(alud)})\\b`, name: "keyword.operator.alud.uc" }],
    },
    ALUM: {
      patterns: [{ match: `\\b(?:${groupPattern(alum)})\\b`, name: "keyword.operator.alum.uc" }],
    },
    STS: {
      patterns: [{ match: `\\b(?:${groupPattern(sts)})\\b`, name: "keyword.operator.sts.uc" }],
    },
    CRY: {
      patterns: [{ match: `\\b(?:${groupPattern(cry)})\\b`, name: "keyword.operator.cry.uc" }],
    },
    MIS: {
      patterns: [{ match: `\\b(?:${groupPattern(mis)})\\b`, name: "keyword.operator.mis.uc" }],
    },
    IDBS: {
      patterns: [{ match: `\\b(?:${groupPattern(idbs)})\\b`, name: "keyword.operator.idbs.uc" }],
    },
    COMM: {
      patterns: [{ match: `\\b(?:${groupPattern(comm)})`, name: "keyword.operator.comm.uc" }],
    },
    TF: {
      patterns: [
        { match: `\\b(?:${groupPattern([...tSeq, ...tStk, ...fSeq, ...fStk])})`, name: "keyword.control.tf.uc" },
      ],
    },
    COND: {
      patterns: [{ match: `\\b(?:${groupPattern(cond)})`, name: "keyword.control.cond.uc" }],
    },
    SPECIAL: {
      patterns: [
        { match: "\\b(CONDENABL)\\b", name: "keyword.control.condenable.uc" },
        { match: "\\b(LCOUNT|XRF|CONT)\\b", name: "keyword.other.special.uc" },
      ],
    },
    numerics: {
      patterns: [
        { match: "#?-?(0x|&)[0-9a-fA-F_]+\\b", name: "constant.numeric.hex.uc" },
        { match: "\\b[0-7]+\\b", name: "constant.numeric.oct.uc" },
        { match: "#?0b[01]+\\b", name: "constant.numeric.bin.uc" },
      ],
    },
  },
};

const grammarPath = resolve(here, "..", "syntaxes", "uc.tmLanguage.json");
writeFileSync(grammarPath, JSON.stringify(grammar, null, 2) + "\n");

console.log(`Wrote ${entries.size} token entries to src/generated/token-hover.json`);
console.log(`Wrote grammar (${Object.keys(grammar.repository).length} patterns) to syntaxes/uc.tmLanguage.json`);
console.log(`ND-120-only tokens: ${nd120OnlyNames.length}`);
console.log(`  ${nd120OnlyNames.join(", ")}`);
