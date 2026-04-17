#!/usr/bin/env node
/**
 * Bundle the VSCode extension into a single out/extension.js via esbuild.
 *
 * This pulls in @nd100uc/microcode (which is a local file: dependency)
 * as source into the bundle, avoiding the "invalid relative path"
 * error that vsce gives when it tries to include file-linked packages.
 */

import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// The TS library ships .js files from lib/ts/dist - we need that built
// first. When bundling from TS sources, point at the original .ts files
// so esbuild can transform them.
await esbuild.build({
  entryPoints: [resolve(root, "src", "extension.ts")],
  bundle: true,
  outfile: resolve(root, "out", "extension.js"),
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  minify: false,
  loader: { ".json": "json", ".yaml": "text" },
  // Our TS library reads defs/tokens/*.yaml at runtime via readFileSync.
  // We keep that runtime behaviour; the yaml files travel in the .vsix
  // via .vscodeignore allowlisting.
});

console.log("Bundled extension to out/extension.js");
