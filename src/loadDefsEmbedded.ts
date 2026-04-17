/**
 * Load DefinitionPacks from the embedded snapshot (src/generated/
 * definitions.json) instead of reading YAML at runtime.
 *
 * This is what the extension uses in production - the snapshot is
 * bundled into the .vsix by the build, so the extension doesn't need
 * to know where the parent repo's defs/ directory lives.
 */

import definitionsSnapshot from "./generated/definitions.json";
import type {
  DefinitionPack,
  Model,
  Token,
  TokenCategory,
  FieldDef,
} from "@nd100uc/microcode";
import { encodingToBigInt } from "@nd100uc/microcode";

interface RawEncoding { w1: string; w2: string; w3: string; w4: string; }
interface RawToken {
  token: string;
  category: string;
  display_line: number;
  encoding: RawEncoding;
  description?: string;
  provides?: string;
  requires?: string;
  nd120_only?: boolean;
  models?: string[];
}
interface RawTokenDoc { model: string; tokens: RawToken[]; }
interface RawFieldDef {
  bits: [number, number];
  width: number;
  description: string;
  default?: number;
}
interface RawFieldDoc { fields?: Record<string, RawFieldDef>; }

interface Snapshot {
  nd110Tokens: RawTokenDoc;
  nd120Tokens: RawTokenDoc;
  nd110Fields: RawFieldDoc;
  nd120Fields: RawFieldDoc;
}

const snap = definitionsSnapshot as unknown as Snapshot;

const VALID_CATEGORIES: TokenCategory[] = [
  "A_REG", "B_REG", "AB_REG", "PIC", "ALUF", "ALUD", "ALUM",
  "STS", "CRY", "MIS", "IDBS", "COMM",
  "T_SEQ", "T_STK", "F_SEQ", "F_STK",
  "COND", "SPECIAL", "UNKNOWN",
];

function toCategory(s: string): TokenCategory {
  return (VALID_CATEGORIES as string[]).includes(s)
    ? (s as TokenCategory)
    : "UNKNOWN";
}

function toModels(raw: string[] | undefined): Model[] {
  if (!raw) return ["nd100", "nd110", "nd120"];
  return raw.filter((m): m is Model =>
    m === "nd100" || m === "nd110" || m === "nd120",
  );
}

function toToken(raw: RawToken): Token {
  const displayLine = raw.display_line;
  if (displayLine !== 1 && displayLine !== 2 && displayLine !== 3) {
    throw new Error(`Token ${raw.token} has invalid display_line: ${displayLine}`);
  }
  return {
    name: raw.token,
    category: toCategory(raw.category),
    displayLine,
    description: raw.description ?? "",
    encodingOctal: [
      raw.encoding.w4,
      raw.encoding.w3,
      raw.encoding.w2,
      raw.encoding.w1,
    ],
    encodingValue: encodingToBigInt(
      raw.encoding.w4,
      raw.encoding.w3,
      raw.encoding.w2,
      raw.encoding.w1,
    ),
    models: toModels(raw.models),
    nd120Only: raw.nd120_only === true,
    provides: raw.provides,
    requires: raw.requires,
  };
}

function toFields(raw: RawFieldDoc | undefined): Map<string, FieldDef> {
  const m = new Map<string, FieldDef>();
  if (!raw?.fields) return m;
  for (const [name, f] of Object.entries(raw.fields)) {
    m.set(name, {
      name,
      bits: [f.bits[0], f.bits[1]],
      width: f.width,
      description: f.description,
      default: f.default ?? 0,
    });
  }
  return m;
}

let cachedPacks: Partial<Record<Model, DefinitionPack>> = {};

export function loadEmbeddedDefinitions(model: Model): DefinitionPack {
  const cached = cachedPacks[model];
  if (cached) return cached;

  const rawTokens =
    model === "nd120" ? snap.nd120Tokens.tokens : snap.nd110Tokens.tokens;
  const tokens = rawTokens.map(toToken);

  // Fields: start with ND-110 as the base and overlay ND-120 deltas.
  const fields = toFields(snap.nd110Fields);
  if (model === "nd120") {
    for (const [name, def] of toFields(snap.nd120Fields)) {
      fields.set(name, def);
    }
  }

  const tokensByName = new Map<string, Token>();
  const tokensByCategory = new Map<TokenCategory, Token[]>();
  for (const t of tokens) {
    tokensByName.set(t.name, t);
    const existing = tokensByCategory.get(t.category);
    if (existing) existing.push(t);
    else tokensByCategory.set(t.category, [t]);
  }

  const pack: DefinitionPack = {
    model,
    tokens,
    tokensByName,
    tokensByCategory,
    fields,
  };
  cachedPacks[model] = pack;
  return pack;
}
