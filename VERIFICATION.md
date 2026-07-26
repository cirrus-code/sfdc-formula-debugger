# VERIFICATION.md — behaviors pending org confirmation

No behavioral claim about Salesforce semantics ships as
"supported" until it is confirmed against a real dev org and encoded as a golden
test. This file tracks every such open question. Until an item is verified, the
implementation either follows the golden corpus or marks the construct
unsupported — it never guesses.

Status legend: ❓ unverified · 🔬 verifying · ✅ verified (golden test id)

**Org verification pass (`orgcheck/`):** every remaining ❓/🔬 below that a
formula field can decide now has a probe in `orgcheck/probes/*.json` — see
`orgcheck/README.md` for the run workflow (real dev org via the sf CLI; deploy
rejections themselves are verdicts). After a run, upgrade entries here citing
the probe id, and `corpus/org-verified.json` carries the org-tier rows.
Per-context questions (availability matrices, div-by-zero per context) are the
pass's wave 2.

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

## Registry data

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

## Verified via the WS3 JVM oracle (oracle/)

Confirmed against Salesforce's own engine and encoded; conformance rose 74% → 86%:

- ✅ **Arithmetic scale = 32 decimal places, round-half-up per operation.**
  `1/3` → `0.333…` (32 places), `1000000/3` → `333333.333…` (32 places), exact
  values keep their natural scale.
- ✅ **`^` rejects non-integer exponents** (`2^0.5` → error; use SQRT for roots).
- ✅ **`SQRT` is double-precision** (`SQRT(2)` = `1.4142135623730951`).
- ✅ **`MOD(x, 0)` is a runtime error**, not `x`.
- ✅ **`ROUND` supports negative digits** (`ROUND(1234.5, -2)` = `1200`).
- ✅ **Percent fields are ÷100 as input and ×100 as a result type** (99% ↔ 0.99).
- ✅ **`LEFT`/`RIGHT`/`MID` return blank, not empty string, for an empty result.**
- ✅ **Text `=` / `<>` are case-sensitive** (`"a" = "A"` → false).

## Verified via corpus-driven semantics pass (86% → 97%)

Confirmed against the oracle corpus (`corpus/salesforce-v2.json`) and locked with
golden tests in `evaluator.test.ts`:

- ✅ **FLOOR truncates toward zero; CEILING rounds away from zero.**
  `FLOOR(-1.4)` = `-1`, `CEILING(-1.4)` = `-2`, `FLOOR(-0.4)` = `0`.
- ✅ **"Treat blanks as zeroes" is a numeric-only, read-time coercion.** In zero
  mode an empty Number/Currency/Percent field reads as a real `0` everywhere —
  arithmetic, `ISNULL`/`ISBLANK`, `NULLVALUE` all see `0`, not blank.
- ✅ **Blank propagation is fundamental (both modes).** A blank argument makes a
  function null, except blank-aware fns (`ISBLANK`, `ISNULL`, `ISNUMBER`,
  `ISPICKVAL`, `NULLVALUE`, `BLANKVALUE`, `LEN`→0, `CONCATENATE`/`TEXT`/`UPPER`/
  `LOWER`→"").
- ✅ **Three-valued comparison.** Ordering (`< <= > >=`) against any blank operand
  is `false`; equality coerces a blank _text_ field to `""` (`blankText = ""` is
  true) but treats a blank _numeric_ as null so `=` and `<>` are both false
  (`<>` is not the negation of `=` here).
- ✅ **`DATE()` truncates fractional month/day toward zero** (`DATE(2009, 3.5, 2)`
  → March 2) and **errors outside a supported year range** (`DATE(10000, …)` →
  error).

## Function port (unsupported → simulated)

Ported and corpus-verified (golden tests in `evaluator.test.ts`):

- ✅ **`TRUNC(n, [digits])`** truncates toward zero (negative digits round left of
  the point).
- ✅ **`MFLOOR`/`MCEILING`** are the _mathematical_ floor/ceiling (toward ∓∞) —
  distinct from Salesforce's toward-zero `FLOOR`/`CEILING`.
- ✅ **`SUBSTR(text, start, [len])`** is 1-based; `start ≤ 1` reads from the
  beginning, a negative `start` counts from the end, an out-of-range `start` is
  blank.
- ✅ **`INITCAP`** title-cases each Unicode word (first letter up, rest down);
  blank-aware (→ "").
