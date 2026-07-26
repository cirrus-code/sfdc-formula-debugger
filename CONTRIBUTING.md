# Contributing

Thanks for your interest! This project has a small surface but strict ground
rules, because its entire value is accuracy.

## Setup

```
nix develop   # or: direnv allow — provides Node, pnpm, prettier
pnpm install
```

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `pnpm dev`          | Vite dev server                       |
| `pnpm test`         | unit, property, and conformance tests |
| `pnpm test:browser` | Playwright browser smoke tests        |
| `pnpm typecheck`    | `tsc --noEmit` (strict mode)          |
| `pnpm lint`         | ESLint                                |
| `pnpm format`       | Prettier                              |

## Ground rules

Read [CLAUDE.md](CLAUDE.md) (the project rulebook) and [DESIGN.md](DESIGN.md)
before substantial changes. The short version:

1. **Never guess Salesforce semantics.** Every behavioral claim (blank handling,
   rounding, case sensitivity, date edge cases) must be backed by the golden
   corpus, the formula-engine oracle, or an org-verified probe — see
   [CONFORMANCE.md](CONFORMANCE.md) and [VERIFICATION.md](VERIFICATION.md).
   Anything unverifiable must refuse to simulate rather than approximate.
2. **The conformance number only moves up.** `src/engine/conformance.test.ts`
   locks a baseline; a PR that lowers the pass rate will fail CI.
3. **No IEEE floats in the evaluator** — all numeric math goes through
   `decimal.js`.
4. **Layering is strict.** Lower layers (`syntax/` → `registry/` → `engine/` →
   `analysis/` → `features/` → `ui/`) never import upward, and `ui/` contains no
   Salesforce semantics.
5. **Comments in formulas are user data.** The parser preserves them and the
   formatter must reattach them; tests enforce this.
6. **User-facing strings live in `i18n/`** — see `src/i18n/README.md` before
   adding copy or a locale.

## Common changes

- **Adding a function:** add a data entry in `src/registry/functions.ts`, an
  implementation in `src/engine/builtins.ts` (only if its semantics are
  corpus-verified — otherwise mark it `simulatable: false`), and golden tests.
  A consistency test enforces that the registry and engine agree.
- **Adding a formula context:** data change in `src/registry/contexts.ts`.
- **Semantics fixes:** corpus row first, then the code change that makes it pass.

## Before opening a PR

Run `pnpm typecheck && pnpm lint && pnpm test` and `pnpm format`. Keep PRs
focused; note any VERIFICATION.md entries your change touches.
