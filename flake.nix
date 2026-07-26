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

        devShells.default =
          pkgs.mkShell {
            packages = with pkgs;
              [
                nodejs_26
                pnpm
                prettier
              ]
              ++ pkgs.lib.optionals (system == "x86_64-linux") [
                chromium
              ];
          }
          // pkgs.lib.optionalAttrs (system == "x86_64-linux") {
            # Browser smoke tests drive Playwright against this Chromium instead of
            # Playwright's prebuilt browsers, which do not run on NixOS.
            CHROMIUM_BIN = "${pkgs.chromium}/bin/chromium";
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
