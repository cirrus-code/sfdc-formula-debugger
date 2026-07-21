# VERIFICATION.md — behaviors pending org confirmation

Per CLAUDE.md rule 9, no behavioral claim about Salesforce semantics ships as
"supported" until it is confirmed against a real dev org and encoded as a golden
test. This file tracks every such open question. Until an item is verified, the
implementation either follows the golden corpus or marks the construct
unsupported — it never guesses.

Status legend: ❓ unverified · 🔬 verifying · ✅ verified (golden test id)

## Syntax / parsing

Operator precedence is now transcribed from the Salesforce open-source grammar
(`salesforce/formula-engine` `Formula.g4`) — see CONFORMANCE.md. Nesting there
gives, tightest→loosest: `* /` > `^` > `+ - &` > relational > equality, all
left-associative, with unary tighter than everything.

- ✅ **Unary binds tighter than `^`**; **comparison binds tighter than equality**
  — both confirmed by the grammar (`Formula.g4`), matching what we already had.
- ✅ **`&` shares the additive level** with `+`/`-` (was encoded below them; fixed).
- 🔬 **`* /` bind tighter than `^`** — grammar-backed but surprising vs the usual
  math convention; confirm the grammar reflects runtime via the WS3 eval oracle
  or org before treating as settled.
- 🔬 **`^` is left-associative** (`2^3^2` = `(2^3)^2`) — grammar-backed but
  surprising; same cross-check as above.
- ❓ **`&&` / `||` operators.** The OSS grammar accepts them (`INFIX_AND`/
  `INFIX_OR`) below equality precedence, but the product docs don't list them and
  DESIGN assumed they are not operators. Our lexer does not tokenize them yet
  (`&&`→two `&`, `|`→error). Verify OSS-vs-product before deciding to lex them.
- ❓ **`==` / `!=` operators.** The OSS grammar accepts them as first-class
  equality operators (`EQUAL2`/`NOT_EQUAL2`), yet the product documents only
  `=` / `<>`. We currently parse them and warn `nonstandard-operator`; revisit
  the warning once product parity is verified.
- ❓ **Identifier continuation chars.** `LexerRules.g4` lists `$ : . #` among
  identifier chars; we currently allow `[A-Za-z0-9_]` and split `.` as a path
  separator. Review whether `:`/`#` ever appear in real field references.

## Registry data (Phase 2)

Encoded as best-effort config and surfaced only as **warnings** (never errors),
suppressed entirely for Tier 2 contexts, until org-verified:

- ❓ **Per-function context availability.** `functions.ts` restricts
  `ISCHANGED`/`ISNEW`/`PRIORVALUE` to change-tracking contexts and `VLOOKUP` to
  validation rule + default value; every other function is marked `"all"`. The
  exact availability matrix per context (esp. every Tier 2 context) is unconfirmed.
- ❓ **Context globals.** The `$User`/`$Setup`/`$Flow`/… lists per context in
  `contexts.ts` are approximate, as is each global's simulatability.
- ❓ **Required return types.** Boolean is required for validation rules,
  workflow rules, and approval criteria — plausible but unverified per context.
- ❓ **Blank-mode applicability per context.** Only `formula_field` currently
  enables the toggle; whether other contexts honor "treat blanks as zeroes" is open.
- ❓ **Source character limits.** `charLimit: 3900` on formula/validation is the
  formula-definition length, not the compiled size (which cannot be computed
  client-side; the linter must say so).

## Semantics (from CLAUDE.md NEEDS-VERIFICATION list)

- ❓ Case sensitivity of text `=` / `<>` comparisons (per context, if it differs).
- ❓ Exact div-by-zero and overflow surfacing per context (formula field vs
  validation rule).
- ❓ Blank propagation through each arithmetic/comparison operator under both
  blank-handling modes ("treat blanks as zeroes" vs "as blanks").
- ❓ Date/datetime arithmetic edge cases: month-end `ADDMONTHS`, DST-adjacent
  datetime math, `TEXT()` output formats per type.
- ❓ Numeric precision/scale limits and rounding at display boundaries.
- ❓ Per-context function and global availability for every Tier 2 context.

## Verified

_(none yet — corpus and org-verification work begins in Phase 3.)_
