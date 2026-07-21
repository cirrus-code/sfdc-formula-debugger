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

      perSystem = {pkgs, ...}: {
        formatter = pkgs.alejandra;

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_26
            pnpm
            prettier
          ];
        };
      };
    };
}
