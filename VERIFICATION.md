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
- ✅ **String-literal escapes** (oracle-verified 2026-07-29, engine v0.9.13,
  `LEN`/`FIND` probes; org unprobed but the grammar and engine agree). The
  grammar (`LexerRules.g4` `STRING_LITERAL`) accepts exactly nine escapes —
  `\n \r \t \N \R \T \" \' \\` — and any other backslash sequence is a
  syntax error (`"a\qb"` fails to compile; we diagnose `invalid-escape`
  and recover). The engine *collapses only two*: `\\` → `\` and `\" `→ `"`
  (`LEN("\\")` = 1, `LEN("a\"b")` = 3, in both quote styles). Every other
  accepted escape keeps both characters: `\n` is literal backslash-n
  (`LEN("a\nb")` = 4, never a newline), and `\'` keeps its backslash even
  inside single quotes (`LEN('a\'b')` = 4) while still not terminating the
  string. Encoded in `parser.test.ts`; worth an org probe eventually since
  only the JVM oracle has confirmed the decode half.

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
  blank-mode semantics is correct config. Workflow field updates likewise
  runtime-verified as blank mode (wave 4, `wfu_blank_add`: `blank + 5` writes
  null), and both approval contexts too (wave 6, `ae_blank_add` /
  `ae_blank_add_null` complementary pair).
- ✅ **Source character limit org-verified**: a 3,916-char formula-field
  source rejects with "Formula is too long (3,916 characters).  Maximum
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

## Function port, round 2 (registry coverage — 2026-07-28)

The registry grew 66 → 101 functions after auditing against the official
function reference (all additions doc-confirmed; the wave-2 matrix probes
their per-context availability). Corpus-backed and simulated:

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

Temporal semantics unlocked with them (conformance comparable set grew
5,032 → 6,081 rows; oracle tier 99.3%, org tier 100%):

- ✅ **Date arithmetic**: `date ± n` truncates the fractional day toward zero
  (28 + 3.5 → Mar 2); `date − date` → whole days; `datetime ± n` in
  fractional days at millisecond resolution; `datetime − datetime` →
  fractional days (1.375). Temporal ordering/equality (`date > date`,
  CASE over dates) compare by instant.
- ✅ **Time arithmetic**: `time ± n` in milliseconds — a result past midnight
  wraps (+26h ≡ +2h) but a negative one is a runtime error;
  `time − time` → milliseconds, wrapping forward a day when negative
  (testSubtractTwoTimeFields: earlier − later = 24h − gap).
- ✅ **`ADDMONTHS` end-of-month rule was latent-broken**: the org-verified
  Feb 28 + 1 = Mar 31 behavior was documented and quarantine-masked but never
  implemented; the new temporal comparison exposed and fixed it.
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

Their per-context availability is org-verified (the wave-2 matrix now
includes a `formula_field` container, so FF availability is probed uniformly
too). Highlights encoded in `functions.ts`: **`REGEX` is not available in
formula fields** (validation rules and most others accept it); the **encode
family** (`HTMLENCODE`/`JSENCODE`/`JSINHTMLENCODE`/`URLENCODE`) lives only in
flows and custom buttons; **`HYPERLINK`** only in formula fields and flows,
**`IMAGE`** only in formula fields; **`BR`** everywhere except buttons;
**`IMAGEPROXYURL`/`JUNCTIONIDLIST`** were rejected by every verifiable
context (email templates are their only plausible, unverifiable home);
**`ISCLONE`** matches the change-tracking contexts; **`UNIXTIMESTAMP`** is
rejected only by quick actions; **`DISTANCE`/`GEOLOCATION`** everywhere
except buttons.

## Wave-3 value pass (2026-07-28) — refuse-list graduations

Value probes (formula-field readback plus a new **flow interview channel**:
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
  `OR(TRUE, …)`, and the undocumented `&&` all skip an erroring operand
  (`ff_shortcircuit_*`).
- ✅ **`TEXT(percent)` renders the internal ÷100 value** through the product
  renderer (99% field → `".99"`, `× 2` → `"1.98"`) — the last TEXT
  quarantine is resolved.
- ⛔ **`CASESAFEID` stays refusing**: the 18-char suffix algorithm is
  confirmed for a real prefix (`001…` → `…AAA`) but the function *validates*
  its input against the org's key-prefix registry (a 15-char non-ID passes
  through unchanged, `casesafeid_mixed`) — org state a client cannot know.