- ✅ **`REVERSE`** (propagates blank → null), **`ASCII`**, **`CHR`**.
- ✅ **`IFERROR(expr, fallback)`** returns the fallback on a simulated `#Error`,
  but lets an unsupported-function refusal propagate (a refusal is not an error
  to be caught).

Deliberately **not simulated** (registered so they still parse/highlight/lint/
hover, but refuse to simulate per rule 1):

- ⛔ **Transcendentals** `LN LOG EXP SIN COS TAN ASIN ACOS ATAN ATAN2` — Salesforce
  computes these as non-correctly-rounded doubles (Java `StrictMath`) whose last
  ULP differs from JS `Math`; a faithful value is not reproducible client-side, so
  simulation refuses rather than ship a subtly-wrong answer. (`SQRT` is fine: IEEE
  mandates correctly-rounded square root.)
- ⛔ **`IN`** — the oracle's semantics are not reproducible from the corpus
  (`IN("Left", "Left")` → `false`); refuses rather than guess.

## Numeric model — resolved via the field-valued oracle (WS3 extension)

The field-valued harness (`oracle/`, `MapFormulaContext`) evaluated bare
intermediates against the real engine and settled the numeric-scale question:

- ✅ **39-sig-fig internal math, materialized to 32 decimal places.** Salesforce's
  `/` and `*` compute at 39 significant figures (`MathContext(39, HALF_UP)`) and
  round HALF_UP to 32 _decimal places_ only at materialization — the final result
  and each value handed to a function or comparison — **not** after every op.
  Verified raw: `(1/9)*9 → 1.000…`, `FLOOR((1/9)*9) → 1`, `1/3 → 0.333…(32)`. Our
  engine now mirrors this (`value.ts` precision 39; `evaluator.ts` `materialize`),
  which flipped the whole `FLOOR/CEILING/TRUNC((x/y)*y)` cluster to pass.
- ✅ **`+` concatenates text operands** (`"aaaa" + "bbbb"` → `"aaaabbbb"`), and a
  blank text operand propagates to null (unlike `&`, which treats blank as "").

## Conformance backlog (remaining gap to 100%)

`src/engine/conformance.test.ts` sits at ~99% over the comparable subset. The
remaining ~56 failures are diverse long-tail edge cases, each needing its own
verification before a fix:

- 🔬 **Date arithmetic** — `date + number` (should yield a date/null), `TEXT()` of
  a blank date (→ null), and Java datetime rendering (quarantined).
- 🔬 **`$System.originDateTime` and other context globals** in simulation.
- 🔬 **Specific blank interactions** — a few `CONTAINS`/`SUBSTITUTE` rows where the
  blank-propagation vs blank-absorb call differs from the oracle.
- 🔬 **`DATE()` upper year bound** — `10000` errors and four-digit years pass;
  whether the exact ceiling is `4000` or `9999` is unconfirmed. `MAX_YEAR = 9999`
  is the widest bound consistent with the corpus.
- 🔬 **Locale-aware `UPPER`/`LOWER`** — the optional locale second arg (e.g.
  Turkish dotless-ı) is ignored; a handful of Unicode-casing rows fail.
- 🔬 **Date/datetime result rendering** is quarantined (Java `toString` format),
  not compared.

## CLAUDE.md NEEDS-VERIFICATION list — status

- ✅ **Case sensitivity of text `=` / `<>`** — oracle-verified case-sensitive
  (WS3 section above). Whether any context differs is org-pass wave 2.
- ❓ **Exact div-by-zero and overflow surfacing per context** (formula field vs
  validation rule) — org-pass wave 2.
- ✅ **Blank propagation through arithmetic/comparison under both blank modes** —
  corpus-verified (semantics-pass section above); the few remaining blank
  interactions sit in the conformance backlog.
- 🔬 **Date/datetime arithmetic edge cases** (month-end `ADDMONTHS`,
  DST-adjacent datetime math, `TEXT()` output formats per type) — partly in the
  conformance backlog; datetime rendering is quarantined.
- 🔬 **Numeric precision/scale limits** — the internal model is resolved
  (39-sig-fig / 32-place, field-valued-oracle section above); rounding at
  display boundaries per field scale remains open.
- ❓ **Per-context function and global availability for every Tier 2 context** —
  org-pass wave 2.
