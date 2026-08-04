# VERIFICATION.md — the verification ledger

No behavioral claim about Salesforce semantics ships as "supported" until it
is verified — against a real dev org, the formula-engine oracle, or the golden
corpus — and encoded as a golden test. This file is the ledger: every settled
behavior with its evidence (probe id or corpus test), plus the open questions
that remain. Until an item is verified, the implementation either follows the
golden corpus or marks the construct unsupported — it never guesses.

Status legend: ❓ unverified · 🔬 verifying · ✅ verified (golden test id)

**Org verification (`orgcheck/`):** probes run against a real Developer
Edition org.
`corpus/org-verified.json` carries the org-tier semantic rows;
`corpus/org-availability.json` carries the per-context function/global
availability matrix (one save-probe per construct per context's own metadata
container, canary-gated — see `orgcheck/README.md`). Deploy rejections are
themselves verdicts. The org-conformance suite passes every comparable row
(baseline locked; see CONFORMANCE.md for the numbers), and availability
agreement is enforced by `src/registry/org-availability.test.ts`.

## Syntax / parsing

Operator precedence is transcribed from the Salesforce open-source grammar
(`salesforce/formula-engine` `Formula.g4`) — see CONFORMANCE.md. Nesting there
gives, tightest→loosest: `* /` > `^` > `+ - &` > relational > equality, all
left-associative, with unary tighter than everything.

- ✅ **Unary binds tighter than `^`**; **comparison binds tighter than equality**
  — both confirmed by the grammar (`Formula.g4`), matching what we already had.
- ✅ **`&` shares the additive level** with `+`/`-`. Settled as far as it is
  observable (type-based probes):
  the compile error's _type report_ shows `"x" & 1 > 0` and `"x" & 1 = 1`
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
- ✅ **`&&` / `||` are documented product operators** and evaluate as AND/OR
  (probes `syntax:andand_op`, `syntax:oror_op` — both saved and evaluated;
  the operator reference — help article `customize_functions` — lists them
  as alternatives to `AND`/`OR`). Lexed, parsed (below equality, `||`
  loosest), and evaluated with AND()/OR() semantics; flagged
  `nonstandard-operator` as a style nudge toward the function forms.
- ✅ **`==` / `!=` are documented product operators** (probes
  `syntax:eqeq_op`, `syntax:noteq_op`; the operator reference lists `=`/`==`
  and `<>`/`!=` as interchangeable). Parsed and evaluated as first-class
  equality; flagged `nonstandard-operator` as a style nudge toward `=`/`<>`.
- ✅ **`:` / `#` lex as identifier chars in the product** — `foo:bar + 1` and
  `foo#bar + 1` are rejected with _unknown-field_ errors, not syntax errors
  (probes `syntax:ident_colon`, `syntax:ident_hash`), matching
  `LexerRules.g4`. No real field API name can contain them, so our lexer may
  keep splitting — but the resulting diagnostic should read as unknown-field,
  not as a syntax error.
- ✅ **Comments are legal mid-expression and do NOT nest** — `1 /* a /* b */ + 2`
  = 3, i.e. the first `*/` closes (probes `syntax:comment_basic`,
  `syntax:comment_nested`).
- ✅ **`NULL`-prefixed identifiers parse in the product** (`Null_Check__c`,
  probe `syntax:null_prefix_ident`) — the matching parse failure in
  [formulon](https://github.com/leifg/formulon) (the seed baseline; see the
  CONFORMANCE.md trust order) is that library's defect alone, not product
  behavior.
- ✅ **String-literal escapes** (oracle-verified against engine v0.9.13,
  `LEN`/`FIND` probes; decode half org-verified, probes
  `syntax:esc_*_len` — all four org values match the oracle exactly). The
  grammar (`LexerRules.g4` `STRING_LITERAL`) accepts exactly nine escapes —
  `\n \r \t \N \R \T \" \' \\` — and any other backslash sequence is a
  syntax error (`"a\qb"` fails to compile; we diagnose `invalid-escape`
  and recover). The product _collapses only two_: `\\` → `\` and `\" `→ `"`
  (`LEN("\\")` = 1, `LEN("a\"b")` = 3, in both quote styles). Every other
  accepted escape keeps both characters: `\n` is literal backslash-n
  (`LEN("a\nb")` = 4, never a newline), and `\'` keeps its backslash even
  inside single quotes (`LEN('a\'b')` = 4) while still not terminating the
  string. Encoded in `parser.test.ts`.

## Registry data — per-context availability

The matrix (`corpus/org-availability.json`) save-probed every registry
function and global in every context whose metadata container compile-checks
formulas. Containers were **canary-gated**: an ok-canary had to deploy and a
bogus-function canary had to be _rejected_ before any acceptance was trusted.
Two structural org facts shaped the pass:

