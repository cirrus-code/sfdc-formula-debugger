{
  description = "SFDC in-browser formula analyzer";

  inputs = {
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
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
              nodejs_26
              pnpm
              prettier
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
