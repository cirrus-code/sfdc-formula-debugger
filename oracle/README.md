# oracle/ — JVM conformance oracle harness (WS3)

Evaluates formulas through **Salesforce's own** `formula-engine` (BSD-3) to derive
verified behavior — the source of truth for raising the conformance number
without guessing (CONFORMANCE.md, VERIFICATION.md). This is a dev/offline tool;
it is not part of the app build, and the shipped product never depends on a JVM.

Requires a JDK + Maven. Use the Nix devShell:

```
nix develop --no-pure-eval .#oracle
```

Everything below is also wrapped as devenv tasks inside that shell:
`devenv tasks run oracle:smoke` (clones + installs formula-engine on first run,
then builds the harness and evaluates the example probes),
`devenv tasks run oracle:build`, and `oracle-probe FILE` for ad-hoc probe files.

## One-time: build formula-engine from source

Maven Central lags the GitHub tags, so build the pinned tag locally (installs
`com.salesforce.formula:*:0.9.13` into `~/.m2`):

```
git clone --depth 1 --branch v0.9.13 https://github.com/salesforce/formula-engine.git
cd formula-engine
mvn -pl test-utils -am install -DskipTests -Dmaven.javadoc.skip=true
cd ..
```

`formula-engine/` is git-ignored (fetched on demand, not vendored).

## Run

Build the harness and evaluate a probe file:

```
mvn -q compile
mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt
java -cp "target/classes:$(cat cp.txt)" OracleHarness probes.example.txt
```

Each output line is `TYPE<TAB>FORMULA<TAB>CLASS<TAB>RESULT`, or `…<TAB>ERROR<TAB>msg`.
A malformed probe (or an invalid field reference) prints an `ERROR` line and the
run continues.

## Probe file format

Tab-separated, one probe per line. Blank lines and `#` comments are skipped.
`TYPE` (and each field `TYPE`) is a `MockFormulaDataType`: DOUBLE, INTEGER,
CURRENCY, PERCENT, TEXT, BOOLEAN, DATEONLY, DATETIME, TIMEONLY, ENTITYID.

Two line shapes are accepted; the second column selects which:

```
# legacy — blank fields, "treat blank as zero" mode:
TYPE <TAB> FORMULA

# field-valued — typed inputs + blank-handling mode:
TYPE <TAB> BLANKMODE <TAB> FORMULA <TAB> FIELDS
```

- `BLANKMODE` is `zero` or `blank` — the org "treat blank fields as zeroes"
  toggle, threaded to `FormulaProperties.setTreatNullNumberAsZero`.
- `FIELDS` is `name:TYPE=value` pairs joined by `;` (may be empty). An empty
  value (`name:TYPE=`) leaves the field blank/null; an optional scale is written
  `name:TYPE:SCALE=value`. Numbers parse as `BigDecimal`, booleans as
  `true`/`false`, dates as `YYYY:MM:DD[:hh:mm:ss]`, text verbatim.

Example (division precision, `zero` mode, `customnumber1__c`=1, `customnumber2__c`=9):

```
DOUBLE	zero	FLOOR((customnumber1__c/customnumber2__c)*customnumber2__c)	customnumber1__c:DOUBLE=1;customnumber2__c:DOUBLE=9
```

Field-valued evaluation uses `MapFormulaContext` with a typed `MapEntity`. The
default engine factory does not register field references, so the harness
installs the same command set the engine's own tests use
(`FieldReferenceCommandInfo` + the SFDC function set); without this any field
reference throws, and the open-source engine's placeholder i18n grammar then
crashes while building the error message.

`probes.division.txt` reproduces the Number division/multiplication precision
findings.

## fuzz/ — WS4 differential fuzzer

`fuzz/` generates random, type-directed **constant expressions** from our own
grammar surface (literals, every operator, and the arithmetic/text/logic
functions both engines implement), evaluates each one under both blank modes
with our evaluator _and_ this harness, and diffs the two. Comparison is
delegated to `src/engine/conformance.ts` (`runRow`), so the fuzzer cannot invent
a friendlier notion of "equal", and every difference is triaged into (a)
suspected our-bug, (b) suspected OSS-vs-product divergence — an **org-probe
candidate**, never a corpus row, because the org outranks this oracle — or (c) a
divergence VERIFICATION.md already records the org overruling. Runs are
deterministic in the seed; the JVM leg is one batched process, so 5,000 probes
take a few seconds. It never writes to `corpus/`. Run it from the repo root
(node lives in the default dev shell, `java` in `.#oracle` — pass `--java` or
`$FUZZ_JAVA` when they are not in the same shell):

```
node oracle/fuzz/run.mjs --seed 1 --count 2500 --out /tmp/ws4-report.md
```

`--oracle-out FILE` replays a saved harness transcript instead of spawning the
JVM, and `--no-oracle` stops after writing the probe file. `fuzz/fuzz.test.ts`
covers the generator, the probe codec and the triage rules against mocked
transcripts, so it runs in the ordinary `vitest` pass; typecheck the fuzzer with
`pnpm exec tsc --noEmit -p oracle/fuzz`.

## Scope

Rules verified through this harness (see VERIFICATION.md):
Number arithmetic computes internally at **39 significant figures, HALF_UP**
(`BigDecimalHelper.MC_PRECISION_INTERNAL`) and materializes results at a **scale
of 32 decimal places, HALF_UP**; `^` rejecting non-integer exponents; `SQRT` at
double precision; `MOD(x,0)` erroring; `ROUND` with negative digits; Percent
÷100 / ×100; and case-sensitive text `=`. Field-valued + blank-mode probes
derive blank-propagation behavior directly.