- **Create vs update validation asymmetry.** Flows and weblinks accept
  formula content lazily on _create_ but validate fully on _update_ — first-run
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
  _rules_ and flows. `TRUNC` requires both arguments outside formula fields.
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
  VRs behave as _blank_ mode — `blankNumber < 5` and `blankNumber = 0` are
  both false, blank text still equals `""`, ISBLANK(blank) is true. There is
  no "treat blanks as zeroes" in the VR context; `blankModeToggle: false` with
  blank-mode semantics is correct config. Workflow field updates likewise
  runtime-verified as blank mode (`wfu_blank_add`: `blank + 5` writes
  null), and both approval contexts too (`ae_blank_add` /
  `ae_blank_add_null` complementary pair).
- ✅ **Source character limit org-verified**: a 3,916-char formula-field
  source rejects with "Formula is too long (3,916 characters). Maximum
  length is 3,900 characters" (probe `syntax:srclen_over`; ~3,790 chars
  saves). `charLimit: 3900` is exact for the definition length. The
  **compiled-size limit is 15,000 characters**, enforced at deploy: the
  ≈18.4k inline chain rejects with "Compiled formula is too big to execute
  (18,444 characters). Maximum size is 15,000 characters" (probe
  `semantics:csize_l4`; `csize_l6` likewise), while the ≈6.9k and ≈9k chains
  save (`csize_3x`, `csize_l3`). The folklore ~5k compiled cap is wrong —
  the real ceiling is 15k, and referenced formula fields DO inline into it.
  The linter's approximate wording stays: the exact compiled size is still
  not computable client-side, only the limit it is measured against is now
  known.
- ✅ **Text formula output truncates at 1,300 characters** — a 2,300-char
  literal Text formula reads back exactly 1,300 chars (probes
  `semantics:csize_base/2x/3x` all cap there). A display/storage-boundary
  rule, not an expression-level one.

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

## Formula-field semantics (org pass)

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
- ✅ **Locale-aware `UPPER`/`LOWER`** — the second (locale) argument is
  documented ("Locale rules are applied if a locale is provided") and
  org-verified as honored (`upper("idempotent", "tr")` = `"İDEMPOTENT"`,
  `corpus:testUpperLocale`). Implemented via ICU (`toLocaleUpperCase`), whose
  special-cased alphabets (Turkish/Azeri/Lithuanian) match Java's.
- ✅ **Product `TEXT()` number rendering pinned down and implemented**
  (`text_*` probe batch; `renderProductNumber` in
  `src/engine/builtins.ts`): TEXT sees the _pre-materialization_ value (not
  the 32-place function boundary), renders plain notation always (never
  scientific), integers bare, trailing zeros stripped, and drops the leading
  zero of the integer part (`.5`, `-.5`). The digit budget is
  **Oracle-NUMBER parity**: 39 significant digits when the most significant
  digit sits at an even decimal position (units, hundreds…), 40 when odd —
  the signature of a base-100 mantissa (20 pairs) aligned to the decimal
  point. Fits every probe: `TEXT(4/3)` 39 sig, `TEXT(1000/3)` 39,
  `TEXT(20000/3)` 40, `TEXT(1/3)`/`TEXT(2/3)` 40 (HALF_UP at the boundary),
  `TEXT(2/30000)` 40. The engine computes at precision 40 to carry the
  boundary digit (numeric-model section below). One quirk: a **bare numeric
  literal** is constant-folded with a conventional rendering that keeps its
  leading zero (`TEXT(0.5)` = `"0.5"` but `TEXT(-0.5)` = `"-.5"` and
  `TEXT(field holding 0.5)` = `".5"`) — modeled by special-casing a
  bare-NumberLit argument. The Percent-field TEXT interaction is settled by
  the `TEXT(percent)` entry below (`semantics:text_percent_field`).
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
  save and evaluate, probes `semantics:date_year_*`; 10000 errors per
  corpus) — `MAX_YEAR = 9999` confirmed.
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

The `CHR`/locale-`UPPER`/`LOWER` oracle-drift rows ("" vs null) remain
channel-ambiguous (SOQL cannot distinguish "" from null on text), not
verdicts.

## Verified via the WS3 JVM oracle (oracle/)

Confirmed against Salesforce's own engine and encoded:

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

## Corpus-driven semantics

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

## Registry function coverage

The registry covers 101 functions, audited against the official function
reference (all additions doc-confirmed; the availability matrix probes each
per context). Corpus-backed and simulated:

- ✅ **`DATETIMEVALUE`** (lenient digit widths, strict ranges, GMT; invalid
  text is a runtime error — testDateTimeValue*, testTimeValueWithValidInValid).
