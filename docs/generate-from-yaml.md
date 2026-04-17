# Generating TypeScript data from the YAML metadata

The VSCode extension is **100% YAML-driven**. None of the token names,
encodings, syntax-highlight regexes, hover descriptions, or runtime
data-flow information are hand-written in TypeScript. Instead, all of
that lives under `repo-root/defs/` in human-readable
YAML and gets compiled into three JSON files + one TextMate grammar
that the extension ships with.

This document describes the pipeline, the YAML inputs, the generated
outputs, and how to regenerate everything after editing the YAML.

---

## 1. Quick start

```bash
cd repo-root/vscode-extension
npm install          # first time only
npm run build        # regenerate + compile + bundle
npm run package      # produce nd-microcode.vsix
```

`npm run build` runs three scripts in order:

| Step | Script                              | Produces                                                                 |
|------|-------------------------------------|--------------------------------------------------------------------------|
| 1    | `scripts/generate-hover-data.mjs`   | `src/generated/token-hover.json`, `src/generated/nd120-only-tokens.json`, `syntaxes/uc.tmLanguage.json` |
| 2    | `scripts/snapshot-defs.mjs`         | `src/generated/definitions.json`                                          |
| 3    | `scripts/build-bundle.mjs`          | `out/extension.js` (single-file bundle via esbuild)                      |

Step 1 produces the **hover metadata** and the **syntax grammar**.
Step 2 produces the **definition pack** used by the assembler/
disassembler at runtime. Step 3 bundles everything into the final
extension JS.

---

## 2. Input YAML files

Located under `repo-root/defs/`:

| File                                  | Purpose                                                           |
|---------------------------------------|-------------------------------------------------------------------|
| `tokens/nd110-tokens.yaml`            | 356 ND-110 tokens with octal encodings                            |
| `tokens/nd120-tokens.yaml`            | 358 ND-120 tokens (12 ND-120-only are marked)                     |
| `fields/nd110-fields.yaml`            | Bit-field definitions for ND-110 (bit ranges, widths)             |
| `fields/nd120-fields.yaml`            | ND-120 deltas / overrides                                         |
| `runtime/data-flow.yaml`              | Runtime semantics - ALU formulas, IDBS sources, COMM effects, etc |
| `format/assembly-format.yaml`         | 3-line layout rules, zero-display conventions                     |
| `common/registers.yaml`               | Shared register naming                                            |
| `common/conditions.yaml`              | Shared condition codes                                            |

### Token YAML entry shape

```yaml
- token: "ALUF,PASSD"
  category: ALUF
  display_line: 1
  encoding: { w4: "015600", w3: "000000", w2: "000000", w1: "000000" }
  description: "D -> F"
  provides: ""
  requires: ""
  nd120_only: false
  models: [nd100, nd110, nd120]
```

### Runtime data-flow entry shape

```yaml
aluf_formulas:
  "ALUF,PASSD": "F = D"
  "ALUF,A+B":   "F = A + B"
  ...

alud_behavior:
  3:   # ALUD,B
    name: RAMF
    y_bus: F
    b_register_write: "Reg[BOP] := F"
    shift: none
    note: "..."

idbs_sources:
  "IDBS,ARG": "microinstruction bits 15:0 (the literal from source)"
  ...

comm_effects:
  "COMM,LDGPR":
    reads: IDB
    writes: "GPR register"
    uses_a: false
    uses_b: false
  ...
```

---

## 3. Generator output

### 3.1 `src/generated/token-hover.json`

The primary data file consumed by `src/hoverProvider.ts`.

```jsonc
{
  "generatedFrom": "defs/tokens/nd110-tokens.yaml + nd120-tokens.yaml + defs/runtime/data-flow.yaml",
  "generatedAt": "2026-04-16T10:35:00.000Z",
  "tokenCount": 368,
  "tokens": {
    "ALUF,PASSD": {
      "name": "ALUF,PASSD",
      "category": "ALUF",
      "displayLine": 1,
      "description": "D -> F",
      "models": ["nd110", "nd120"],
      "nd120Only": false,
      "encoding": { "w1": "000000", "w2": "000000", "w3": "000000", "w4": "015600" }
    }
  },
  "runtime": {
    "alufFormulas": { "ALUF,PASSD": "F = D", ... },
    "idbsSources":  { "IDBS,ARG": "...", ... },
    "commEffects":  { "COMM,LDGPR": { reads: "IDB", writes: "GPR register", ... }, ... },
    "aludBehavior": { "3": { name: "RAMF", y_bus: "F", b_register_write: "Reg[BOP] := F" }, ... },
    "aluSources":   { "0": { name: "A_Q", R: "A register", S: "Q (internal)", am2901: "AQ" }, ... }
  }
}
```

