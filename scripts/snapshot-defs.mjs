#!/usr/bin/env node
/**
 * Snapshot the repository's defs/ YAML files into a compact JSON
 * (src/generated/definitions.json) that the extension can load without
 * touching the filesystem at runtime.
 *
 * This lets the extension ship in a .vsix without requiring the
 * parent-directory YAML files to be available.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");
const META = resolve(REPO_ROOT, "external", "meta");

function load(relPath) {
  return yamlLoad(readFileSync(resolve(META, relPath), "utf8"));
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  nd110Tokens: load("defs/tokens/nd110-tokens.yaml"),
  nd120Tokens: load("defs/tokens/nd120-tokens.yaml"),
  nd110Fields: load("defs/fields/nd110-fields.yaml"),
  nd120Fields: load("defs/fields/nd120-fields.yaml"),
};

const outDir = resolve(here, "..", "src", "generated");
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, "definitions.json"),
  JSON.stringify(snapshot),
);
console.log(`Snapshot: ND-110=${snapshot.nd110Tokens.tokens.length} tokens, ND-120=${snapshot.nd120Tokens.tokens.length} tokens`);