- ✅ **`TIMEVALUE`** (of datetime or `HH:MM:SS.mmm` text), **`TIMENOW`**,
  **`HOUR`/`MINUTE`/`SECOND`/`MILLISECOND`** (0-based, corpus-verified).
- ✅ **`WEEKDAY`** (1 = Sunday), **`DAYOFYEAR`**, **`ISOWEEK`/`ISOYEAR`**
  (ISO-8601 Thursday rule), **`UNIXTIMESTAMP`** (dates count midnight GMT; a
  Time counts seconds since midnight), **`FROMUNIXTIME`**.
- ✅ **`LPAD`/`RPAD`** (length ≤ 0 → null, truncation, pad-string cycling cut
  mid-repeat — testLpad*/testRpad*).
- ✅ **`PI`** (Java Math.PI double, `ROUND(PI(), 12)` corpus-verified).

Temporal semantics, corpus-verified alongside them:

- ✅ **Date arithmetic**: `date ± n` truncates the fractional day toward zero
  (28 + 3.5 → Mar 2); `date − date` → whole days; `datetime ± n` in
  fractional days at millisecond resolution; `datetime − datetime` →
  fractional days (1.375). Temporal ordering/equality (`date > date`,
  CASE over dates) compare by instant.
- ✅ **Time arithmetic**: `time ± n` in milliseconds — a result past midnight
  wraps (+26h ≡ +2h) but a negative one is a runtime error;
  `time − time` → milliseconds, wrapping forward a day when negative
  (testSubtractTwoTimeFields: earlier − later = 24h − gap).
- ✅ **`TEXT(time)`** always renders full `HH:MM:SS.mmm` (oracle-verified,
  "00:00:00.000"), while the bare TimeOnly channel renders LocalTime-style
  (drops zero seconds/millis) — two channels, two shapes, both encoded.
- ✅ **`SUBSTR` with a negative length** → null (testSubstr3).

Registered but refusing simulation until golden rows exist (or forever, for
org-state/rendering values): `INCLUDES`, `PICKLISTCOUNT`, `REGEX` (Java
dialect not client-reproducible), `DISTANCE`/`GEOLOCATION`, `BR`,
`CASESAFEID`, `HTMLENCODE`/`JSENCODE`/`JSINHTMLENCODE`/`URLENCODE`,
`HYPERLINK`, `IMAGE`, `IMAGEPROXYURL`, `FORMATDURATION`, `JUNCTIONIDLIST`,
`GETSESSIONID`, `CURRENCYRATE`, `ISCLONE`.

Their per-context availability is org-verified (the matrix includes a
`formula_field` container, so formula-field availability is probed
uniformly). Highlights encoded in `functions.ts`: **`REGEX` is not available in
formula fields** (validation rules and most others accept it); the **encode
family** (`HTMLENCODE`/`JSENCODE`/`JSINHTMLENCODE`/`URLENCODE`) lives only in
flows and custom buttons; **`HYPERLINK`** only in formula fields and flows,
**`IMAGE`** only in formula fields; **`BR`** everywhere except buttons;
**`IMAGEPROXYURL`/`JUNCTIONIDLIST`** were rejected by every verifiable
context (email templates are their only plausible, unverifiable home);
**`ISCLONE`** matches the change-tracking contexts; **`UNIXTIMESTAMP`** is
rejected only by quick actions; **`DISTANCE`/`GEOLOCATION`** everywhere
except buttons.

## Value probes and runtime channels

Value probes (formula-field readback plus a **flow interview channel**:
`Flow.Interview.createInterview` over the deployed Active flows, payloads
base64'd past the debug log's entity encoding) pinned the semantics of eight
formerly-refusing functions, now simulated with golden coverage:

- ✅ **`INCLUDES` and `ISPICKVAL` are case-INsensitive** — unlike text `=`
  (probes `ispickval_case`, `includes_case`); literals must otherwise match
  exactly (no whitespace trimming, `ispickval_space`); a semicolon-joined
  literal matches nothing (`includes_joined`); blank multi-selects read false
  / count 0 in both modes (`includes_blank`, `picklistcount_blank`).
- ✅ **`FORMATDURATION`** — three corpus-verified overloads: seconds
  (fractions truncate, hours accumulate: 1000000 → `277:46:40`), seconds +
  include-days (`11:13:46:40`), and symmetric absolute differences of a Time
  pair (`HH:MM:SS`) or Datetime pair (always `D:HH:MM:SS`). A blank
  include-days checkbox reads false while blank operands null
  (testFormatDuration* clusters). Negative seconds stay a loud refusal.
