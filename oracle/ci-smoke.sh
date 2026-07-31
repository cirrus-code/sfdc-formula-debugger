#!/usr/bin/env bash
# Build Salesforce's formula-engine from the pinned tag, compile the oracle
# harness, and evaluate the example probes. Fails if the harness cannot produce
# oracle output — a canary that the offline conformance oracle still builds and
# runs (CONFORMANCE.md WS3/WS5). Run inside `nix develop --no-pure-eval .#oracle`
# (or as the `oracle:smoke` devenv task).
set -euo pipefail

cd "$(dirname "$0")"

ENGINE_TAG="v0.9.13"

if [ ! -d formula-engine ]; then
  git clone --depth 1 --branch "$ENGINE_TAG" \
    https://github.com/salesforce/formula-engine.git
  mvn -pl test-utils -am install -DskipTests -Dmaven.javadoc.skip=true \
    -f formula-engine/pom.xml
fi

mvn -q compile
mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt

OUT="$(java -cp "target/classes:$(cat cp.txt)" OracleHarness probes.example.txt)"
echo "$OUT"

if [ -z "$OUT" ]; then
  echo "oracle produced no output" >&2
  exit 1
fi
