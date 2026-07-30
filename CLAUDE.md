# CLAUDE.md — Salesforce Formula Debugger

A free, open-source, client-side Salesforce formula debugger: syntax/error highlighting,
simulation with user-supplied field values, boolean simplification, formatting, and linting.
**No server. No backend. Ever.** Everything runs in the browser.

Read `DESIGN.md` before writing code. It is the authoritative spec; this file is the set of
rules you must not break while implementing it.

## Hard rules (non-negotiable)

1. **Never silently approximate.** If a formula uses any construct outside the explicitly
   supported simulation subset, simulation must fail with a hard, specific
   "unsupported: FUNCTION_NAME" error — never a best-effort guess. A wrong simulated answer is a
   product failure; an honest "unsupported" is fine. Accuracy is the tool's entire value
   proposition.
2. **No IEEE-float arithmetic in the evaluator.** All Number/Currency/Percent math goes through
   `decimal.js`. `0.1 + 0.2` must equal `0.3`. Rounding is round-half-up (`ROUND(2.5) = 3`).
3. **The parser must recover from errors.** Broken input must still produce a partial AST and
   multiple positioned diagnostics. Bailing at the first error is unacceptable — this is an
   editor, and users will spend most of their time with syntactically invalid formulas.
4. **Every AST node carries a source span** (start/end offsets). Diagnostics, hover, and
   formatting all depend on this.
5. **Comments (`/* ... */`) are preserved**, attached to AST nodes during parsing, and survive
   formatting. A formatter that destroys comments is broken.
6. **Formatter is idempotent and semantics-preserving.** Property-tested:
   `format(format(x)) === format(x)`, and `parse(format(x))` yields an AST structurally equal to
   `parse(x)` (ignoring trivia).
7. **Simplifier rewrites must be equivalence-preserving under Salesforce blank semantics**, not
   just classical boolean algebra. Any rewrite rule that changes behavior when an operand is
   blank/null is forbidden. When in doubt, verify the rule against the golden corpus.
8. **One AST, one function registry.** Every feature (highlighting, diagnostics, autocomplete,
   hover docs, type checking, evaluation, simplification, formatting, linting, field extraction)
   consumes the same typed AST and the same declarative function registry. Do not create
   parallel representations or per-feature function tables.
9. **Do not trust the model's memory of Salesforce semantics.** Any behavioral claim (case
   sensitivity, div-by-zero, blank coercion, date edge cases) must be backed by an entry in the
   golden test corpus or explicitly flagged in `VERIFICATION.md` as unverified. See the
   needs-verification list below.
10. **Formulas are user data; keep them client-side.** No analytics events containing formula
    text, no remote logging of input. Permalink encoding (lz-string in the URL hash) is the only
    place formula content leaves the editor, and only by explicit user action.

## Architecture map

Dependency direction is strictly downward. Lower layers must not import from higher ones.

```
ui/            React + CodeMirror 6 (editor, simulation form, panels, permalinks)
features/      simplifier, formatter, linter, field-extraction  (pure functions over AST)
analysis/      type checker, context validator, diagnostics
engine/        evaluator + value domain (decimal.js)
registry/      function metadata table + formula-context configs  (data, minimal code)
syntax/        lexer, parser (recursive descent + Pratt), AST types, spans, comments
i18n/          locale packs — every user-facing string  (leaf: importable by all layers)
theme/         branding: product name, palette, fonts  (leaf: importable by all layers)
```

- `syntax/` has zero dependencies on anything above it and no knowledge of specific functions —
  function names are just identifiers at parse time. It may import `i18n/` (as may every layer).
- `i18n/` holds all user-visible prose; no other layer embeds user-facing English. The `en` pack
  defines the catalog shape (`LocalePack`); interpolated messages are typed functions. Registry
  prose (function summaries, lint notes, context labels) stays in `registry/` as the English
  source and is translated via sparse per-locale overlays. `i18n/` imports nothing from src/.
  See `src/i18n/README.md` before adding strings or a locale.
- `registry/` is the single source of truth for function signatures, per-context availability,
  simulatability, docs URLs, and lint notes. Adding a formula context or a function must be a
  data change, not a code change (except new evaluator implementations).
- `ui/` contains no Salesforce semantics. If you find yourself encoding formula behavior in a
  React component, stop and move it down the stack.

## Stack

- TypeScript, strict mode. React + Vite. Static build, deployable to any static host.
- CodeMirror 6 (not Monaco). Use CM6's native APIs: `Decoration` for highlighting, `linter` for
  diagnostics, `autocompletion`, `hoverTooltip`.
- `decimal.js` for numeric values. `lz-string` for permalink encoding. Vitest for tests;
  `fast-check` for property tests.
- Keep the bundle lean. This is a first-impression page; avoid heavyweight deps.

## Salesforce semantics you must model

- **Value domain:** Text, Number, Currency, Percent, Boolean (Checkbox), Date, Datetime, Time,
  Picklist, Multipicklist, Id. Blank/null is a first-class state of every type, not a separate
  type.
