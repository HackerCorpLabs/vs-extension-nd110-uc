# ND-100/110/120 Microcode - VSCode Extension

Syntax highlighting, hover documentation, and assembly/disassembly
commands for ND-100/110/120 microcode (`.uc`) files.

Part of the [nd100uc toolchain](https://github.com/HackerCorpLabs/nd100uc).
Uses the shared [nd-microcode-meta](https://github.com/HackerCorpLabs/nd-microcode-meta)
submodule for token definitions and the TypeScript library.

## Features

- **Syntax highlighting** for all three models (299 ND-100, 357 ND-110,
  358 ND-120 tokens). ND-120-only tokens use a distinct scope
  (`keyword.other.nd120-only.uc`) for visual differentiation.

- **Hover documentation.** Hover any token to see its description,
  category, model availability, display line, and octal encoding.

- **Context-aware numeric hover.** Hover a numeric literal to see how
  it will be used based on surrounding tokens (branch target, data
  literal, condition field, etc.).

- **Commands** (powered by `@nd100uc/microcode`):
  - Assemble current `.uc` file to `.CODE`
  - Assemble and split into ROM chip images (HIGH/LOW)
  - Import binary and disassemble
  - Show assembled bits for current instruction
  - Open live bit-breakdown view (side panel)

- **Model selection** via `%#MODEL nd110` / `%#MODEL nd120` comment in
  the source, or the `nd-microcode.defaultModel` setting.

- **YAML-driven.** All token metadata is generated from the canonical
  YAML definitions in the submodule. Run `npm run generate` to
  regenerate after YAML changes.

## Install from source

```bash
git clone --recurse-submodules https://github.com/HackerCorpLabs/vs-extension-nd110-uc.git
cd vs-extension-nd110-uc

# Build the shared TS library (in the submodule)
cd external/meta/lib/ts && npm ci && npm run build && cd ../../../..

# Build the extension
npm install
npm run build

# Package
npm run package          # produces nd-microcode.vsix
code --install-extension nd-microcode.vsix
```

## Settings

| Key | Default | Description |
|-----|---------|-------------|
| `nd-microcode.hover.showEncoding` | `true` | Show raw octal encoding in hover |
| `nd-microcode.hover.showModelWarnings` | `true` | Highlight ND-120-only tokens |
| `nd-microcode.defaultModel` | `"nd110"` | Default model when source has no `%#MODEL` comment |

## Repository layout

| Path                                    | Purpose                                                   |
|-----------------------------------------|-----------------------------------------------------------|
| `external/meta/`                        | Submodule: [nd-microcode-meta](https://github.com/HackerCorpLabs/nd-microcode-meta) |
| `external/meta/lib/ts/`                 | TypeScript library (`@nd100uc/microcode`)                 |
| `external/meta/defs/`                   | YAML token/field definitions (source of truth)            |
| `src/extension.ts`                      | Extension entry point                                     |
| `src/hoverProvider.ts`                  | Token + numeric hover logic                               |
| `src/commands.ts`                       | VSCode command handlers                                   |
| `src/bitView.ts`                        | Side panel for 64-bit word breakdown                      |
| `src/loadDefsEmbedded.ts`              | Loads pre-generated definitions snapshot                  |
| `src/generated/`                        | Generated JSON (token-hover, definitions snapshot)        |
| `scripts/generate-hover-data.mjs`       | Generates hover JSON + TextMate grammar from YAML         |
| `scripts/snapshot-defs.mjs`             | Generates definitions snapshot from YAML                  |
| `syntaxes/uc.tmLanguage.json`           | TextMate grammar (generated)                              |

## Regenerating from YAML

When the YAML definitions in the submodule change:

```bash
npm run generate       # regenerate JSON + grammar from YAML
npm run build          # generate + compile + bundle
npm run package        # produce .vsix
```

See [`docs/generate-from-yaml.md`](docs/generate-from-yaml.md) for the
full pipeline documentation.

## Related repos

| Repo | Description |
|------|-------------|
| [nd100uc](https://github.com/HackerCorpLabs/nd100uc) | Web viewer, ROM combiners, build pipeline |
| [nd-microcode-meta](https://github.com/HackerCorpLabs/nd-microcode-meta) | Shared submodule: YAML definitions, TS library, reference ROMs |

## License

MIT - see [LICENSE](LICENSE).
