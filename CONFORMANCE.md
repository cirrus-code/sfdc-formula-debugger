# CONFORMANCE.md — Validating against Salesforce's open-source engine

Salesforce open-sourced its formula engine: **[salesforce/formula-engine](https://github.com/salesforce/formula-engine)**
(BSD-3-Clause, Java, actively maintained — v0.9.13 as of 2026). Because it is
Salesforce's _own_ engine, it is the authoritative oracle for how our parser and
evaluator must behave. This document is the plan for using it.

## Trust order (who wins on disagreement)

Extends DESIGN §10:

```
org-verified test  >  formula-engine oracle  >  formulon
```

**Caveat that shapes everything:** the open-source engine may not be identical to
the production product. Its grammar exposes operators the product docs don't
mention (`&&`, `||`, `==`, `!=`). So where the OSS grammar disagrees with
documented product behavior, an **org-verified** test is the tiebreaker — the OSS
engine is authoritative _for its own behavior_, and a very strong signal for the
product, but not a substitute for org verification on contested points.

## Two independent uses of the oracle

The engine helps in two ways with very different cost profiles. Keep them separate.

### Use 1 — Grammar as a static reference (no JVM; start now)

The grammar is plain files we can read:

- `impl/src/main/antlr4/com/force/formula/parser/gen4/Formula.g4` — expression
  grammar; **precedence is explicit in rule nesting** (outer rule = lower
  precedence).
- `impl/src/main/antlr4/imports/LexerRules.g4` — token rules: identifier chars,
  keywords, comment syntax.

Reading these settles our grammar/precedence/identifier/comment questions
directly, with the grammar as citation — no runtime needed. It has already
surfaced concrete bugs (see Backlog).

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
        offline, one-time / periodic        committed asset              every CI run, no JVM
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

## Workstreams

### WS1 — Grammar reconciliation _(now, no JVM)_

Read `Formula.g4` + `LexerRules.g4`; diff against our lexer/parser; fix; add
tests that encode the grammar's precedence/associativity; upgrade the relevant
VERIFICATION.md entries from ❓ to grammar-backed. Seed list in Backlog below.

### WS2 — Import their golden corpus _(no JVM)_

`impl/src/test/resources/com/force/formula/impl/formulaTestV2.xml` holds **404
`<testcase>`s**, each with a formula, `<referenceField>` type declarations,
`executionPaths` (`formula`/`sql`/`javascript`/`javascriptLp` × {default,
`NullAsNull`}), and `<testData input= expectedOutput=>` rows — i.e. exactly a
`(formula, inputs, blankMode, expected)` corpus, including both blank modes.
Write a **Node XML extractor** → `corpus/salesforce-v2/*.json`, taking the Java
`formula`/`formulaNullAsNull` expected values (faithful for div-by-zero).
Secondary: 113 legacy fixture files (rounding/date edge cases).

### WS3 — JVM oracle harness ✅ _(built — `oracle/`)_

Implemented: a Maven harness reusing test-utils' `MockLocalizerContext` +
`MockFormulaContext`, driving `FormulaEngine.getFactory().create(...).evaluate(...)`
— the faithful Java path. Reads `TYPE<TAB>FORMULA` probes, prints the oracle's
result/error. formula-engine is built **from source** at the pinned tag `v0.9.13`
(Maven Central lags); a `.#oracle` Nix devShell provides `jdk` + `maven`. See
`oracle/README.md`.

Used to derive and verify the numeric-scale, `^`, `SQRT`, `MOD`, `ROUND`,
Percent, and case-sensitivity rules that lifted conformance **74% → 86%** (all
recorded in VERIFICATION.md). Current scope evaluates constant expressions
(blank fields), enough for the numeric/precision/error levers. Field-valued
generation (`MapFormulaContext`) for full corpus regeneration and WS4 fuzzing is
the next extension.

### WS4 — Differential fuzzing _("no excuse to be incorrect")_

A grammar-driven random formula generator (derived from `Formula.g4`) feeds both
engines; diff results; triage each discrepancy into: (a) **our bug** → fix +
capture the case as a permanent regression row; (b) **OSS ≠ product** →
org-verify; (c) **intentional divergence** → allowlist. Runs as a periodic job;
every discrepancy becomes a corpus row.

### WS5 — CI conformance number ✅ _(`.github/workflows/`)_

Fast CI (`ci.yml`) runs our TS engine against the committed corpus on every
push/PR — typecheck, lint, unit + conformance tests, browser smoke tests, build —
and surfaces the pass rate (the **conformance number**, the project's headline metric) to the
job summary. No JVM. A separate _scheduled_ workflow (`oracle.yml`) builds the
JVM oracle as a canary; corpus regeneration/expansion via WS3/WS4 with a drift PR
is the remaining automation.

## Status snapshot

Oracle-tier conformance is **99.3%** (`src/engine/conformance.test.ts`,
baseline locked at 0.98); **org-tier conformance is 100%** of comparable rows
(`src/engine/org-conformance.test.ts`) with one quarantined Percent-TEXT row.
Path so far: WS3 oracle rules 0.74 → 0.86; a corpus-driven semantics pass
(FLOOR/CEILING toward-zero, zero-mode numeric coercion, three-valued blank
comparison, blank propagation, DATE bounds) → 0.97; a function port (TRUNC,
MFLOOR/MCEILING, SUBSTR, INITCAP, REVERSE, ASCII, CHR, IFERROR) moved ~740
rows out of "unsupported" into the comparable set; the field-valued oracle
settled the numeric model → 0.99; the real-org passes (wave 1 semantics
2026-07-26, wave 2 per-context availability + wave-1 riders 2026-07-28)
settled TEXT() rendering (Oracle-NUMBER-parity digit budget, engine precision
40), `&` precedence observability, and the per-context availability matrix
(`corpus/org-availability.json`, enforced by
`src/registry/org-availability.test.ts`). The remaining oracle-tier failures
are rows the org has overruled (org wins) plus a small date-rendering tail —
triaged in VERIFICATION.md's conformance backlog.

## Licensing

`formula-engine` is BSD-3-Clause; `formulon` is MIT. We ship neither. If we vendor
formula-engine source to build the WS3 harness, it is a build-time dependency,
attributed in `NOTICE`. Corpus rows derived from their test data (formula→result
facts) get provenance tags and a BSD-3 attribution note in `NOTICE`.

## Backlog — discrepancies already found (WS1)

Read directly from `Formula.g4` (nesting = precedence, tightest→loosest):
`unary > * / > ^ > + - & > < <= > >= > = <> == != > && > ||`, **all
left-associative**.

| #   | Finding                       | Ours (before)                            | SF grammar                      | Action                                                                 |
| --- | ----------------------------- | ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| 1   | `&` (concat) precedence       | below `+ -`                              | **same level as `+ -`**         | **Fix now**                                                            |
| 2   | `* /` vs `^`                  | `^` binds tighter                        | **`* /` bind tighter than `^`** | Fix now (⚠ surprising vs math convention — queue WS3 eval cross-check) |
| 3   | `^` associativity             | right                                    | **left**                        | Fix now (⚠ surprising — queue WS3 cross-check)                         |
| 4   | `&&` / `\|\|`                 | not tokenized (`&&`→two `&`; `\|`→error) | accepted operators              | **Verify** OSS-vs-product, then decide lexing                          |
| 5   | `==` / `!=`                   | parsed, warned "nonstandard"             | first-class equality ops        | **Verify**; reconsider the warning                                     |
| 6   | identifier continuation chars | `[A-Za-z0-9_]`                           | grammar also lists `$ : . #`    | **Review** `LexerRules.g4` (we already split `.` as path sep)          |

Items 1–3 are grammar-confirmed and fixed in WS1. Items 2–3 are surprising enough
(they invert the usual math conventions) that WS3's eval oracle or org
verification should confirm the grammar reflects runtime before we treat them as
settled — tracked in VERIFICATION.md. Items 4–6 are verification-gated.
