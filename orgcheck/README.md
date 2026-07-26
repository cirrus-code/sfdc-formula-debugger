# orgcheck/ — real-org verification harness

Settles the 🔬/❓ questions in `VERIFICATION.md` against a **real Salesforce
org** — the top of the trust order (`org-verified > formula-engine oracle >
formulon`, CONFORMANCE.md). Where the JVM oracle (`oracle/`) answers "what does
the open-source engine do", this answers "what does the _product_ do" — the
tiebreaker for contested points like `&&`/`==` operators, `^`
precedence/associativity, TextArea blank semantics, and TEXT() renderings.

Dev tool only. It never ships, and the app never gains org connectivity.

## How it works

```
probes/*.json ──generate──▶ sfdx/force-app (one formula field per probe × blank mode,
      +                      TEXT() twins, typed input fields)  +  data-*.apex  +  plan.json
corpus/salesforce-v2.json
                ──collect──▶ staged deploys (rejections ARE verdicts)
                             → insert records → SOQL readback → results/org-run-<date>.json
                ──emit─────▶ corpus/org-verified.json (org-tier rows) + oracle-drift report
```

- **Probe manifests** (`probes/syntax.json`, `probes/semantics.json`): each
  probe records the _question_ it settles and, where results are contested, an
  `interpret` map from observed value → verdict. `corpusRefs` re-verify entire
  oracle corpus tests (every row, both blank modes) against the product.
- **Blank modes** deploy as two formula fields differing only in
  `formulaTreatBlanksAs` (`BlankAsZero` / `BlankAsBlank`). The
  `blank_mode_canary` probe validates this plumbing end-to-end before any other
  result is trusted.
- **TEXT() twins**: numeric/temporal results also deploy as `TEXT(expr)` text
  formulas. SOQL JSON loses precision and rendering on numbers; the twin
  captures the engine's own exact rendering as a string. Twins double as the
  TEXT()-format probes.
- **Records** are deduplicated by input-set and keyed by hash in `ProbeKey__c`;
  each probe row knows which record to read its formula field from.
- **Input fields are namespaced per corpus test** (`x<n>_…`): the same corpus
  field name is reused across tests with incompatible scales, and a Number(18)
  field has exactly one scale. Values that still can't be stored faithfully are
  dropped with a warning — Salesforce would silently round them, which would
  corrupt the probe (generate.ts logs every drop).
- **Save rejections are data.** `expectSaveError` probes ask whether the
  product even accepts a construct (`&&`, `==`, `SUBSTR`, 2-arg `UPPER`,
  `foo:bar` identifiers…). Rejections land in the results with their error
  message — for identifier probes the _kind_ of message (syntax vs
  unknown-field) is the verdict. Because one invalid field makes the org
  discard **every** component in the same deploy (even with
  `--ignore-errors`), collect deploys in rounds: record the rejections, drop
  them from the package, retry until clean — with the expected-rejection
  probes as their own batch so they can't suppress the main metadata.

## Running the pass

One-time setup — a free Developer Edition org and the bundled `sf` CLI:

1. Sign up: <https://developer.salesforce.com/signup> (free, no DevHub needed).
2. `pnpm install` in this directory (installs `@salesforce/cli` locally).
3. Authorize: `node_modules/.bin/sf org login device --alias formula-verify`
   (device flow: prints a code + URL, finish in any browser).

Then:

```
pnpm generate                          # manifests → sfdx metadata + data.apex + plan.json
pnpm collect -- --org formula-verify   # deploy + insert + read back → results/org-run-<date>.json
pnpm emit -- results/org-run-<date>.json   # → corpus/org-verified.json + drift report
```

`collect` accepts `--skip-deploy` (reuse `results/deploy-map.json`) and
`--skip-data` for fast re-reads. Re-running is idempotent: the deploy upserts
metadata and the `data-*.apex` scripts (chunked to fit the execute-anonymous
script-size limit; the first chunk wipes) reload all probe records.

After a run: read the collect/emit summaries, update the corresponding
`VERIFICATION.md` entries (❓/🔬 → ✅ with the probe id as the golden-test
citation), and fix the evaluator/lexer against the new `org-verified.json`
rows.

## Caveats

- **Org timezone**: recorded in the results file. TEXT(datetime) is GMT-based
  so most probes are TZ-independent, but keep the org on GMT if possible for
  clean date renderings.
- **Numeric channel**: the raw formula-field value passes through the field's
  declared scale (display-boundary rounding — itself a probe) and JSON number
  parsing. Trust the TEXT() twin for exact values.
- **`#Error!` rows read as SOQL nulls** — the API does not distinguish a null
  result from an evaluation error. Distinguishing them per context is exactly
  the "div-by-zero surfacing" open question; the `divzero_*` / `iferror_*`
  probes plus UI observation settle it (check the record page for `#Error!` by
  hand for those probes).

## Wave 2 — not built yet

The per-context availability matrix (validation rules, workflow, approval,
default values, every Tier 2 context) needs ValidationRule/WorkflowRule
metadata probes and DML-triggered error observation. Same manifest pattern
(`probes/contexts.json`, save-acceptance = verdict), separate generator
support. Also pending: ISPICKVAL/picklist coercion probes, DST probes under a
non-GMT org TZ, and compiled-size limit exploration.
