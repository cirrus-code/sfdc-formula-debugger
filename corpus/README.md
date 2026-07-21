# corpus/

The golden conformance corpus — the durable, language-agnostic asset described
in DESIGN §10 and CONFORMANCE.md. It is what the evaluator is measured against;
the pass rate is the conformance number.

## Files

- `sources/formulaTestV2.xml` — vendored oracle: Salesforce's own
  `salesforce/formula-engine` test corpus (BSD-3-Clause; see `/NOTICE`). Kept
  verbatim so corpus generation is reproducible.
- `salesforce-v2.json` — generated golden rows: `(formula, dataType, fields,
blankMode, expected)`. **Generated — do not edit by hand.**

## Regenerate

```
node scripts/extract-corpus.ts
```

Each Salesforce `testData` row yields two rows — one per blank mode — from the
Java execution paths `formula` (blank-as-zero) and `formulaNullAsNull`
(blank-as-blank), the faithful oracle for division-by-zero (CONFORMANCE.md).

## Trust order

`org-verified > formula-engine oracle > formulon` (CONFORMANCE.md). Rows here are
oracle-tier. Expected values are the oracle's raw Java rendering; the comparator
(`src/engine/conformance.ts`) normalizes per type and quarantines what it can't
yet compare faithfully (dates, ambiguous text), so the conformance number is
never inflated.
