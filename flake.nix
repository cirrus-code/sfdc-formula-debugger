{
  description = "SFDC in-browser formula analyzer";

  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    sfdx-nix.url = "github:rfaulhaber/sfdx-nix";
  };

  outputs = inputs @ {flake-parts, ...}:
    flake-parts.lib.mkFlake {inherit inputs;} {
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
        "aarch64-linux"
      ];

      perSystem = {
        pkgs,
        system,
        inputs',
        ...
      }: {
        formatter = pkgs.alejandra;

        devShells.default = let
          # Playwright's official browser bundles from nixpkgs (patched to run on
          # NixOS, plain prebuilt binaries elsewhere). The nixpkgs playwright-driver
          # version must match the npm `playwright` version, or the revision lookup
          # under PLAYWRIGHT_BROWSERS_PATH fails.
          browsers = pkgs.playwright-driver.browsers.override {
            withFirefox = false;
            withWebkit = false;
            withFfmpeg = false;
          };
        in
          pkgs.mkShell {
            packages = with pkgs; [
              inputs'.sfdx-nix.packages.default
              nodejs_26
              pnpm
              prettier
              # The WS4 differential fuzzer (oracle/fuzz) drives the JVM oracle
              # from node in one process; without a JDK here it needs FUZZ_JAVA
              # pointed at the .#oracle shell.
              jdk21
            ];

            PLAYWRIGHT_BROWSERS_PATH = browsers;
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };

        # Toolchain for the JVM conformance oracle harness (oracle/README.md).
        devShells.oracle = pkgs.mkShell {
          packages = with pkgs; [
            jdk21
            maven
          ];
        };
      };
    };
}
