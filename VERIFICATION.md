# VERIFICATION.md — behaviors pending org confirmation

No behavioral claim about Salesforce semantics ships as
"supported" until it is confirmed against a real dev org and encoded as a golden
test. This file tracks every such open question. Until an item is verified, the
implementation either follows the golden corpus or marks the construct
unsupported — it never guesses.

Status legend: ❓ unverified · 🔬 verifying · ✅ verified (golden test id)

**Org verification pass (`orgcheck/`):** first run completed **2026-07-26**
against a real Developer Edition org (`results/org-run-2026-07-26.json`);
`corpus/org-verified.json` now carries 496 org-tier rows. Drift vs the JVM
oracle: 385 match, 28 mismatch (org wins — see the org-pass section), 49
incomparable renderings. Probes live in `orgcheck/probes/*.json`; see
`orgcheck/README.md` for the run workflow (deploy rejections themselves are
verdicts). Per-context questions (availability matrices, div-by-zero per
context) are the pass's wave 2.

## Syntax / parsing

Operator precedence is now transcribed from the Salesforce open-source grammar
(`salesforce/formula-engine` `Formula.g4`) — see CONFORMANCE.md. Nesting there
gives, tightest→loosest: `* /` > `^` > `+ - &` > relational > equality, all
left-associative, with unary tighter than everything.

- ✅ **Unary binds tighter than `^`**; **comparison binds tighter than equality**
  — both confirmed by the grammar (`Formula.g4`), matching what we already had.
- ✅ **`&` shares the additive level** with `+`/`-` (was encoded below them;
  fixed). The org probe meant to confirm it (`syntax:amp_additive_level`) is
  **inconclusive**: text `+` absorbs blank org-side (see the org-pass section),
  so both candidate groupings of `"a" + blank & "c"` yield the observed
  `"ac"`. A type-based wave-2 probe (e.g. `1 + 2 & "x"`) is needed.
- ✅ **`* /` bind tighter than `^`** — org-verified: `2 * 3 ^ 2` = 36
  (probe `syntax:pow_vs_muldiv`).
- ✅ **`^` is left-associative** — org-verified: `2 ^ 3 ^ 2` = `(2^3)^2` = 64
  (probe `syntax:pow_assoc`).
- ✅ **`&&` / `||` are accepted by the product** and evaluate as AND/OR
  (probes `syntax:andand_op`, `syntax:oror_op` — both saved and evaluated).
  Lexed, parsed (below equality, `||` loosest), and evaluated with AND()/OR()
  semantics; flagged `nonstandard-operator` (undocumented but accepted).
- ✅ **`==` / `!=` are accepted by the product** (probes `syntax:eqeq_op`,
  `syntax:noteq_op`). We already parse them; keep the `nonstandard-operator`
  warning (the product docs still omit them) but its wording may now assert
  they save fine.
- ✅ **`:` / `#` lex as identifier chars in the product** — `foo:bar + 1` and
  `foo#bar + 1` are rejected with *unknown-field* errors, not syntax errors
  (probes `syntax:ident_colon`, `syntax:ident_hash`), matching
  `LexerRules.g4`. No real field API name can contain them, so our lexer may
  keep splitting — but the resulting diagnostic should read as unknown-field,
  not as a syntax error.
- ✅ **Comments are legal mid-expression and do NOT nest** — `1 /* a /* b */ + 2`
  = 3, i.e. the first `*/` closes (probes `syntax:comment_basic`,
  `syntax:comment_nested`).
- ✅ **`NULL`-prefixed identifiers parse in the product** (`Null_Check__c`,
  probe `syntax:null_prefix_ident`) — the formulon defect is theirs alone.

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

## Verified via the org pass (orgcheck/, run 2026-07-26)

Real Developer Edition org, formula-field context, both blank modes. Org rows
outrank the JVM oracle; where they disagree below, the org is authoritative.

- ✅ **Blank-mode plumbing canary passed** (`semantics:blank_mode_canary`):
  `IF(blankNumber < 5, 1, 2)` = 1 in zero mode (blank reads as 0), 2 in blank
  mode (ordering vs blank is false) — the two-field deploy mechanism is sound.