- ✅ **`^` fully bisected (waves 4+5)**: the operator has TWO code paths,
  split by compile-time constant folding of all-literal operands.
  **Folded (literal `^` literal), positive exponent: the exact value rounded
  to 18 significant digits, HALF_UP** — digit-exact across nine wave-5
  probes (`pw5_dbl_*`: 3^34 comes back exact at 17 digits, which no IEEE
  double can produce; 3^39/7^25/6^30/2^90/1.5^350/0.7^80 all match
  exact-18-sig and NOT the double — 0.7^80's double diverges in digit 16).
  This retracts wave 4's IEEE-double reading of `2^100`/`3^40`: both values
  coincidentally equal exact-18-sig, and the discriminating probes picked
  exact-18-sig. Folded results render literal-style (leading zero kept:
  `TEXT(0.7^80)` = `0.000…`, `TEXT(0.23^25)` likewise; parens fold away,
  `TEXT((0.5))` = `0.5`) while computed values drop the zero even at tiny
  scale (`TEXT(1/4)` = `.25`, `pw6_div_quarter` — the fold model, not a
  scale threshold, drives the leading zero). Folded deep fractions are
  never tail-truncated — `0.5^76` keeps all 18 digits through place 40
  (`pw7_clamp_05_76`, killing the scale-clamp reading) — they are either
  kept whole or FLUSHED to zero, and the line is **truncation at 1e-39**:
  `0.5^129` ≈ 1.47e-39 keeps all 18 digits while `0.5^130` ≈ 7.35e-40
  flushes even though it would ROUND up to 1e-39 (`pw8_flush` bisect +
  `pw8b` adjacent straddle — the boundary is probe-pinned, no bracket
  remains).
  **Runtime (one field operand suffices, `pw6_rt_mixed`) and every negative
  exponent in either path: decimal at scale 42, HALF_UP** — digit-exact on
  field-valued `0.7^80` / `0.5^132` / `3^-25` and literal `3^-25` / `7^-20`
  / `9^-30`; field-valued `3^40` returns the exact `…801` where the folded
  form rounds to `…800` (`pw6_rt_int`); `1.00596^240`'s 39 rendered digits
  are the TEXT 39-sig budget over a scale-42 value (#18); `(1e-13)^1000` →
  0 falls out of the scale (#20); `99^-1`'s 40 rendered places likewise
  (budget, not value scale).
  **Cap: results past 1e64 are runtime errors in BOTH paths and both
  exponent signs** (`10^64` computes; literal `10^65`/`2^213`/`9^68`/
  `(10^40)^2` error; field-valued `10^80` errors, `pw6_rt_cap`; the
  `0.1^-70` reciprocal errors, `pw7_recip_cap`); the cap is `^`-only
  (1e180 via `*` computes) and does not bind tiny values.
  **Runtime precision limit — pinned at 43 significant digits for EXACT
  results**: #18 (43 sigs) computes; `7^52`/`7^53`/`7^54`/`7^55` (44–47
  digits) all error (`pw8_prec` bisect — 43/44 adjacent). Terminating
  reciprocals share the exact path and its limit: `0.5^-10` = `1024` in
  both compile paths while `0.5^-145` (2^145, 44 digits) errors
  (`pw8_recip`/`pw8b_recip_big_term`). **Non-terminating reciprocals
  escape by rounding**: `0.3^-5` through `0.3^-72` compute, digit-exact
  against a ≥ 40-sig rounding of the true value rendered through the TEXT
  budget — up to a magnitude line at **1e38** (38 integer digits compute,
  39 error; adjacent `pw8c`/`pw8d` probes — Oracle NUMBER's precision-38
  ceiling showing through). The evaluator takes an exact BigInt path for
  results ≥ 10 so true significance is known rather than read off a
  rounded carry.
  **Edges**: `0^0` = 1 in both paths (`pw5_zero_zero`, #1–#3); `0^negative`
  is a runtime `#Error!`, not blank (`pw6_zeroneg_blank`: `ISBLANK(0^-1)`
  errors the whole formula). The numeric-rendering quarantine remains
  empty.
- ✅ **WS4-derived function edges (wave 7)**: `FIND` with an empty search
  term returns **0**, not 1 (`pw7_find_empty_needle`, and
  `FIND("", "")` = 0 too) — the JVM oracle was right and our indexOf-based
  1 was a bug, fixed. `VALUE("")` is **blank** while `VALUE(" ")` is a
  runtime **`#Error!`** (`pw7_value_empty`/`pw7_value_space`) — the org
  SPLITS what the oracle blankets as null, so probing beat adopting the
  oracle verdict wholesale.
- ✅ **Empty text IS blank — universally (wave 8)**: every empty-producing
  text operation reads back blank through `ISBLANK` — `LEFT`/`MID`/`RIGHT`
  at length 0, `TRIM(" ")`, `SUBSTITUTE` deleting everything, `UPPER("")`,
  and even `"" & ""` (`pw8_be_*` riders; `TEXT(blank)` too). The product's
  value domain has no empty-string state distinct from null. The evaluator
  normalizes every operation result accordingly, and the 18 oracle rows
  that expected `""` from a blank argument (`testUpper`/`testLower`/
  `testInitCap` and locale variants) are org-overruled — the oracle encodes
  a distinction the product cannot represent.
- ✅ **Approval-criteria AND/OR short-circuit (wave 8)**: `AND(false,
  1/0=1)` reads criteria-false (`NO_APPLICABLE_PROCESS` / step-skip) and
  `OR(true, 1/0=1)` submits cleanly in BOTH approval contexts
  (`ae_sc_*`/`as_sc_*` on isolated objects) — matching validation rules.
  `IFERROR` needs no runtime probe there: it is compile-rejected in both
  approval contexts (wave-2 availability matrix, "Unknown function
  IFERROR").
- Flow-context runtime facts: **div-by-zero yields null in a running flow**
  (vs `#Error!` in formula fields and a blocked save in validation rules),
  and **flow formulas reject string literals containing backslashes** at
  deploy (a syntax error there, legal text in formula fields).
- ✅ **Workflow-field-update runtime facts** (wave 4; gated active workflow
  rule + field update, `wfu_*` probes, DML + SOQL readback): **div-by-zero
  in an executing field-update formula blocks the entire save**
  (`CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY: A workflow or approval field
  update caused an error when saving this record… Division by zero`) — the
  fourth distinct per-context runtime error behavior (formula fields render
  `#Error!`, validation rules block naming the rule, flows yield null).
  Field-update formulas execute in **blank mode** (`blank + 5` writes null,
  not 5), blank text still equals `""` (`wfu_blank_text` → EMPTY_EQ), and
  text `=` stays case-sensitive (`wfu_case_eq` → SENSITIVE).
- ✅ **Approval-process runtime facts** (wave 6; 19 gated ACTIVE approval
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
  flows and weblinks — so the wave-2 approval availability verdicts carry
  no create-path caveat.

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

`src/engine/conformance.test.ts` (oracle tier) sits at 99.3% over 6,081
comparable rows (42 failures — the org-overruled clusters plus the
TEXT-of-blank-date tail); `src/engine/org-conformance.test.ts` (org tier) is
at 100% of 517 comparable rows with a single quarantined row
(`semantics:text_percent_field`). Remaining items, each needing its own
verification before a fix:

- ✅ **Date arithmetic** — implemented and corpus-verified (function-port-2
  section above); Java-style datetime renderings in the oracle remain
  incomparable (quarantined), and `TEXT(datetime)` renders the documented GMT
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
- ✅ **Div-by-zero surfacing per context** — five distinct behaviors, all
  runtime-verified: formula fields produce a real `#Error!` (wave 1);
  validation rules block the save with a system error naming the rule
  (wave 2, `err_divzero`); flows yield null (wave 3); workflow field updates
  block the save with `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY` (wave 4,
  `wfu_divzero`); approval criteria block the SUBMIT while the save goes
  through (wave 6, `ae_divzero`/`as_divzero`). `^` overflow surfacing
  settled in waves 4–6 (result > 1e64 errors, both compile paths).
- ✅ **Blank propagation through arithmetic/comparison under both blank modes** —
  corpus-verified (semantics-pass section above); validation rules
  additionally runtime-verified as blank-mode (wave-2 `rt_blank_*` probes).
- ✅ **Date/datetime arithmetic edge cases** — month-end `ADDMONTHS`
  org-verified and implemented; **DST closed by analysis**: the verification
  org runs on America/Los_Angeles (DST-observing), and
  `semantics:datetime_plus_hour` shows `2026-03-08 09:30Z + 1/24 =
  10:30:00Z` — one clean UTC hour across the US spring-forward instant, with
  every `TEXT(datetime)` rendering GMT regardless of org TZ. Datetime math is
  UTC-based, unaffected by org timezone. Only the oracle's Java-style
  datetime renderings remain incomparable (quarantined).
- 🔬 **Numeric precision/scale limits** — internal model resolved and refined:
  40-sig-fig carry, 32-place materialization, Oracle-NUMBER-parity TEXT
  rendering (org-pass sections above); rounding at display boundaries per
  field scale remains open.
- ✅ **Per-context function and global availability** — org-verified for every
  context whose container compile-checks formulas
  (`corpus/org-availability.json`; registry `contexts`/globals updated; those
  contexts are Tier 1 now). `email_template` is structurally unverifiable at
  deploy (no compile check) and stays Tier 2 best-effort.

## Open follow-ups

Wave 3 (2026-07-28) closed: FF short-circuit ✅, Percent TEXT ✅,
ISPICKVAL/INCLUDES coercion ✅, flow-interview runtime channel ✅ (built —
`flowValueProbes` in `orgcheck/probes/contexts.json`), and the refuse-list
graduations above.

Wave 4 (2026-07-29) closed: `^` overflow bisect ✅ (1e64 result cap;
wave 4's scale-40/IEEE-double model was corrected by wave 5 — see the
org-pass section), source/compiled size limits ✅ (3,900 source / 15,000
compiled, exact), Text output truncation at 1,300 chars ✅, WFU runtime
channel ✅ (`wfu_*` probes: blocked save on div-by-zero, blank mode,
case-sensitive `=`), DST closed by analysis (datetimes are GMT instants;
the org applies no zone arithmetic a client must reproduce).

Waves 5+6 (2026-07-29) closed: the `^` fold/runtime split (18-sig folded;
runtime and all negatives at scale 42 — see the org-pass section; the
wave-4 IEEE-double reading is retracted), `0^0` = 1, `0^negative` = runtime
error, the cap in both paths (literal and field-valued), the fractional-
base cap (`1.5^400` errors), the fold-based leading-zero rendering model
(`TEXT(1/4)` = `.25`, `TEXT((0.5))` = `0.5`), and mixed-operand behavior
(one field blocks folding). Still open:

Wave 7 (2026-07-29) closed: the reciprocal cap ✅ (`0.1^-70` errors),
`FIND` empty search term = 0 ✅ (our bug, fixed), and the
`VALUE("")`/`VALUE(" ")` split ✅ (blank/error — the org overrules the
oracle on whitespace).

Wave 8 (2026-07-29) closed every remaining probe sliver: the folded flush
line ✅ (truncation at 1e-39, adjacent-probe-pinned), the exact-result
precision limit ✅ (43 significant digits, 43/44 adjacent), terminating
reciprocals ✅ (exact path, same limit), non-terminating reciprocals ✅
(≥ 40-sig rounding up to the 1e38 magnitude line, 38/39 adjacent),
empty-text-is-blank ✅ (the whole WS4 blank-vs-empty cluster resolved by
one rule; 18 oracle rows org-overruled), approval AND/OR short-circuit ✅,
and approval `IFERROR` ✅ (closed by the availability matrix — it never
compiles there). `CASESAFEID`'s explanatory note shipped earlier; the
refusal itself is permanent (org-state prefix validation).

The `^` operator now refuses in exactly one situation: an exact form too
large to compute and verify (bases within ~1e-4 of 1 raised to
multi-thousand exponents). Everything else about the operator is
org-verified behavior. Remaining non-probe debts:

- Oracle corpus regeneration (the `textarea`→Text fix is inert until
  `salesforce-v2.json` is re-extracted; the extractor's `trim()` bug
  destroys whitespace-bearing values; `phone`/`email`/`url` dataTypes
  unmapped pending org probes).
- WS5 remainder: scheduled fuzz runs and corpus-regeneration drift PRs.
- ~~Registry function coverage~~ — closed 2026-07-28: audited against the
  official reference (101 functions registered; 35 added, of which 16
  corpus-backed and simulated — see the function-port-2 section). The wave-3
  graduations closed the client-reproducible refuse list (encode family,
  `BR`, `INCLUDES`, `PICKLISTCOUNT`, `FORMATDURATION`); `CASESAFEID` is the
  one deliberate holdout (org-state prefix validation).

## Pre-release audit (2026-07-29) — new unverified edges

Behaviors the audit made explicit. Each is either refused or chosen
conservatively; all want an org probe before being called settled:

- **POWER()** — no corpus row in either tier pins whether it shares `^`'s
  rules (integer-only exponent, 1e64 cap, folded/runtime precision split).
  Now `simulatable: false` (it previously simulated through decimal.js's
  `pow`, which leaked non-finite values and fake precision). Probe POWER
  against `^` on the same inputs next org run. Note its availability data
  says `custom_button_link` only.
- **BEGINS(blank operands)** — follows the generic null-propagation wrapper
  (returns blank), while its siblings CONTAINS/FIND are org-verified
  blank-aware (coerce to ""). Zero blank-operand BEGINS rows exist in either
  corpus; the asymmetry is *suspicious but unprobed*, so behavior was left
  alone. Probe `BEGINS("abc", blank)` / `BEGINS(blank, "a")`.
- **Temporal overflow boundaries** — date/datetime arithmetic, ADDMONTHS and
  FROMUNIXTIME now error outside year 1–9999 instead of producing NaN dates
  or years DATE() itself rejects. The *products'* exact boundary and error
  surfacing are unverified; ours is chosen for internal consistency with
  DATE()'s validated range.
- **Typeless blanks in blank-mode arithmetic** — `NULL + 1`, unsupplied
  fields, and CASE fallthroughs now propagate blank like typed blank fields
  (matching the unary branch; corpora bit-identical either way). The NULL
  *literal* case has no probe row.
- **Sub-1000-year TEXT(date) rendering** — years now pad to 4 digits
  ("0050-01-01", ISO/API shape). No corpus row covers years below 1000.