### 3.2 `src/generated/nd120-only-tokens.json`

A simple list of the ND-120-only token names (for quick checks):

```json
["AB,BAUD", "AB,NOISE", "AB,OLD303", "COMM,MACL", "COMM,SLOW",
 "COMM,UART,COM", "COMM,UART,DATA", "COMM,UART,MODE",
 "COMM,UART,STATUS", "COMM,XSLOW", "IDBS,PICM", "IDBS,UART"]
```

### 3.3 `src/generated/definitions.json`

A compact snapshot of the full YAML token tables + field definitions
used by the **assembler/disassembler** (when invoked from extension
commands like "Assemble current .uc file"). See `src/loadDefsEmbedded.ts`
for how it's consumed - it reconstructs a full `DefinitionPack` in
memory without needing any filesystem access.

### 3.4 `syntaxes/uc.tmLanguage.json`

TextMate grammar for syntax highlighting. Regenerated from the tokens
YAML every time. Contains ~22 repository patterns, one per token
category (A_REG, B_REG, AB_REG, ALUF, IDBS, COMM, ...) plus a special
`nd120Only` pattern with a distinct scope for the 12 ND-120-only
opcodes.

Never edit this file by hand - your changes will be overwritten on
the next `npm run generate`.

---

## 4. Workflow: editing YAML and propagating to the extension

### Scenario A: fixing a token description or encoding

1. Edit the relevant token in
   `repo-root/defs/tokens/nd110-tokens.yaml`
   (or `nd120-tokens.yaml` for ND-120-only entries).
2. Regenerate + rebuild:
   ```bash
   cd vscode-extension
   npm run build
   ```
3. If only testing inside VSCode's extension dev host, press `F5` to
   launch it - the bundle is reloaded automatically.
4. To ship the change, package and reinstall:
   ```bash
   npm run package
   code --install-extension nd-microcode.vsix
   ```

### Scenario B: adding a new runtime semantic

Want to teach the hover what `COMM,FOO` does?

1. Edit `repo-root/defs/runtime/data-flow.yaml` and
   add to the appropriate section:
   ```yaml
   comm_effects:
     "COMM,FOO":
       reads: IDB
       writes: "My special register"
       uses_a: true
   ```
2. Run `npm run generate && npm run compile` (or `npm run build`).
3. The generator copies the new `comm_effects` entry into
   `src/generated/token-hover.json` under `runtime.commEffects`.
4. `src/hoverProvider.ts` reads the data via the `commConsumesIdb()`
   helper - no TypeScript changes needed to pick up the new command.

### Scenario C: adding new ALUF formulas

1. Add to `aluf_formulas` in `defs/runtime/data-flow.yaml`:
   ```yaml
   aluf_formulas:
     "ALUF,MY_OP": "F = A + Q + D"
   ```
2. Regenerate. Hover will now show the formula, and if the formula
   contains `D` the extension will substitute the numeric literal
   value when `IDBS,ARG` is active.

### Scenario D: regenerating the syntax grammar

The grammar is regenerated from the tokens YAML automatically when
you run `npm run generate`. If you add a new token to the YAML, it
gets a syntax-highlight rule. If the new token is marked
`nd120_only: true`, it gets the ND-120-only scope.

Custom theme scopes live in `syntaxes/uc.tmLanguage.json` - see
`vscode-extension/README.md` for the full table.

---

## 5. Generator script internals

### `generate-hover-data.mjs`

Read-path:
```
defs/tokens/nd110-tokens.yaml   ─┐
defs/tokens/nd120-tokens.yaml   ─┤
defs/runtime/data-flow.yaml     ─┤
                                 │
                                 ▼
                  generate-hover-data.mjs
                                 │
                                 ▼
     ┌──────────────────┬──────────────────┐
     ▼                  ▼                  ▼
token-hover.json  nd120-only.json  uc.tmLanguage.json
```

Key functions in the script:

- `addToken(t, sourceModel)` - builds the token record, merging
  ND-110 + ND-120 entries by name and deriving the `models` array.
- `escapeForRegex(s)` - escapes token names for use in TextMate regex
  (handles `,`, `+`, `-`, `*`, `=`).
- `groupPattern(tokens)` - sorts tokens by length descending (so
  longer matches like `COMM,AWRITE,NEXT` win over `COMM,AWRITE,*`)
  and produces a regex alternation.
- `category(predicate)` - filter helper that selects tokens for a
  given category/flag combination.

