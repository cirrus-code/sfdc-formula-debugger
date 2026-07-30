# Formula Debugger

**Debug Salesforce formulas in your browser — nothing leaves the page.**

**[formulas.cirrus.tools](https://formulas.cirrus.tools)**

Paste or write a Salesforce formula and get instant, editor-grade feedback:

- **Syntax & error highlighting** with full error recovery — broken formulas still
  parse, and every diagnostic is positioned exactly where the problem is.
- **Simulation** — the tool detects your field references, lets you supply values
  and types, and computes the result, including the org-level "treat blank fields
  as zeroes / as blanks" toggle.
- **Boolean simplification** with a step-by-step log of every rewrite, correct
  under Salesforce's blank semantics (which are _not_ classical boolean algebra).
- **Formatting** that is idempotent, semantics-preserving, and never destroys
  your `/* comments */`.
- **Linting** for style and robustness pitfalls.
- **Shareable permalinks** — formula and inputs compressed into the URL hash.

## Accuracy first

A wrong simulated answer is worse than no answer. The evaluator either returns a
result it can defend or refuses with an explicit `unsupported` error — it never
guesses. Semantics are verified two ways: against Salesforce's own open-source
[formula-engine](https://github.com/salesforce/formula-engine) used as an
oracle — **100%** of 6,312 comparable corpus cases pass — and against a real
Salesforce org, where **100%** of 664 comparable org-verified rows pass. Both
suites are protected in CI by baselines locked at 100%: a future failing row
must be triaged, never absorbed. See [CONFORMANCE.md](docs/CONFORMANCE.md) for how
the oracle pipeline works and [VERIFICATION.md](docs/VERIFICATION.md) for every
behavior's verification status.

Numeric math uses [decimal.js](https://github.com/MikeMcl/decimal.js), mirroring
Salesforce's decimal model — `0.1 + 0.2` equals `0.3`, and `ROUND(2.5)` is `3`.

## Privacy

There is no server and no backend — parsing, analysis, and simulation all run in
this tab. Formula text leaves the editor only when you explicitly click "Copy
link", and then only into the URL hash. No analytics events contain formula text.

## Development

Requires [pnpm](https://pnpm.io) and a recent Node (a Nix flake with the full
dev environment is included — `nix develop`, or `direnv allow`).

```
pnpm install
pnpm dev          # Vite dev server
pnpm test         # unit + conformance tests
pnpm test:browser # browser smoke tests (Playwright)
pnpm build        # static production build
```

The build is fully static and deployable to any static host.

## Architecture

One typed AST and one declarative function registry feed every feature —
highlighting, diagnostics, autocomplete, hover, evaluation, simplification,
formatting, linting. Layers depend strictly downward:

```
ui/            React + CodeMirror 6
features/      simplifier, formatter, linter, field extraction
analysis/      type checker, context validation
engine/        evaluator + value domain (decimal.js)
registry/      function metadata + formula-context configs
syntax/        lexer, parser (recursive descent + Pratt), AST
i18n/, theme/  strings and branding (leaf modules)
```

[DESIGN.md](DESIGN.md) is the full design document; [CONTRIBUTING.md](CONTRIBUTING.md)
covers the ground rules for changes.

## License

[MIT](LICENSE). Portions are derived from
[formulon](https://github.com/leifg/formulon) (MIT) and test data from
[salesforce/formula-engine](https://github.com/salesforce/formula-engine)
(BSD-3-Clause) — see [NOTICE](NOTICE).

Salesforce is a trademark of Salesforce, Inc. This project is an independent
open-source tool and is not affiliated with, endorsed by, or sponsored by
Salesforce.
