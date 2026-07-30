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
- **Create vs update validation asymmetry** (wave-2 discovery): flows and
  weblinks accept formula content lazily when the component is _created_ but
  validate fully on _update_. A first deploy of a fresh org can therefore
  produce false acceptances for those types — always confirm through a second
  (upsert) deploy before trusting them. Active flows also require `<scale>`
  on Number/Currency variables at update time.

## Wave 2 — per-context availability (`*-ctx` scripts)

Wave 2 asks a different question than wave 1: not "what does this formula
evaluate to" but "does this **context's** compiler accept this construct at
all". Each probe is one metadata component per (construct × context) — a
validation rule, workflow rule/field update, custom-field default value,
Draft flow, global quick action, weblink, email template, or approval
process — and the per-component deploy accept/reject, with its message, is
the verdict:

```
src/registry/functions.ts (the one registry, 101 fns) + probes/contexts.json
        ──generate-ctx──▶ ctx-plan.json (metadata fragments + batches) + data-ctx.apex
        ──collect-ctx──▶ canary-gated staged deploys + DML runtime probes
                          → results/ctx-run-<date>.json
        ──emit-ctx─────▶ corpus/org-availability.json + registry drift report
```

- **Canary gating.** Per container: an ok-canary (must deploy) and a
  bogus-function canary (must be _rejected_ — proves the container actually
  compiles formulas). A container that swallows `FXBOGUSFN123(1)` validates
  nothing; its acceptances are meaningless and the whole container is
  reported unverifiable rather than encoded (rule 1 applied to the harness).
- **Rejection taxonomy.** `Unknown function X` / `may not be used in this
type of formula` ⇒ unavailable. `Incorrect parameter type/number of
parameters` ⇒ **available** (the compiler resolved the function; the probe
  was ill-shaped — fix the invocation override). Anything else is conclusive
  only for taint-free probes.
- **Taint tracking.** Field-capable containers pass typed input fields as
  arguments (no helper functions); detached containers (default value, flow,
  quick action, email) use literals, and helpers like a `DATE(2026, 1, 1)`
  constructor are recorded as taint so a rejection is never silently
  misattributed.
- **Runtime probes.** Gated active validation rules + `Database.insert`
  (allOrNone=false) + the debug channel settle div-by-zero surfacing,
  IFERROR catching, AND/OR short-circuit, case sensitivity, and blank
  semantics inside validation rules. Error-capable probes get their own
  single-record objects (`FxErr*`) so an eagerly-evaluated error cannot
  poison neighboring probes.
- `--only <batchPrefix>` reruns a single container; `--compose-only
<batchId>` writes the package without deploying (XML inspection).

Still pending after wave 2: ISPICKVAL/picklist coercion value probes, DST
probes under a non-GMT org TZ, compiled-size limit exploration, and runtime
observation for non-VR contexts (flow interviews, field-update execution).