- **Blank-handling mode:** formula fields have an org/field-level setting, "treat blank fields
  as zeroes" vs "treat as blanks." This changes arithmetic results and MUST be a visible toggle
  in the simulator UI, threaded through the evaluator. (formulon lacks this — see porting notes.)
- **ISBLANK vs ISNULL:** ISBLANK is true for both null and empty string on text; ISNULL is the
  legacy null check. Model both correctly.
- **Boolean field coercion:** a null checkbox field reads as `false`.
- **String concatenation with blank:** `"a" & blank` → `"a"` (blank concatenates as empty).
- **Division by zero:** simulate Salesforce's `#Error!` outcome — surface it as a distinct
  simulated-error result, not null and not a crash.
- **Identifiers:** dotted cross-object paths (`Account.Owner.Name`) are treated as single flat
  field references. Identifiers may begin with keyword-like prefixes (`Null_Check__c` must
  parse — this is a known formulon grammar bug; do not replicate it).

## NEEDS-VERIFICATION list (maintain in VERIFICATION.md)

Behaviors that must be confirmed against a real Salesforce dev org and encoded as golden tests
before the simulator claims support. Do not guess; until verified, either follow the golden
corpus or mark the construct unsupported:

- Case sensitivity of text `=` / `<>` comparisons (per context, if it differs).
- Exact div-by-zero and overflow surfacing per context (formula field vs validation rule).
- Blank propagation through each arithmetic/comparison operator under both blank-handling modes.
- Date/datetime arithmetic edge cases (month-end `ADDMONTHS`, DST-adjacent datetime math,
  `TEXT()` output formats per type).
- Numeric precision/scale limits and rounding at display boundaries.
- Per-context function and global availability for every Tier 2 context (see DESIGN.md tiers).

## Porting from formulon (github.com/leifg/formulon, MIT)

Port its ~75 function implementations and adapt its ~534 tests into the registry/evaluator.
Include MIT attribution (LICENSE notice + NOTICE entry). While porting, **fix** these known
defects rather than copying them:

- No comment support (`/* */` is a syntax error there) — ours must parse and preserve comments.
- Opaque, position-free syntax errors — ours must be positioned with recovery.
- `number + blank` throws ArgumentError — ours must honor the blank-handling mode.
- Identifiers with `NULL`-prefixed names fail to parse — ours must not.
- `1 / 0` returns null — ours must produce a simulated `#Error!`.

Their decimal handling, rounding, date arithmetic, and blank-concat behavior are good; take
those nearly verbatim. Their PEG grammar is reference-only — we write our own lexer/parser.

## Testing requirements

- **Golden corpus:** a data file of `(formula, context, inputs, blankMode, expected)` triples is
  the durable, language-agnostic asset of this project. All evaluator work is corpus-driven.
  Seed it from formulon's tests; extend it with oracle output from
  `github.com/salesforce/formula-engine` (its Java direct-eval path — never the
  `toJavascript()` path, which mishandles div-by-zero; see CONFORMANCE.md) and org-verified
  cases.
- **Property tests:** formatter idempotence + reparse-equality; simplifier equivalence (random
  inputs including blanks, both blank modes, simplified vs original must agree); lexer
  round-trip (concat of token texts + trivia === source).
- **Error-recovery tests:** a suite of malformed formulas asserting the count, positions, and
  messages of diagnostics, and the shape of the recovered AST.
- CI must report the conformance number (corpus pass rate). That number is the project's
  headline metric; protect it.

## Out of scope — do not build

- Report formulas (row-level or custom summary formulas, `AMOUNT:SUM` syntax). Different
  language; explicitly excluded even though "all contexts" is the goal.
- Any org connectivity: no OAuth, no metadata fetch, no live field-type lookup. Field types come
  from inference + user selection only.
- Org-state functions in simulation: `PRIORVALUE`, `ISCHANGED`, `ISNEW`, `ISCLONE`, `VLOOKUP`,
  `IMAGE`, `GETSESSIONID`, `CURRENCYRATE`, `$CustomMetadata`/`$Setup`/`$Permission` resolution.
  These parse, highlight, format, and lint normally — they only refuse to _simulate_ (hard
  error per rule 1).
- Accounts, persistence, server-side anything, telemetry containing formula text.
- Exact compiled-size calculation (Salesforce's compiled-character limit is not computable
  client-side; the linter warns approximately and says so).

## Conventions

- Small modules, pure functions, exhaustive `switch` on AST node kinds (use `never` checks so
  adding a node kind breaks compilation everywhere it must be handled).
- Registry entries are typed data literals; validate the registry's internal consistency with a
  test (every function has a signature, contexts reference declared context ids, etc.).
- When working on the UI, apply deliberate visual design per the frontend-design skill — this
  page is a brand touchpoint, not an internal tool. The product name, palette, and cross-links
  live in one theme module (`src/theme/`) so branding changes stay a one-file change. The tool
  is hosted at `formulas.cirrus.tools`.
