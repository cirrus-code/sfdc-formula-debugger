{
  description = "SFDC in-browser formula analyzer";

  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    sfdx-nix.url = "github:rfaulhaber/sfdx-nix";
    devenv.url = "github:cachix/devenv";
    # devenv needs the project root at eval time. .envrc writes $PWD to
    # .devenv/root and overrides this input with it, keeping direnv loads
    # pure-eval; a bare `nix develop` needs --no-pure-eval instead.
    devenv-root = {
      url = "file+file:///dev/null";
      flake = false;
    };
  };

  nixConfig = {
    extra-substituters = "https://devenv.cachix.org";
    extra-trusted-public-keys = "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw=";
  };

  outputs = inputs @ {flake-parts, ...}:
    flake-parts.lib.mkFlake {inherit inputs;} {
      imports = [inputs.devenv.flakeModule];

      systems = [
        "x86_64-linux"
        "aarch64-darwin"
        "aarch64-linux"
      ];

      perSystem = {
        pkgs,
        inputs',
        ...
      }: {
        formatter = pkgs.alejandra;

        # Day-to-day shell. Inside it, `devenv tasks run <ns:name>` runs any
        # task below, `devenv up` starts the dev server as a managed process,
        # and `devenv test` runs the pre-PR gauntlet.
        devenv.shells.default = {config, ...}: let
          # Playwright's official browser bundles from nixpkgs (patched to run on
          # NixOS, plain prebuilt binaries elsewhere). The nixpkgs playwright-driver
          # version must match the npm `playwright` version, or the revision lookup
          # under PLAYWRIGHT_BROWSERS_PATH fails.
          browsers = pkgs.playwright-driver.browsers.override {
            withFirefox = false;
            withWebkit = false;
            withFfmpeg = false;
          };
          root = config.devenv.root;
          # Tasks are pinned to a working directory so they behave the same no
          # matter where in the tree they are invoked from.
          app = exec: {
            inherit exec;
            cwd = root;
          };
          orgcheck = exec: {
            inherit exec;
            cwd = "${root}/orgcheck";
          };
        in {
          packages = with pkgs; [
            inputs'.sfdx-nix.packages.default
            prettier
            # The WS4 differential fuzzer (oracle/fuzz) drives the JVM oracle
            # from node in one process; without a JDK here it needs FUZZ_JAVA
            # pointed at the .#oracle shell.
            jdk21
          ];

          languages.javascript = {
            enable = true;
            package = pkgs.nodejs_26;
            pnpm.enable = true;
          };

          env = {
            PLAYWRIGHT_BROWSERS_PATH = "${browsers}";
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };

          processes.vite.exec = "cd ${root} && pnpm run dev";

          # `devenv test` — the pre-PR gauntlet from CONTRIBUTING.md.
          enterTest = ''
            cd ${root}
            pnpm run typecheck && pnpm run lint && pnpm run test
          '';

          tasks = {
            "app:install" = app "pnpm install";
            "app:dev" = app "pnpm run dev";
            "app:build" = app "pnpm run build";
            "app:preview" = app "pnpm run preview";
            "app:typecheck" = app "pnpm run typecheck";
            "app:lint" = app "pnpm run lint";
            "app:test" = app "pnpm run test";
            "app:test-watch" = app "pnpm run test:watch";
            "app:test-browser" = app "pnpm run test:browser";
            "app:format" = app "pnpm run format";
            # Regenerates corpus/salesforce-v2.json from the vendored oracle
            # tests (CONFORMANCE.md WS5); CI diffs the result for drift.
            "corpus:extract" = app "node --experimental-strip-types scripts/extract-corpus.ts";
            # Same defaults as the weekly CI fuzz job; run oracle/fuzz/run.mjs
            # directly for a custom seed/count/output.
            "fuzz:run" = app "node oracle/fuzz/run.mjs --seed 1 --count 2500 --out fuzz-report.md";
            "fuzz:typecheck" = app "pnpm exec tsc --noEmit -p oracle/fuzz";
            "orgcheck:install" = orgcheck "pnpm install";
            "orgcheck:generate" = orgcheck "pnpm run generate";
            "orgcheck:collect" = orgcheck "pnpm run collect";
            "orgcheck:emit" = orgcheck "pnpm run emit";
            "orgcheck:generate-ctx" = orgcheck "pnpm run generate-ctx";
            "orgcheck:collect-ctx" = orgcheck "pnpm run collect-ctx";
            "orgcheck:emit-ctx" = orgcheck "pnpm run emit-ctx";
          };
        };

        # Toolchain for the JVM conformance oracle harness (oracle/README.md).
        devenv.shells.oracle = {config, ...}: let
          root = config.devenv.root;
          oracle = exec: {
            inherit exec;
            cwd = "${root}/oracle";
          };
        in {
          languages.java = {
            enable = true;
            jdk.package = pkgs.jdk21;
            maven.enable = true;
          };

          # oracle-probe FILE — evaluate a probe file against the built
          # harness (probe paths resolve relative to the caller's directory).
          scripts.oracle-probe.exec = ''
            exec java -cp "${root}/oracle/target/classes:$(cat "${root}/oracle/cp.txt")" OracleHarness "$@"
          '';

          tasks = {
            # First run clones + installs formula-engine, then compiles the
            # harness and evaluates the example probes.
            "oracle:smoke" = oracle "bash ci-smoke.sh";
            "oracle:build" = oracle "mvn -q compile && mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt";
          };
        };
      };
    };
}