- ✅ **`MOD(x, 0)` returns `x` in the product** (`MOD(3, 0)` = 3, probe
  `semantics:mod_zero`) — contradicts the JVM oracle's runtime error (below);
  the evaluator follows the org.
- ✅ **Text fields are never null for `ISNULL`/`NULLVALUE`** — org and oracle
  agree (`testISNULLWithText`/`TextArea`, `testNVLWithTextArea`): `ISNULL` is
  false and `NULLVALUE` never substitutes for a Text value, even a blank one;
  `ISBLANK` is the blank check for text. Encoded in the evaluator.
- ✅ **`CONTAINS`/`FIND` coerce blank operands to ""** — org and oracle agree
  (`testIfContainsFunc`, `testFindOnText`): `CONTAINS(x, blank)` is true,
  `CONTAINS(blank, y)` is false, `FIND(y, blank)` is 0. Both are blank-aware
  in the evaluator now.
- ✅ **Locale-aware `UPPER`/`LOWER`** — the undocumented second argument is
  accepted and honored (`upper("idempotent", "tr")` = `"İDEMPOTENT"`,
  `corpus:testUpperLocale`). Implemented via ICU (`toLocaleUpperCase`), whose
  special-cased alphabets (Turkish/Azeri/Lithuanian) match Java's.
- 🔬 **Product `TEXT()` number rendering is NOT the 32-place materialized
  value** — the org renders `TEXT(1 / 3)` as `.333…` with **40 digits and no
  leading zero**, and `^` results with ~39 significant figures
  (`semantics:text_third`, `semantics:text_percent_field`,
  `corpus:testExponentiationOperator#5/#18`). This contradicts the JVM
  oracle's rendering and the 32-place function-boundary model for TEXT
  specifically. The four rows are quarantined in
  `org-conformance.test.ts` until the product's TEXT scale/format rule is
  pinned down — do not silently match one tier by breaking the other.
- ✅ **Text ordering is reflexive**: `"Left" > "Left"` = false, `<=` = true —
  the oracle rows claiming otherwise (`testIfTextCompareGreaterThan#8`,
  `testIfTextCompareLessEqual#8`) are oracle bugs.
- ✅ **`SUBSTITUTE` with a blank search term is a no-op** (returns the input
  text unchanged, e.g. `SUBSTITUTE("Golden File", blank, "Platinum")` =
  `"Golden File"`) — org contradicts the oracle's null.
- ✅ **Text `+` absorbs a blank operand** (`"aaaa" + blank` = `"aaaa"`, both
  blank modes; `blank + blank` reads back null) — same as `&`, contradicting
  the field-valued-oracle note below.
- ✅ **`ADDMONTHS` month-end behavior** (probes `semantics:addmonths_*`):
  Jan 31 + 1 = Feb 28 (Feb 29 in leap years), Jan 30 + 1 = Feb 28 (overflow
  clamp), Feb 28 + 1 = Mar 31 (end-of-month-preserving, as documented).
- ✅ **`DATE()` accepts years through 9999** (`DATE(4000/4001/9999, …)` all
  save and evaluate; 10000 errors per corpus) — `MAX_YEAR = 9999` confirmed.
- ✅ **`date + number` arithmetic** — the full `testAddDate` cluster is now
  org-verified (`corpus/org-verified.json`), including blank/null cases.
- ✅ **Unary minus over a blank number**: `-blank` = 0 in zero mode, null in
  blank mode (probe `semantics:unary_minus_blank`).
- ✅ **`$System.originDateTime`** is legal in formula fields and TEXT()s to
  `1900-01-01 00:00:00Z` (probe `corpus:testOriginDateTime`).
- ✅ **`TEXT(TIMEVALUE("17:30:45.125"))`** = `"17:30:45.125"` — milliseconds
  render (probe `semantics:text_time`).
- ✅ **Case sensitivity re-confirmed org-side**: `IF("a" = "A", 1, 2)` = 2
  (probe `semantics:case_eq_formula_field`).

Save-time function availability in the formula-field context:

- ⛔ **`SUBSTR`** — "Function SUBSTR may not be used in this type of formula":
  the function exists but is context-restricted; registry availability must
  exclude formula fields.
- ⛔ **`IFERROR`** — "Unknown function IFERROR" in a formula field (it is a
  validation-rule-tier function); registry availability must exclude formula
  fields. (This was a surprise rejection, not an `expectSaveError` probe.)
- ✅ **`CHR`, 2-arg `UPPER`/`LOWER` (locale arg), `TIMEVALUE`** all save and
  evaluate in formula fields.

- ✅ **Div-by-zero is a real `#Error!` in formula fields**, not blank — settled
  without UI access despite SOQL reading `#Error!` as null: a blank-aware
  wrapper disambiguates the channel. `IF(ISBLANK(1 / 0), "BLANKRESULT",
  "VALUERESULT")` reads back null (the error propagates through `ISBLANK`; a
  blank would have produced `"BLANKRESULT"`), and `BLANKVALUE(1 / 0, 42)`
  reads null, not 42 (probes `semantics:divzero_isblank`,
  `semantics:divzero_blankvalue`). Errors propagate through blank-aware
  functions; nothing catches them in this context (`IFERROR` is unavailable).
  Per-context surfacing (validation rules etc.) remains wave 2.

The `CHR`/locale-`UPPER`/`LOWER` oracle-drift rows ("" vs null) remain
channel-ambiguous (SOQL cannot distinguish "" from null on text), not
verdicts.

## Verified via the WS3 JVM oracle (oracle/)

Confirmed against Salesforce's own engine and encoded; conformance rose 74% → 86%:

- ✅ **Arithmetic scale = 32 decimal places, round-half-up per operation.**
  `1/3` → `0.333…` (32 places), `1000000/3` → `333333.333…` (32 places), exact
  values keep their natural scale.
- ✅ **`^` rejects non-integer exponents** (`2^0.5` → error; use SQRT for roots).
- ✅ **`SQRT` is double-precision** (`SQRT(2)` = `1.4142135623730951`).
- ✅ **`MOD(x, 0)` is a runtime error in the JVM oracle** — but the org pass
  shows the product returns `x` (`MOD(3, 0)` = 3); org wins, see above.
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
- ✅ **`+` concatenates text operands** (`"aaaa" + "bbbb"` → `"aaaabbbb"`). The
  oracle's blank half (blank text operand propagates to null) is contradicted
  by the org pass: the product absorbs the blank (`"aaaa" + blank` → `"aaaa"`,
  probe rows `corpus:testAddConcatSimple#2/#3`) — org wins.

## Conformance backlog (remaining gap to 100%)

`src/engine/conformance.test.ts` (oracle tier) sits at 99.3% (33 failures);
`src/engine/org-conformance.test.ts` (org tier) is at 100% with 15 quarantined
rows. Remaining items, each needing its own verification before a fix:

- 🔬 **Date arithmetic** — full `date + number` evaluation (should yield a
  date). The blank case is org-verified and fixed (blank date operand → null
  in both modes, `testAddDate#0`); Java datetime rendering in the oracle stays
  quarantined, and `TEXT(datetime)` now renders the documented GMT
  `YYYY-MM-DD HH:MM:SSZ` shape (org-verified via `corpus:testOriginDateTime`).
- ✅ **`$System.originDateTime`** simulates as its fixed value,
  1900-01-01 00:00 GMT (org-verified).
- ✅ **Blank interactions** (`CONTAINS`/`FIND`/`SUBSTITUTE`) — org-settled and
  implemented (org-pass section).
- ✅ **`DATE()` upper year bound is 9999** — org-verified (`DATE(4001, 1, 1)`
  and `DATE(9999, 12, 31)` both evaluate; probes `semantics:date_year_*`).
- ✅ **Locale-aware `UPPER`/`LOWER`** — implemented (org-pass section).
- 🔬 **Product `TEXT()` number rendering** — new org finding (org-pass
  section): no leading zero, ~40-digit scale; quarantined pending
  investigation.
- ✅ **Unary minus over blank** — org-verified `-blank` = 0 in zero mode,
  null in blank mode (`semantics:unary_minus_blank`); encoded.

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
