# VERIFICATION.md — behaviors pending org confirmation

No behavioral claim about Salesforce semantics ships as
"supported" until it is confirmed against a real dev org and encoded as a golden
test. This file tracks every such open question. Until an item is verified, the
implementation either follows the golden corpus or marks the construct
unsupported — it never guesses.

Status legend: ❓ unverified · 🔬 verifying · ✅ verified (golden test id)

**Org verification pass (`orgcheck/`):** wave 1 completed **2026-07-26**,
wave 1 riders + **wave 2 (per-context)** completed **2026-07-28**, all against
a real Developer Edition org. `corpus/org-verified.json` carries the org-tier
semantic rows; `corpus/org-availability.json` carries the per-context
function/global availability matrix (one save-probe per construct per
context's own metadata container, canary-gated — see `orgcheck/README.md`).
Deploy rejections themselves are verdicts. The org-conformance suite is at
100% of comparable rows; availability agreement is enforced by
`src/registry/org-availability.test.ts`.

## Syntax / parsing

Operator precedence is now transcribed from the Salesforce open-source grammar
(`salesforce/formula-engine` `Formula.g4`) — see CONFORMANCE.md. Nesting there
gives, tightest→loosest: `* /` > `^` > `+ - &` > relational > equality, all
left-associative, with unary tighter than everything.

- ✅ **Unary binds tighter than `^`**; **comparison binds tighter than equality**
  — both confirmed by the grammar (`Formula.g4`), matching what we already had.
- ✅ **`&` shares the additive level** with `+`/`-` (was encoded below them;
  fixed). Settled as far as it is observable (2026-07-28 type-based probes):
  the compile error's *type report* shows `"x" & 1 > 0` and `"x" & 1 = 1`
  both fail with "operator '&' … received **Number**" — `&` grouped the
  numeric operand, so `&` binds tighter than relational and equality
  (probes `syntax:amp_vs_rel`, `syntax:amp_vs_eq`). The order among
  `+ - &` themselves is **unobservable in accepted formulas**: `&` does not
  coerce (`1 + 2 & "x"` is a save error, `syntax:amp_additive_typed`), and
  with text operands `+` and `&` both concatenate and both absorb blank —
  every discriminating expression is a compile error. The grammar's
  same-level encoding therefore cannot disagree with the product on any
  formula the product accepts.
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

## Registry data — settled by the wave-2 per-context pass (2026-07-28)

The matrix (`corpus/org-availability.json`) save-probed every registry
function and global in every context whose metadata container compile-checks
formulas. Containers were **canary-gated**: an ok-canary had to deploy and a
bogus-function canary had to be *rejected* before any acceptance was trusted.
Two structural org facts shaped the pass:

- **Create vs update validation asymmetry.** Flows and weblinks accept
  formula content lazily on *create* but validate fully on *update* — first-run
  acceptances for those containers were discarded and re-probed through the
  update path.
- **Email templates never compile-check** merge formulas at deploy (a bogus
  function deploys clean), so `email_template` availability is structurally
  unverifiable by this channel and stays Tier 2/best-effort.

Findings encoded in `functions.ts`/`contexts.ts`:

- ✅ **Per-function context availability.** Headlines: `CONCATENATE`, `IN`,
  `IFERROR`, and `SUBSTR` are rejected by **every** verifiable context —
  formula fields, validation rules, workflow rules/field updates, default
  values, approval criteria, flow formulas, buttons, and quick actions
  ("Unknown function" / "may not be used in this type of formula").
  `IFERROR`'s folk reputation as a validation-rule function is wrong in the
  current product; these are OSS-engine functions with no verified product
  home. `POWER`'s only accepting context is custom buttons. Change-tracking
  functions (`PRIORVALUE`/`ISCHANGED`/`ISNEW`) are accepted by validation
  rules, field updates, and approval criteria but rejected by workflow
  *rules* and flows. `TRUNC` requires both arguments outside formula fields.
- ✅ **Context globals.** All verifiable contexts accept `$User`, `$Profile`,
  `$UserRole`, `$Organization`, `$Setup`, `$Label`, `$Permission`, `$System`.
  `$CustomMetadata` additionally resolves in validation rules, default values,
  and flows only. `$Api` resolves in formula fields and flows (and buttons),
  not in validation/workflow/approval contexts.
- ✅ **Required return types.** Boolean requirement org-confirmed for
  validation rules, workflow rules, and both approval criteria, with the exact
  message captured ("Formula result is data type (Number), incompatible with
  expected data type (true or false)"). Field updates, default values, and
  flow formulas type against their declared target instead.
- ✅ **Blank-mode behavior in validation rules** (runtime probes, DML-based):
  VRs behave as *blank* mode — `blankNumber < 5` and `blankNumber = 0` are
  both false, blank text still equals `""`, ISBLANK(blank) is true. There is
  no "treat blanks as zeroes" in the VR context; `blankModeToggle: false` with
  blank-mode semantics is correct config. Other contexts' runtime blank
  behavior remains deploy-unobservable (no runtime channel yet).
- ❓ **Source character limits.** `charLimit: 3900` on formula/validation is
  the formula-definition length, not the compiled size (which cannot be
  computed client-side; the linter must say so). Compiled-size exploration is
  still open.

Runtime error semantics in validation rules (isolated single-record objects,
`Database.insert(allOrNone=false)`, debug-channel observation):

- ✅ **Div-by-zero blocks the save** with a system error naming the rule —
  `FIELD_CUSTOM_VALIDATION_EXCEPTION: Validation Formula "X" Invalid
  (Division by zero)`. The error is neither swallowed nor treated as false
  (probe `err_divzero`).
- ✅ **AND and OR short-circuit past a runtime error**: `AND(FALSE, (1/0)=1)`
  saves cleanly and `OR(TRUE, (1/0)=1)` fires its rule — the erroring operand
  is never evaluated once the result is decided (probes `err_shortcircuit_*`;
  meaningful because `err_divzero` proves the error would otherwise surface).
- ✅ **Text `=` stays case-sensitive** in validation rules (`"a" = "A"` is
  false, probe `rt_case_eq`) — same as formula fields.
- ✅ **IFERROR cannot catch a VR error** — trivially, since IFERROR does not
  exist in the validation-rule context ("Unknown function IFERROR").

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
- ✅ **Product `TEXT()` number rendering pinned down and implemented**
  (2026-07-28 `text_*` probe batch; `renderProductNumber` in
  `src/engine/builtins.ts`): TEXT sees the *pre-materialization* value (not
  the 32-place function boundary), renders plain notation always (never
  scientific), integers bare, trailing zeros stripped, and drops the leading
  zero of the integer part (`.5`, `-.5`). The digit budget is
  **Oracle-NUMBER parity**: 39 significant digits when the most significant
  digit sits at an even decimal position (units, hundreds…), 40 when odd —
  the signature of a base-100 mantissa (20 pairs) aligned to the decimal
  point. Fits every probe: `TEXT(4/3)` 39 sig, `TEXT(1000/3)` 39,
  `TEXT(20000/3)` 40, `TEXT(1/3)`/`TEXT(2/3)` 40 (HALF_UP at the boundary),
  `TEXT(2/30000)` 40. Internal engine precision was raised 39 → 40 to carry
  the boundary digit (oracle-tier conformance unchanged). The one remaining
  quirk: a **bare numeric literal** is constant-folded with a conventional
  rendering that keeps its leading zero (`TEXT(0.5)` = `"0.5"` but
  `TEXT(-0.5)` = `"-.5"` and `TEXT(field holding 0.5)` = `".5"`) —
  modeled by special-casing a bare-NumberLit argument. Only the
  Percent-field TEXT interaction stays quarantined
  (`semantics:text_percent_field`).
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
`src/engine/org-conformance.test.ts` (org tier) is at 100% with a single
quarantined row (`semantics:text_percent_field`). Remaining items, each
needing its own verification before a fix:

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
- ✅ **Product `TEXT()` number rendering** — pinned down and implemented
  (Oracle-NUMBER-parity digit budget; org-pass section). Only the
  Percent-field TEXT interaction remains quarantined.
- ✅ **Unary minus over blank** — org-verified `-blank` = 0 in zero mode,
  null in blank mode (`semantics:unary_minus_blank`); encoded.

## CLAUDE.md NEEDS-VERIFICATION list — status

- ✅ **Case sensitivity of text `=` / `<>`** — oracle-verified case-sensitive,
  and re-confirmed per context: formula fields (wave 1) and validation rules
  at runtime (wave 2, `rt_case_eq`) agree.
- ✅ **Div-by-zero surfacing per context** — formula fields produce a real
  `#Error!` (wave 1); validation rules block the save with a system error
  naming the rule (wave 2, `err_divzero`). Overflow surfacing and the
  remaining contexts' runtime behavior stay open (no runtime channel for
  workflow/approval/flow yet).
- ✅ **Blank propagation through arithmetic/comparison under both blank modes** —
  corpus-verified (semantics-pass section above); validation rules
  additionally runtime-verified as blank-mode (wave-2 `rt_blank_*` probes).
- 🔬 **Date/datetime arithmetic edge cases** (month-end `ADDMONTHS`,
  DST-adjacent datetime math, `TEXT()` output formats per type) — partly in the
  conformance backlog; datetime rendering is quarantined.
- 🔬 **Numeric precision/scale limits** — internal model resolved and refined:
  40-sig-fig carry, 32-place materialization, Oracle-NUMBER-parity TEXT
  rendering (org-pass sections above); rounding at display boundaries per
  field scale remains open.
- ✅ **Per-context function and global availability** — org-verified for every
  context whose container compile-checks formulas
  (`corpus/org-availability.json`; registry `contexts`/globals updated; those
  contexts are Tier 1 now). `email_template` is structurally unverifiable at
  deploy (no compile check) and stays Tier 2 best-effort.

## Open follow-ups (wave 3 candidates)

- Formula-field runtime probes for `AND`/`OR` short-circuit past `#Error!`
  (verified for validation rules; FF assumed matching — our evaluator
  short-circuits — but not yet org-pinned).
- Percent-field `TEXT()` rendering (the one quarantined org row).
- Overflow surfacing per context; compiled-size limits; DST probes under a
  non-GMT org TZ; ISPICKVAL/picklist coercion value probes.
- Runtime observation channels for non-VR contexts (flow interviews,
  workflow field-update execution).
- The registry lacks entries for some product functions the corpus exercises
  (e.g. `TIMEVALUE`, `DATETIMEVALUE`, `DATE`-adjacent helpers like `WEEKDAY`,
  `HYPERLINK`, `REGEX`, `DISTANCE`) — audit registry coverage against the
  product's full function list and probe availability for additions.
