# CONFORMANCE.md — Validating against Salesforce's open-source engine

Salesforce open-sourced its formula engine: **[salesforce/formula-engine](https://github.com/salesforce/formula-engine)**
(BSD-3-Clause, Java, actively maintained — v0.9.13 as of 2026). Because it is
Salesforce's _own_ engine, it is the authoritative oracle for how our parser and
evaluator must behave. This document describes how the project uses it: the
trust model, the offline oracle pipeline, and the CI conformance gate.

## Trust order (who wins on disagreement)

Extends DESIGN §10:

```
org-verified test  >  formula-engine oracle  >  formulon
```

- **Org-verified tests** are probes run against a real Salesforce Developer
  Edition org (`orgcheck/`; results ledger in VERIFICATION.md). They observe
  the product itself, so they are the final word.
- **formula-engine** is Salesforce's open-source Java engine, used as an
  offline oracle as described below.
- **[formulon](https://github.com/leifg/formulon)** (MIT) is a pre-existing
  open-source JavaScript implementation of the Salesforce formula language.
  Our evaluator's function implementations and seed tests were ported from it
  (DESIGN §4), which is why it appears throughout these docs — it is the
  baseline we ported from and diverge from deliberately. As a community
  reimplementation rather than Salesforce code, it ranks lowest.

**Caveat that shapes everything:** the open-source engine may not be identical
to the production product. Its grammar exposes operators the product docs don't
mention (`&&`, `||`, `==`, `!=`). So where the OSS engine disagrees with
documented product behavior, an **org-verified** test is the tiebreaker — the
OSS engine is authoritative _for its own behavior_, and a very strong signal
for the product, but not a substitute for org verification on contested points.
(Those four undocumented operators turned out to be real product behavior: the
org accepts and evaluates all of them — see VERIFICATION.md.)

## Two independent uses of the oracle

The engine helps in two ways with very different cost profiles. Keep them separate.

### Use 1 — Grammar as a static reference (no JVM)

The grammar is plain files we can read:

- `impl/src/main/antlr4/com/force/formula/parser/gen4/Formula.g4` — expression
  grammar; **precedence is explicit in rule nesting** (outer rule = lower
  precedence).
- `impl/src/main/antlr4/imports/LexerRules.g4` — token rules: identifier chars,
  keywords, comment syntax.

Reading these settled our grammar/precedence/identifier/comment questions
directly, with the grammar as citation — no runtime needed. The discrepancies
it surfaced in our implementation are recorded in "Grammar findings" below,
all since resolved.

### Use 2 — Engine as an output oracle (JVM; offline corpus generation)

For evaluator conformance:

- Construct: `FormulaFactory.create(context, source, properties)`.
- Evaluate: `Formula.evaluate(FormulaRuntimeContext)` — the **Java direct-eval
  path**, which is the faithful oracle.
- Blank mode: `FormulaProperties.setTreatNullNumberAsZero(boolean)` models the
  org-level "treat blanks as zeroes" toggle DESIGN requires.
- Div-by-zero: the Java path throws `ArithmeticException` (→ our `#Error!`). The
  `toJavascript()` path instead returns `null` for `1/0`, so **do not use the
  generated-JS path as the div-by-zero oracle** — it would teach the evaluator a
  wrong answer. Use Java eval.

## Architecture: the corpus is the firewall

The JVM oracle **never** runs in our app or in the fast CI loop. It runs _offline_
(a dev step / periodic job) and its **output** — committed `corpus/*.json` —
is what our TypeScript tests consume:

```
[formula-engine, JVM]  --generates-->  corpus/*.json  --consumed by-->  [our TS tests, Node]
        offline, periodic                committed asset              every CI run, no JVM
```

This keeps the shipped product pure client-side and the main test loop
JVM-free, and makes the corpus the durable, language-agnostic asset DESIGN §10
describes. Every corpus row carries provenance and a trust tier.

## What "beat for beat" means (the comparison surface)

- **Parser:** _accept/reject parity_ + _semantic equivalence via evaluation_. A
  precedence or associativity bug shows up as a wrong evaluated value, so the
  corpus validates the parse tree indirectly and decisively.
- **Not** error message / position parity. Our error **recovery** is a deliberate
  superset: where the OSS parser stops at the first error, we produce a partial
  AST and multiple positioned diagnostics. That divergence is expected
  and allowlisted, never a conformance failure.
- **Evaluator:** exact decimal value equality and typed-error equality
  (div-by-zero → `#Error!`), under **both** blank modes.
- **Trivia:** we preserve comments (the OSS lexer `-> skip`s them). Superset, not
  a failure.

### Intentional divergences (allowlisted — never counted as failures)

- Error recovery (partial ASTs, multiple diagnostics).
- Comment preservation.
- Diagnostic wording/position (we position and recover; they don't).
- Simulation boundary refusing org-state functions (by design, rule 1).

## Pipeline components

The conformance pipeline was built as five workstreams (WS1–WS5); the labels
survive in commit history, VERIFICATION.md, and probe names, so they are kept
here as component names. All five are in place.

### WS1 — Grammar reconciliation

`Formula.g4` and `LexerRules.g4` were read and diffed against our
lexer/parser; mismatches were fixed and locked in with tests encoding the
grammar's precedence and associativity. The findings are tabulated under
"Grammar findings" below; the corresponding VERIFICATION.md entries are
grammar-backed and, where the grammar alone couldn't settle product behavior,
org-verified.

### WS2 — Imported golden corpus

`corpus/sources/formulaTestV2.xml` (vendored from the engine repo) holds **404
`<testcase>`s**, each with a formula, `<referenceField>` type declarations,
`executionPaths` (`formula`/`sql`/`javascript`/`javascriptLp` × {default,
`NullAsNull`}), and `<testData input= expectedOutput=>` rows — i.e. exactly a
`(formula, inputs, blankMode, expected)` corpus, including both blank modes.
A Node extractor (`scripts/extract-corpus.ts`) converts it to
`corpus/salesforce-v2.json`, taking the Java `formula`/`formulaNullAsNull`
expected values (faithful for div-by-zero). See `corpus/README.md`.

The engine repo also carries a legacy fixture set (`formulatests.xml` /
`formulatests-math.xml` plus 113 `data/` input templates). Assessed
2026-07-30: it is subsumed by V2. 404 of its 406 testcases were migrated
(the legacy file's own header says as much), and the data templates map onto
V2's inline rows at equal-or-better coverage (5,569 legacy rows vs 5,508 in
V2; the only per-testcase surpluses sit on constant formulas —
`IF(true,1,0)`, `ROUND(PI(),12)` — whose data files the formula never
reads). Of the two unmigrated testcases, one is commented out and written in
the weblink merge-field dialect (`{!…}`), outside our language. The one
novel behavior — `testIfErrorDateTimeValueWithBadElse`: IFERROR whose
fallback *also* errors — was captured through the WS3 harness
(`oracle/probes.iferror-badelse.txt`) and locked as a golden test in
`src/engine/evaluator.test.ts` (the fallback's error propagates; a clean
first argument never evaluates the fallback).

### WS3 — JVM oracle harness (`oracle/`)

A Maven harness reusing test-utils' `MockLocalizerContext` +
`MockFormulaContext`, driving `FormulaEngine.getFactory().create(...).evaluate(...)`
— the faithful Java path. It reads `TYPE<TAB>FORMULA` probes and prints the
oracle's result/error, covering both constant expressions and field-valued
evaluation (`MapFormulaContext`). formula-engine is built **from source** at
the pinned tag `v0.9.13` (Maven Central lags); a `.#oracle` Nix devShell
provides `jdk` + `maven`. See `oracle/README.md`.

The harness derived and verified the numeric-scale, `^`, `SQRT`, `MOD`,
`ROUND`, Percent, and case-sensitivity rules, and the field-valued extension
settled the internal numeric model — all recorded in VERIFICATION.md.

### WS4 — Differential fuzzing (`oracle/fuzz/`)

A grammar-driven random formula generator (derived from `Formula.g4`) feeds
both engines and diffs the results. Each discrepancy is triaged into:
(a) **our bug** → fix + capture the case as a permanent regression row;
(b) **OSS ≠ product** → org-verify; (c) **intentional divergence** →
allowlist. Runs weekly in `oracle.yml` (the job fails when the
suspected-our-bug bucket is non-empty); every discrepancy becomes a corpus row.

### WS5 — CI conformance number (`.github/workflows/`)

Fast CI (`ci.yml`) runs our TS engine against the committed corpus on every
push/PR — typecheck, lint, unit + conformance tests, browser smoke tests, build —
and surfaces the pass rate (the **conformance number**, the project's headline
metric) to the job summary. No JVM. A separate _scheduled_ workflow
(`oracle.yml`) builds the JVM oracle as a canary, re-runs the corpus extractor
and opens a drift PR when the committed corpus diverges, and runs the WS4
differential fuzzer weekly.

## Status

Both conformance tiers are at **100%**, with ratchet baselines locked at 1. The
oracle tier (`src/engine/conformance.test.ts`) passes 6,312/6,312 comparable
rows (1,394 quarantined as incomparable, 1,982 unsupported, 9,688 total); the
org tier (`src/engine/org-conformance.test.ts`) passes 664/664 comparable rows
(6 unsupported of 670 — honest refusals such as pre-Gregorian day-line rows —
no quarantined rows). Oracle rows the real org has
overruled are excluded from the comparable set by an evidence-backed allowlist
in `conformance.test.ts`, each entry naming the org-verified row that
supersedes it.

How the number got there, briefly: the WS3 oracle rules took the pass rate
0.74 → 0.86; a corpus-driven semantics pass (FLOOR/CEILING toward-zero,
zero-mode numeric coercion, three-valued blank comparison, blank propagation,
DATE bounds) reached 0.97; a function port moved ~740 rows out of
"unsupported" into the comparable set; the field-valued oracle settled the
numeric model (0.99); and the real-org probe waves plus corpus regeneration
and the org-overruled allowlist closed the remaining gap. The full ledger of
what each step verified lives in VERIFICATION.md.

## Licensing

`formula-engine` is BSD-3-Clause; `formulon` is MIT. We ship neither. The
vendored formula-engine source that builds the WS3 harness is a build-time
dependency, attributed in `NOTICE`. Corpus rows derived from their test data
(formula→result facts) carry provenance tags and a BSD-3 attribution note in
`NOTICE`.

## Grammar findings (WS1) — all resolved

Read directly from `Formula.g4` (nesting = precedence, tightest→loosest):
`unary > * / > ^ > + - & > < <= > >= > = <> == != > && > ||`, **all
left-associative**.

| #   | Finding                       | Ours (before)                            | SF grammar                      | Resolution                                                                                                                                                                      |
| --- | ----------------------------- | ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `&` (concat) precedence       | below `+ -`                              | **same level as `+ -`**         | Fixed; org-probed as far as observable (the `+ - &` order is unobservable in accepted formulas)                                                                                 |
| 2   | `* /` vs `^`                  | `^` binds tighter                        | **`* /` bind tighter than `^`** | Fixed; org-verified (`2 * 3 ^ 2` = 36) despite inverting math convention                                                                                                        |
| 3   | `^` associativity             | right                                    | **left**                        | Fixed; org-verified (`2 ^ 3 ^ 2` = 64)                                                                                                                                          |
| 4   | `&&` / `\|\|`                 | not tokenized (`&&`→two `&`; `\|`→error) | accepted operators              | Org-verified as real product behavior; lexed, parsed, evaluated as AND/OR, flagged `nonstandard-operator`                                                                       |
| 5   | `==` / `!=`                   | parsed, warned "nonstandard"             | first-class equality ops        | Org-verified as accepted; still flagged `nonstandard-operator` (the product docs omit them)                                                                                     |
| 6   | identifier continuation chars | `[A-Za-z0-9_]`                           | grammar also lists `$ : . #`    | Org-verified: `:`/`#` lex as identifier chars but no real field name can contain them; our lexer keeps splitting, and the diagnostic reads as unknown-field, not a syntax error |

Details and probe ids for every row live in VERIFICATION.md's "Syntax /
parsing" section.