The grammar builder produces 20+ named patterns in `repository`
(`A_REG`, `B_REG`, `AB_REG`, `PIC`, `ALUF`, `ALUD`, `ALUM`, `STS`,
`CRY`, `MIS`, `IDBS`, `COMM`, `TF`, `COND`, `SPECIAL`, `nd120Only`,
`comments`, `labels`, `addressMarker`, `end`, `numerics`).

### `snapshot-defs.mjs`

A minimal script that reads the token + field YAML and emits a
single `definitions.json` with the raw YAML structure preserved.
`src/loadDefsEmbedded.ts` then reconstructs the full `DefinitionPack`
(including BigInt encodingValue) from this snapshot.

### `build-bundle.mjs`

Runs esbuild with entry point `src/extension.ts` and produces
`out/extension.js`. Everything from `@nd100uc/microcode` gets inlined
into the bundle so the `.vsix` is self-contained.

---

## 6. Debugging

### "I edited the YAML but nothing changed"

1. Run `npm run build` - just editing the YAML doesn't auto-regenerate.
2. If VSCode is running the dev extension, reload the window
   (`Ctrl+Shift+P` → "Developer: Reload Window").
3. If you installed the `.vsix`, run `npm run package` and reinstall
   with `code --install-extension nd-microcode.vsix`.

### "The grammar pattern doesn't match my new token"

Check the generator's escape logic. If the token name contains a
character not in `[A-Z0-9,+\-*=_]` (the `TOKEN_CHAR_RE` in
`hoverProvider.ts`), hover won't pick it up as a word either. Extend
`TOKEN_CHAR_RE` and `escapeForRegex` together.

### "Runtime data is missing for my token"

Check that `defs/runtime/data-flow.yaml` has the entry. Verify by:

```bash
node -e 'const d = JSON.parse(require("fs").readFileSync("src/generated/token-hover.json")); console.log(d.runtime.commEffects["COMM,MY_NEW"])'
```

If that's undefined after regeneration, the YAML wasn't parsed as
expected - look for a typo / missing quote / wrong indentation.

### "esbuild warning about import.meta"

Harmless. The upstream library has a `findDefsRoot()` helper that
uses `import.meta.url`, but the extension never calls it (it uses
`loadDefsEmbedded.ts` instead). Esbuild doesn't know this and warns.
The warning can be silenced with:

```js
// in build-bundle.mjs, pass:
logLevel: "error"
```

---

## 7. Validating generated data

After regenerating, quick sanity checks:

```bash
cd vscode-extension

# Count tokens
node -e 'console.log(JSON.parse(require("fs").readFileSync("src/generated/token-hover.json")).tokenCount)'

# Check a specific token
node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync("src/generated/token-hover.json")).tokens["COMM,LDLC"], null, 2))'

# Check runtime data
node -e 'const d = JSON.parse(require("fs").readFileSync("src/generated/token-hover.json")); console.log("runtime sections:", Object.keys(d.runtime)); console.log("aluf formula count:", Object.keys(d.runtime.alufFormulas).length); console.log("comm effect count:", Object.keys(d.runtime.commEffects).length)'

# List ND-120-only tokens
cat src/generated/nd120-only-tokens.json | jq .
```

For a fuller cross-check, run the root project's YAML validator:

```bash
cd repo-root
python3 tools/yaml-validator/validate.py
```

This verifies that the YAML encodings are internally consistent,
that the ND-110/ND-120 token-set delta matches expectations, and
that the encodings line up with the reference `.CODE` binaries.

---

## 8. File relationships (summary)

```
┌─────────────────────────────────────┐
│ repo-root/defs/     │
│                                     │
│  tokens/*.yaml                      │
│  fields/*.yaml                      │
│  runtime/data-flow.yaml     ← EDIT HERE
│  format/*.yaml                      │
│  common/*.yaml                      │
└──────────────────┬──────────────────┘
                   │
                   │ npm run generate
                   ▼
┌─────────────────────────────────────┐
│ vscode-extension/src/generated/     │
│                                     │
│  token-hover.json                   │
│  nd120-only-tokens.json             │
│  definitions.json                   │
└──────────────────┬──────────────────┘
                   │
                   │ npm run compile + bundle
                   ▼
┌─────────────────────────────────────┐
│ vscode-extension/out/               │
│                                     │
│  extension.js (bundled, ships)     │
│                                     │
│ vscode-extension/syntaxes/          │
│  uc.tmLanguage.json (generated)     │
└──────────────────┬──────────────────┘
                   │
                   │ npm run package
                   ▼
             nd-microcode.vsix
```

The golden rule: **never edit files under `src/generated/` or
`syntaxes/uc.tmLanguage.json` directly**. They are outputs. Edit
the YAML under `repo-root/defs/`, then regenerate.