- ✅ **`BR()` is context-dependent**: a literal `<br>` tag in formula-field
  output (`br_render` = `"a<br>b"`) but a real newline in flow interviews
  (`fv_br`) — simulated as the formula-field rendering, with a lint note.
- ✅ **Encode family** (via the flow channel, their only observable home):
  `HTMLENCODE` maps `< > & "` to named entities and `'` to `&#39;`;
  `JSENCODE` backslash-escapes both quote kinds; `JSINHTMLENCODE` is NOT a
  plain composition — it JS-escapes only the apostrophe before HTML-encoding
  (`a"b<e>` → `a&quot;b&lt;e&gt;` but `d'e` → `d\&#39;e`); `URLENCODE`
  matches Java URLEncoder (space → `+`, `%XX` otherwise) on every probed
  character.
- ✅ **Formula fields short-circuit like validation rules**: `AND(FALSE, …)`,
  `OR(TRUE, …)`, and `&&` all skip an erroring operand
  (`ff_shortcircuit_*`).
- ✅ **`TEXT(percent)` renders the internal ÷100 value** through the product
  renderer (99% field → `".99"`, `× 2` → `"1.98"`) — the last TEXT
  quarantine is resolved.
- ⛔ **`CASESAFEID` stays refusing**: the 18-char suffix algorithm is
  confirmed for a real prefix (`001…` → `…AAA`) but the function _validates_
  its input against the org's key-prefix registry (a 15-char non-ID passes
  through unchanged, `casesafeid_mixed`) — org state a client cannot know.
