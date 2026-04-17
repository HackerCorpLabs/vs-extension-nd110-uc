# Change Log

All notable changes to the `nd-microcode` VSCode extension.

## 0.1.0 - 2026-04-16

Major upgrade: full ND-100/110/120 support with intelligent hover docs.

### Added

- **ND-120 support.** All 358 ND-120 tokens are recognised. The 12
  ND-120-only opcodes (`COMM,MACL`, `COMM,UART,*`, `IDBS,PICM`,
  `IDBS,UART`, `AB,BAUD`, `AB,OLD303`, `AB,NOISE`, `COMM,XSLOW`,
  `COMM,SLOW`) are tagged with a distinct TextMate scope
  (`keyword.other.nd120-only.uc`) so themes can highlight them.
- **Hover on tokens.** Every recognised token shows a Markdown
  tooltip with description, category, display line, model
  availability, operand requirements, and the raw octal encoding
  `(w4, w3, w2, w1)`.
- **Context-aware hover on numeric literals.** The extension walks
  the current instruction's tokens and explains what a numeric will
  be used for at runtime - a 13-bit branch target, 16-bit data for
  `IDBS,ARG` + `COMM,LDxxx`, LCC value in `SCOND=1` mode, etc.
- **YAML-driven pipeline.** Grammar and hover metadata are generated
  from the canonical YAML definitions at `defs/tokens/` in the parent
  repo via `npm run generate`. No more hand-maintained regex lists.
- Additional scopes for labels (`entity.name.function.label.uc`) and
  address markers (`entity.name.section.address.uc`) enable theming.
- **Commands (powered by `@nd100uc/microcode`):**
  - Assemble current .uc file -> .CODE
  - Assemble + split into HIGH/LOW chip images (32 KiB each)
  - Import a .CODE binary + .SYMBOLS.TXT -> new .uc document
  - Show assembled bits for current instruction (validation + decode)
  - Open live bit-breakdown view (side panel that refreshes as the
    cursor moves)
- Configuration: `nd-microcode.hover.showEncoding`,
  `nd-microcode.hover.showModelWarnings`,
  `nd-microcode.defaultModel`.

### Changed

- Extension identifier changed from `nd-110-microcode` to
  `nd-microcode` to reflect multi-model support.
- Display name updated to "ND-100/110/120 MicroCode".
- Grammar rewritten: every pattern is generated from YAML rather
  than maintained by hand, eliminating the drift observed against
  the reference C# tokens.

### Migration notes

If upgrading from 0.0.1, uninstall the old `nd-110-microcode`
extension before installing the new `nd-microcode` build.

---

## 0.0.1 - 2022-12-14

- Initial ND-110 syntax highlighter.
- Bugfix: `ALUF,O-A-1` validation was wrong, corrected to `ALUF,Q-A-1`.
