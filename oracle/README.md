# oracle/ — JVM conformance oracle harness (WS3)

Evaluates formulas through **Salesforce's own** `formula-engine` (BSD-3) to derive
verified behavior — the source of truth for raising the conformance number
without guessing (CONFORMANCE.md, VERIFICATION.md). This is a dev/offline tool;
it is not part of the app build, and the shipped product never depends on a JVM.

Requires a JDK + Maven. Use the Nix devShell:

```
nix develop .#oracle
```

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

Build the harness and evaluate a probe file (tab-separated `TYPE<TAB>FORMULA`,
one per line; `TYPE` ∈ DOUBLE, TEXT, BOOLEAN, DATEONLY, DATETIME, TIMEONLY):

```
mvn -q compile
mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt
java -cp "target/classes:$(cat cp.txt)" OracleHarness probes.example.txt
```

Each output line is `TYPE<TAB>FORMULA<TAB>CLASS<TAB>RESULT`, or `…<TAB>ERROR<TAB>msg`.

## Scope

Formulas evaluate with blank fields (constant expressions), which is enough to
derive numeric-scale, rounding, precision, and error rules — the largest
conformance levers. Rules verified this way so far (see the git history and
VERIFICATION.md): division/arithmetic scale of 32 decimal places, `^` rejecting
non-integer exponents, `SQRT` at double precision, `MOD(x,0)` erroring, `ROUND`
with negative digits, Percent ÷100 / ×100, and case-sensitive text `=`.

Field-valued evaluation (via `MapFormulaContext`) — needed for full corpus
regeneration and differential fuzzing (WS4) — is a future extension.