- ✅ **`^` has two code paths**, split by compile-time constant
  folding of all-literal operands (parens fold away: `TEXT((0.5))` = `0.5`).
  **Folded (literal `^` literal), positive exponent: the exact value rounded
  to 18 significant digits, HALF_UP** — digit-exact across nine probes
  (`pw5_dbl_*`: 3^34 comes back exact at 17 digits, which no IEEE double
  can produce, and 0.7^80's double diverges in digit 16). Folded results
  render literal-style (leading zero kept: `TEXT(0.7^80)` = `0.000…`,
  `TEXT(0.23^25)` likewise) while computed values drop the zero even at
  tiny scale (`TEXT(1/4)` = `.25`, `pw6_div_quarter` — the fold model, not
  a scale threshold, drives the leading zero). Folded deep fractions are
  never tail-truncated — `0.5^76` keeps all 18 digits through place 40
  (`pw7_clamp_05_76`) — they are either kept whole or flushed to zero, with
  **truncation at 1e-39**: `0.5^129` ≈ 1.47e-39 keeps all 18 digits while
  `0.5^130` ≈ 7.35e-40 flushes even though it would round up to 1e-39
  (`pw8_flush` + `pw8b` adjacent straddle).
  **Runtime (one field operand suffices, `pw6_rt_mixed`) and every negative
  exponent in either path: decimal at scale 42, HALF_UP** — digit-exact on
  field-valued `0.7^80` / `0.5^132` / `3^-25` and literal `3^-25` / `7^-20`
  / `9^-30`; field-valued `3^40` returns the exact `…801` where the folded
  form rounds to `…800` (`pw6_rt_int`). `1.00596^240`'s 39 rendered digits
  and `99^-1`'s 40 rendered places are the TEXT digit budget over a
  scale-42 value, and `(1e-13)^1000` → 0 falls out of the scale.
  **Cap: results past 1e64 are runtime errors in BOTH paths and both
  exponent signs** (`10^64` computes; literal `10^65`/`2^213`/`9^68`/
  `(10^40)^2` error; field-valued `10^80` errors, `pw6_rt_cap`; the
  `0.1^-70` reciprocal errors, `pw7_recip_cap`); the cap is `^`-only
  (1e180 via `*` computes) and does not bind tiny values.
  **Runtime precision limit: 43 significant digits for exact results** —
  `1.00596^240` (43 sigs) computes; `7^52`/`7^53`/`7^54`/`7^55` (44–47
  digits) all error (`pw8_prec`, 43/44 adjacent). Terminating reciprocals
  share the exact path and its limit: `0.5^-10` = `1024` in both compile
  paths while `0.5^-145` (2^145, 44 digits) errors
  (`pw8_recip`/`pw8b_recip_big_term`). **Non-terminating reciprocals
  escape by rounding**: `0.3^-5` through `0.3^-72` compute, digit-exact
  against a ≥ 40-sig rounding of the true value rendered through the TEXT
  budget — up to a magnitude line at **1e38** (38 integer digits compute,
  39 error; `pw8c`/`pw8d` adjacent probes — Oracle NUMBER's precision-38
  ceiling showing through). The evaluator takes an exact BigInt path for
  results ≥ 10 so true significance is known rather than read off a
  rounded carry.
  **Edges**: `0^0` = 1 in both paths (`pw5_zero_zero`); `0^negative` is a
  runtime `#Error!`, not blank (`pw6_zeroneg_blank`: `ISBLANK(0^-1)` errors
  the whole formula). Simulation refuses in exactly one case — an exact
  form too large to compute and verify (bases within ~1e-4 of 1 raised to
  multi-thousand exponents); everything else is org-verified.
- ✅ **WS4-derived function edges**: `FIND` with an empty search
  term returns **0**, not 1 (`pw7_find_empty_needle`, and `FIND("", "")` =
  0 too). `VALUE("")` is **blank** while `VALUE(" ")` is a runtime
  **`#Error!`** (`pw7_value_empty`/`pw7_value_space`) — the org splits what
  the oracle blankets as null.
- ✅ **Empty text IS blank — universally**: every empty-producing
  text operation reads back blank through `ISBLANK` — `LEFT`/`MID`/`RIGHT`
  at length 0, `TRIM(" ")`, `SUBSTITUTE` deleting everything, `UPPER("")`,
  and even `"" & ""` (`pw8_be_*` riders; `TEXT(blank)` too). The product's
  value domain has no empty-string state distinct from null. The evaluator
  normalizes every operation result accordingly, and the 18 oracle rows
  that expected `""` from a blank argument (`testUpper`/`testLower`/
  `testInitCap` and locale variants) are org-overruled — the oracle encodes
  a distinction the product cannot represent.
- ✅ **Approval-criteria AND/OR short-circuit**: `AND(false,
1/0=1)` reads criteria-false (`NO_APPLICABLE_PROCESS` / step-skip) and
  `OR(true, 1/0=1)` submits cleanly in BOTH approval contexts
  (`ae_sc_*`/`as_sc_*` on isolated objects) — matching validation rules.
  `IFERROR` needs no runtime probe there: it is compile-rejected in both
  approval contexts (availability matrix, "Unknown function
  IFERROR").
- Flow-context runtime facts: **div-by-zero yields null in a running flow**
  (vs `#Error!` in formula fields and a blocked save in validation rules),
  and **flow formulas reject string literals containing backslashes** at
  deploy (a syntax error there, legal text in formula fields).
- ✅ **Workflow-field-update runtime facts** (gated active workflow
  rule + field update, `wfu_*` probes, DML + SOQL readback): **div-by-zero
  in an executing field-update formula blocks the entire save**
  (`CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY: A workflow or approval field
update caused an error when saving this record… Division by zero`) — the
  fourth distinct per-context runtime error behavior (formula fields render
  `#Error!`, validation rules block naming the rule, flows yield null).
  Field-update formulas execute in **blank mode** (`blank + 5` writes null,
  not 5), blank text still equals `""` (`wfu_blank_text` → EMPTY_EQ), and
  text `=` stays case-sensitive (`wfu_case_eq` → SENSITIVE).
- ✅ **Approval-process runtime facts** (19 gated ACTIVE approval
  processes, `Approval.process()` submits from anonymous Apex with a
  criteria-false control, SOQL-corroborated via
  `ProcessInstance`/`ProcessInstanceWorkitem`; `ae_*` entry-criteria and
  `as_*` step-criteria probes): **div-by-zero in entry OR step criteria
  blocks the SUBMIT, not the save** — the record inserts fine, then
  `Approval.process()` fails with `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY:
The formula in the "…" rule or process is invalid due to the following:
<br/>Division by zero` (a literal `<br/>` in the message, which names the
  process but not the step). This is the FIFTH distinct per-context error
  shape, and is cleanly distinguishable from criteria-false
  (`NO_APPLICABLE_PROCESS` for entry; step-skip for steps). Both approval
  contexts run in **blank mode** (`blank + 5 = 5` false AND
  `ISBLANK(blank + 5)` true — a complementary pair, not a double negative),
  blank text equals `""`, and text `=` is case-sensitive — agreeing with
  validation rules and field updates on all three. **ApprovalProcess
  compile-checks criteria on BOTH create and update** (bogus-function
  canaries rejected on create AND on a valid→bogus update flip), unlike
  flows and weblinks — so the approval availability verdicts carry no
  create-path caveat.

## Open-question closure pass

A two-round probe run against the standing open-questions list. Every
verdict below is encoded in the evaluator/checker and carried as org-tier
corpus rows:

- ✅ **BEGINS blank operands are asymmetric**: a blank search term coerces to
  `""` — `BEGINS("abc", blank)` is TRUE, every string begins with the empty
  string (probe `begins_blank_needle`) — while a blank subject propagates
  null: `BEGINS(blank, "a")` reads as null through NOT (probes
  `begins_blank_subject` + `begins_blank_subject_not`; a real false would
  have surfaced as `NOT(...)` = true). So BEGINS is _not_ simply blank-aware
  like CONTAINS — the evaluator implements the split per-argument.
- ✅ **ISBLANK and ISNULL compile-reject a Boolean argument** — "Incorrect
  argument type for function 'ISBLANK()'" (deploy rejections of the
  `begins_blank_*_isblank` twins and `isnull_bool_arg`). Encoded as
  `rejectTypes` in the registry; the checker reports it as a save-blocking
  error diagnostic (`argument-type-rejected`).
- ✅ **NOT() propagates an expression-level null Boolean** (probes
  `bool_null_not_cal` — folded — and `begins_blank_subject_not` — runtime:
  both read the null through to the IF's false branch).
- ✅ **Boolean equality splits by constant folding, like `^`**: at runtime a
  blank Boolean coerces to false — `nullBool = FALSE` is TRUE (probe
  `begins_blank_subject_eqfalse`, the null-checkbox-reads-false rule) —
  while the all-literal folded comparison stays three-valued —
  `IF(FALSE, TRUE, NULL) = FALSE` is false (probe `bool_null_eqfalse_cal`).
  Two probe points; the evaluator keys the split on
  contains-a-field-reference, mirroring the `^` fold model.
- ✅ **The NULL literal propagates blank in BOTH blank modes** — `NULL + 1`
  reads back null even in zero mode (probes `null_literal_add` [zero/blank],
  `null_literal_isblank`): "treat blanks as zeroes" is a read-time _field_
  coercion and never touches a typeless blank. The evaluator now propagates
  expression-level blanks through arithmetic and unary minus in both modes
  (typed blank numeric fields still materialize to 0 at read in zero mode).
- ✅ **Date arithmetic has no ceiling at year 9999** — `DATE(9999, 12, 31) +
1` computes and `TEXT()` renders `"10000-01-01"` (probes
  `date_overflow_isblank`/`_text`); ADDMONTHS, datetime arithmetic, and
  `FROMUNIXTIME(300000000000)` (≈ year 11476) all compute past 9999
  (`addmonths_overflow_isblank`, `datetime_overflow_isblank`,
  `fromunixtime_overflow_isblank`). Only `DATE()`'s own arguments are
  bounded: `DATE(0, 1, 1)` is a runtime error (`date_year_zero`), matching
  the corpus-verified `DATE(10000, …)` error — the domain is years 1–9999.
- ✅ **The product's calendar is Java's hybrid Julian/Gregorian** —
  `DATE(1582, 10, 15) - 1` renders `"1582-10-04"`: the ten-day cutover gap
  is real (probe `cutover_gap`). Construction keeps literal parts even
  inside the gap (`TEXT(DATE(1582, 10, 5))` = `"1582-10-05"`,
  `cutover_construct`), and sub-year-1 results render with no era marker —
  `DATE(1, 1, 1) - 5` = `"0001-12-27"` (`date_underflow_text`), so 1 BC and
  1 AD are indistinguishable in output. **Evaluator policy**: arithmetic
  past 9999 computes (org-verified above); construction, parts-reads, and
  TEXT of any in-range date stay supported; day-line computations
  (arithmetic, diffs, WEEKDAY/DAYOFYEAR/ISOWEEK, ADDMONTHS,
  UNIXTIMESTAMP/FROMUNIXTIME) **refuse on pre-cutover dates** rather than
  run proleptic-Gregorian math the product contradicts, and results beyond
  our representable range (year 275760) refuse rather than fake a
  Salesforce error.
- ✅ **TEXT(date) pads the year to 4 digits** — `TEXT(DATE(50, 1, 2))` =
  `"0050-01-02"`, `TEXT(DATE(950, 11, 3))` = `"0950-11-03"` (probes
  `text_date_y50`/`text_date_y950`), confirming our ISO/API-shape rendering
  (5-digit years render naturally: `"10000-01-01"`).
- ✅ **Declared field scale rounds HALF_UP at the API/storage boundary** —
  a Number(18,8) formula field holding `1/3` reads back `0.33333333` and a
  Currency(18,2) reads `0.33`, while their TEXT() twins render the full
  engine-internal 40-digit value (probes `scale_readback_number`/
  `_currency`); `0.123456785` and `0.123456786` both read back `0.12345679`
  at scale 8 (`scale_half_boundary`/`scale_updigit_boundary` — the
  exactly-half case rounds up, so the mode is HALF_UP-family, not
  truncation). Display-boundary rounding is therefore a field-boundary
  materialization the simulator's TEXT/value channels already model
  correctly; the raw-field readback shape is a channel fact, not an
  expression-level one.
- ✅ **Whitespace-only text stores as null on records** — re-confirmed
  operationally: the corpus row `testSimpleSubstitute#8` plans a `" "`
  search term, the org stores null, and SUBSTITUTE no-ops (org readback
  "Replace Space"). `orgcheck/src/generate.ts` now plans whitespace-only
  Text inputs as null so emitted rows carry the value the record actually
  holds.

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

## Numeric model (field-valued oracle, WS3)

The field-valued harness (`oracle/`, `MapFormulaContext`) evaluates bare
intermediates against the real engine; it settled the numeric-scale model:

- ✅ **39-sig-fig internal math, materialized to 32 decimal places.** Salesforce's
  `/` and `*` compute at 39 significant figures (`MathContext(39, HALF_UP)`) and
  round HALF_UP to 32 _decimal places_ only at materialization — the final result
  and each value handed to a function or comparison — **not** after every op.
  Verified raw: `(1/9)*9 → 1.000…`, `FLOOR((1/9)*9) → 1`, `1/3 → 0.333…(32)`. Our
  engine mirrors this (`evaluator.ts` `materialize`; `value.ts` runs at
  precision 40 — the oracle's 39 significant figures plus the carry digit the
  org-verified TEXT() rendering needs, see the TEXT() entry above).
- ✅ **`+` concatenates text operands** (`"aaaa" + "bbbb"` → `"aaaabbbb"`). The
  oracle's blank half (blank text operand propagates to null) is contradicted
  by the org pass: the product absorbs the blank (`"aaaa" + blank` → `"aaaa"`,
  probe rows `corpus:testAddConcatSimple#2/#3`) — org wins.

## CLAUDE.md NEEDS-VERIFICATION list — status

- ✅ **Case sensitivity of text `=` / `<>`** — oracle-verified case-sensitive,
  and re-confirmed per context: formula fields
  (`semantics:case_eq_formula_field`) and validation rules at runtime
  (`rt_case_eq`) agree.
- ✅ **Div-by-zero surfacing per context** — five distinct behaviors, all
  runtime-verified: formula fields produce a real `#Error!`
  (`semantics:divzero_isblank`/`divzero_blankvalue`); validation rules block
  the save with a system error naming the rule (`err_divzero`); flows yield
  null (flow-interview channel); workflow field updates block the save with
  `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY` (`wfu_divzero`); approval criteria
  block the SUBMIT while the save goes through (`ae_divzero`/`as_divzero`).
  `^` overflow surfacing is settled too (results > 1e64 error in both
  compile paths — see the `^` entry).
- ✅ **Blank propagation through arithmetic/comparison under both blank modes** —
  corpus-verified (corpus-driven semantics section above); validation rules
  additionally runtime-verified as blank-mode (`rt_blank_*` probes).
- ✅ **Date/datetime arithmetic edge cases** — month-end `ADDMONTHS`
  org-verified and implemented; **DST closed by analysis**: the verification
  org runs on America/Los_Angeles (DST-observing), and
  `semantics:datetime_plus_hour` shows `2026-03-08 09:30Z + 1/24 =
10:30:00Z` — one clean UTC hour across the US spring-forward instant, with
  every `TEXT(datetime)` rendering GMT regardless of org TZ. Datetime math is
  UTC-based, unaffected by org timezone. Only the oracle's Java-style
  datetime renderings remain incomparable (quarantined).
- ✅ **Numeric precision/scale limits** — internal model resolved and refined:
  40-sig-fig carry, 32-place materialization, Oracle-NUMBER-parity TEXT
  rendering (org-pass sections above). Display-boundary rounding is settled:
  the declared field scale rounds HALF_UP at the API/storage boundary while
  TEXT() sees the pre-materialization value (closure-pass section, `scale_*`
  probes).
- ✅ **Per-context function and global availability** — org-verified for every
  context whose container compile-checks formulas
  (`corpus/org-availability.json`; registry `contexts`/globals updated; those
  contexts are Tier 1 now). `email_template` is structurally unverifiable at
  deploy (no compile check) and stays Tier 2 best-effort.

## Pasted / non-ASCII characters

None of this section has an org or oracle probe behind it yet; every entry is
a deliberate conservative assumption baked into the lexer, not a settled
verdict:

- ❓ **Zero-width and other format/control characters (U+200B etc.) outside
  string literals** — we assume Salesforce's compiler rejects them in
  formula source and refuse to simulate a formula that contains one. No org
  probe has confirmed the rejection; it is plausible the compiler silently
  strips or ignores some of these instead.
- ❓ **Non-standard Unicode spaces (U+00A0 etc.) as token separators** — we
  conservatively diagnose them as errors rather than treating them as
  whitespace equivalent to the ASCII space. Whether the product's own
  compiler accepts any of them as a separator is unverified.
- ❓ **Typographic quotes as string delimiters** — the formula-engine grammar
  (`LexerRules.g4` `STRING_LITERAL`) admits only straight `'`/`"` quotes,
  which grounds the "confusable-character" diagnostic for curly quotes, but
  no golden or org test has confirmed the product rejects a curly-quoted
  string rather than, say, treating the curly quote as an ordinary text
  character.
- ❓ **Invisible characters inside string literals** — assumed legal but
  hazardous: the string still lexes and simulates, and the linter surfaces a
  warning (code `invisible-in-string`) rather than an error. Whether the
  product's own compiler treats these characters as ordinary string content
  identically to what we simulate is unverified.

## Open questions

The remaining unverified edges. Each is either refused or chosen
conservatively in the implementation; all want an org probe before being
called settled:

- **POWER()** — no corpus row in either tier pins whether it shares `^`'s
  rules (integer-only exponent, 1e64 cap, folded/runtime precision split).
  `simulatable: false` (it previously simulated through decimal.js's `pow`,
  which leaked non-finite values and fake precision). **Structurally
  unobservable by the current harness**: its only
  accepting context is custom buttons/links, and none of the five runtime
  channels reach that context — every channel's own context (formula
  fields, validation rules, flows, field updates, approvals) compile-rejects
  POWER, and a weblink's URL formula is merged client-side at click time
  with no API that returns the evaluated result. The refusal stands until a
  button-rendering channel exists.
- **Pre-cutover (Julian) day-line simulation** — the closure pass proved
  the product's hybrid Julian/Gregorian calendar (closure-pass section);
  day-line computations on pre-1582-10-15 dates currently refuse.
  Implementing hybrid arithmetic (Julian leap rules, the ten-day gap,
  weekday continuity) is well-defined and possible if demand appears, but
  sub-year-1 results render era-degenerate output (`"0001-12-27"` for a
  1 BC date), so that zone likely stays refused permanently.
- **Boolean-equality fold model** — the runtime-coerce vs folded-three-valued
  split rests on two probe points (`begins_blank_subject_eqfalse`,
  `bool_null_eqfalse_cal`). More lenses (field-based null Boolean vs
  `= TRUE`, `<>` variants, folded comparisons with one field far away)
  would firm the contains-a-field-reference discriminator.
- **Arithmetic upper bound** — org-verified to compute through at least
  ≈ year 11476 (`fromunixtime_overflow_isblank`); whether the product has
  any ceiling at all is unprobed. We refuse past our representable
  year 275760.
- **`email_template` availability** — structurally unverifiable (its
  metadata container never compile-checks merge formulas at deploy); stays
  Tier 2 best-effort unless a new observation channel appears.
- **Constant-fold boundary for computed-from-literal operands** — the WS4
  fuzzer (seed 1) caught the OSS engine constant-folding whole
  constant expressions where our model folds only bare literals
  (`isFoldedNumericLiteral`): `SQRT(1234.5 - 12.125) ^ 3` and
  `(1000 / 1.5 * 7) ^ 2` come back 18-significant-digit folded from the
  oracle while we take the runtime path (43-sig exact ceiling → refusal),
  and `LEN(TEXT(ROUND(0.1, 2)))` reads 3 there (conventional `"0.1"`)
  against our product-render 2 (`".1"`). Indirect org evidence favors our
  narrow model — org-verified `TEXT(4/3)` renders at the 39-digit runtime
  budget, not 18-sig folded — but the boundary itself is unprobed. Probes
  staged: `semantics:pow_fold_boundary_arith`,
  `semantics:pow_fold_boundary_func`,
  `semantics:text_measure_leading_zero`. Until settled, fuzz triage routes
  both shapes to org-probe-candidate rather than suspected our-bug.
- **`VALUE("")` — blank or error** — the WS4 fuzzer (seed 1) has
  the oracle throwing `NumberFormatException` ("Character N …" — null
  apparently stringified into `"NaN"` before parsing) for
  `ABS(0) / CEILING(VALUE(""))` where we propagate blank end to end. The
  error shape smells like an OSS-engine blank-handling artifact, and the org
  has overruled OSS-only errors before (`MOD(x, 0)` = x), but whether the
  product returns blank or an error — and whether a blank divisor stays
  blank or coerces into a division by zero — is unprobed. Probes staged:
  `semantics:value_empty_text`, `semantics:value_empty_text_composed`
  (bisectable pair). Fuzz triage routes oracle-error-over-our-blank to
  org-probe-candidate.
