# Salesforce Formula Debugger — Design Document

## 1. Overview

A free, entirely client-side web tool for working with Salesforce formulas. Users paste or write
a formula and get: instant syntax and semantic error highlighting, a simulation panel that
detects field references and lets them supply values to compute a result, boolean logic
simplification with step-by-step explanation, canonical reformatting, and lint findings. The
tool is free and open source: it must load instantly, feel expert-grade, and never give a
confidently wrong answer.

The emphasis is the full debugger experience, not evaluation alone — editor-grade positioned
diagnostics with error recovery, comment-preserving formatting, linting, step-by-step
simplification, correct blank-handling semantics, and shareable permalinks.

### Goals

- Sub-second first load; sub-frame feedback on every keystroke.
- Correct-or-refuse simulation: every simulated answer is defensible; everything else is an
  explicit "unsupported."
- Support every standard-formula-engine context (see §5) from day one via configuration.
- Produce a durable golden test corpus that outlives this codebase.
- Shareable permalinks (formula + inputs encoded in URL hash) as the growth mechanism.

### Non-goals

- Report formulas (row-level / custom summary; `AMOUNT:SUM` syntax) — a different language.
- Org connectivity of any kind (OAuth, metadata fetch, live evaluation against an org).
- Server-side components, accounts, persistence beyond the URL hash.
- Simulating org-state-dependent functions (see §7 exclusion list).
- Exact compiled-size computation (approximate warning only).

## 2. Architecture

Six layers with strictly downward dependencies:

```
┌────────────────────────────────────────────────────────────┐
│ ui/         React + CodeMirror 6                           │
│             editor · simulation form · results · panels    │
├────────────────────────────────────────────────────────────┤
│ features/   simplifier · formatter · linter ·              │
│             field extraction                               │
├────────────────────────────────────────────────────────────┤
│ analysis/   type checker · context validator · diagnostics │
├────────────────────────────────────────────────────────────┤
│ engine/     evaluator · value domain (decimal.js)          │
├────────────────────────────────────────────────────────────┤
│ registry/   function metadata table · context configs      │
├────────────────────────────────────────────────────────────┤
│ syntax/     lexer · parser · AST · spans · comments        │
└────────────────────────────────────────────────────────────┘
```

Formulas are tiny (≤ ~5KB source), so there is no incremental parsing: every keystroke triggers
a full lex + parse + analyze pass, which is microseconds. Simplicity over cleverness throughout.

## 3. Syntax layer

### 3.1 Lexer

Hand-written scanner producing a flat token stream with spans. Token kinds: identifiers
(including dotted paths and `$Global.Path` references as single tokens or trivially joinable
sequences — parser's choice, but dotted paths end up as one AST reference), string literals
(single and double quoted), number literals, operators (`+ - * / ^ & = <> < <= > >= == !=`),
punctuation, and trivia (whitespace, `/* */` comments). Trivia is retained and attached to
tokens (leading/trailing) so the formatter can preserve comments. Lexing never fails: unknown
characters become error tokens with diagnostics, and highlighting is driven purely by the token
stream so it works even when parsing fails.

Reserved-word handling: there are no reserved identifier prefixes. `Null_Check__c`,
`TRUEFIELD__c`, etc. must lex and parse as identifiers. Keywords (`TRUE`, `FALSE`, `NULL`) are
recognized only as complete case-insensitive tokens.

### 3.2 Parser

Recursive descent with Pratt-style precedence for binary operators. Salesforce precedence
(highest to lowest): parentheses; unary `-`/`NOT`... (verify exact table against docs and encode
as data); `^`; `* /`; `+ -`; `&`; comparisons; equality. `&&`/`||` are not Salesforce formula
operators — `AND()`, `OR()`, `NOT()` are functions, though `=`/`<>` etc. are operators.

**Error recovery is the defining requirement.** Strategy:

- Synchronization points: on error, skip to the nearest `,`, `)`, or EOF depending on context.
- Missing-token insertion: unclosed parens/quotes produce a synthetic close with a diagnostic,
  allowing the subtree to complete.
- Error nodes: unparseable regions become `ErrorNode` AST leaves covering their span; downstream
  passes treat them as unknown-typed opaque values and suppress cascading diagnostics inside
  them.
- The parser returns `{ ast, diagnostics[] }` — always both, never throws.

### 3.3 AST

Discriminated-union node types: `NumberLit`, `StringLit`, `BooleanLit`, `NullLit`, `FieldRef`
(full dotted path as one node, flagged `$`-global vs plain), `FunctionCall`, `BinaryOp`,
`UnaryOp`, `Paren` (preserved for formatting fidelity), `ErrorNode`. Every node: `span`,
optional attached comments (leading/trailing). AST is immutable; transformations return new
trees. Exhaustive-switch discipline (`never` checks) so new node kinds fail compilation anywhere
unhandled.

## 4. Registry

The semantic single source of truth. One typed data table, one entry per function:

```ts
interface FunctionSpec {
  name: string; // canonical uppercase
  params: ParamSpec[]; // types, variadic flags, min/max arity
  returnType: TypeRule; // fixed type or rule (e.g. SameAsArg(0))
  contexts: ContextId[] | "all"; // where Salesforce allows it
  simulatable: boolean; // false ⇒ hard "unsupported" in simulation
  evalImpl?: EvalFn; // required iff simulatable
  docsUrl: string;
  summary: string; // hover text
  lintNotes?: LintNote[];
}
```

This table drives autocomplete, hover docs, arity/type diagnostics, context-availability
diagnostics ("VLOOKUP is not available in flow formulas"), the simulation boundary, and
evaluation dispatch. A registry self-consistency test validates every entry (simulatable ⇒
evalImpl present, context ids exist, etc.).

Function implementations and their tests are ported from formulon (MIT, with attribution),
fixing its known defects (blank arithmetic, comments, reserved-prefix identifiers, div-by-zero,
positionless errors) per CLAUDE.md.

## 5. Formula contexts

Contexts are pure configuration:

```ts
interface FormulaContext {
  id: string; // "formula_field", "validation_rule", ...
  label: string;
  tier: 1 | 2; // verification status (see below)
  globals: GlobalSpec[]; // $Record? $User? $Flow? $Api? $System? ...
  requiredReturnType?: SfType; // e.g. Boolean for validation rules
  blankModeToggle: boolean; // formula fields: yes; others per-verified behavior
  charLimit?: number; // source-length lint threshold
  notes?: string; // shown in UI, e.g. Tier 2 disclaimer
}
```

Shipped contexts (all standard-formula-engine contexts, day one):

- **Tier 1 (verified availability data):** formula field, validation rule, flow formula.
- **Tier 2 (best-effort config, visibly labeled "availability data unverified for this
  context"):** default value, workflow rule, workflow field update, approval process
  entry/step, custom button/link, email template merge context, quick action predefined value.

Tier is a data field; promoting a context to Tier 1 is a config change backed by verification
work recorded in `VERIFICATION.md`. Report formulas are structurally excluded (different
grammar), stated in the UI's context picker as "not supported."

## 6. Type system and analysis

Types: `Text`, `Number`, `Currency`, `Percent`, `Boolean`, `Date`, `Datetime`, `Time`,
`Picklist`, `Multipicklist`, `Id`, plus `Unknown` (for error nodes and undetermined fields).
Blankness is a value-level state, not a type.

The checker walks the AST with the registry: operator/param type agreement, arity, return-type
requirement of the active context, function availability in the active context. `Unknown`
unifies with anything (no cascading noise). Diagnostics carry severity (error/warning/info),
span, message, and optional quick-fix hint.

**Field type inference** (for the simulation form): field references get candidate types from
usage — argument positions (`DATEVALUE(x)` ⇒ x: Text; `ISPICKVAL(x, …)` ⇒ x: Picklist), operator
contexts (`x > 5` ⇒ Number-ish), and cross-constraint propagation. Ambiguities surface as a type
picker in the UI rather than a guess. Conflicting constraints produce a diagnostic ("Name is
used as both Text and Number").

## 7. Evaluator

Interprets the AST over a Salesforce value domain:

- `SfValue = { type: SfType, blank: boolean, data?: Decimal | string | boolean | DateParts | … }`
- All numeric math via decimal.js; round-half-up.
- **Blank-handling mode** (`"zero" | "blank"`) is an evaluator parameter, surfaced as a UI
  toggle for contexts where it applies. It governs arithmetic with blank numeric operands.
- Blank rules: text concat treats blank as empty; null checkbox coerces to `false`;
  ISBLANK/ISNULL per their real semantics; comparisons/blank interactions follow the golden
  corpus, not intuition.
- Runtime failures that Salesforce itself surfaces (division by zero) produce a simulated
  `#Error!` result object — rendered distinctly in the UI as "Salesforce would show #Error!
  here," which is itself useful debugger output.
- **Simulation boundary:** encountering a non-`simulatable` function halts evaluation with
  `UnsupportedError{functionName, span}`. No partial or default results. Excluded from
  simulation (but fully supported for parsing/highlighting/formatting/linting): `PRIORVALUE`,
  `ISCHANGED`, `ISNEW`, `ISCLONE`, `VLOOKUP`, `IMAGE`, `GETSESSIONID`, `CURRENCYRATE`, and
  resolution of org-state globals (`$CustomMetadata`, `$Setup`, `$Permission`,
  `$ObjectType`…). `$User`, `$Profile`, and similar simple-record globals are simulatable as
  user-fillable field groups like `$Record`.

## 8. Features

### 8.1 Field extraction & simulation form

An AST walk collects unique field references (plain fields, `$Record.X`, dotted paths as flat
keys, fillable globals). Each becomes a form input whose widget matches its inferred/selected
type (text input, decimal input, date picker, checkbox, picklist free-text) with an explicit
**Blank** toggle per field — null vs empty vs zero is where formulas bite, so blankness is a
first-class input state. Values and the blank-mode toggle feed the evaluator; results update
live. The result panel shows the value, its type, and — stretch goal, cheap with a tree
interpreter — an expandable trace of sub-expression values for the debugger feel.

### 8.2 Boolean simplifier

Pipeline of independent AST rewrite rules, each `(node) => node | null` with a name and a
human-readable description: constant folding, identity/annihilator laws, double negation,
De Morgan, absorption, `IF(x, TRUE, FALSE)` → `x`, `IF(x, y, IF(z, …))` chains → `CASE`
suggestion, redundant parens. Applied to fixpoint with a step log; the UI renders the log as a
step-by-step transformation (each step: rule name, before → after) — trust-building and
shareable. Every rule must be blank-safe (equivalence-preserving under Salesforce blank
semantics, not just classical boolean algebra); each rule ships with
property-test coverage comparing original vs rewritten over randomized inputs including blanks
under both blank modes. Rules that can't be made blank-safe are demoted to _suggestions_
("equivalent if X is never blank") rather than applied rewrites.

### 8.3 Formatter

Pretty-printer over the AST: canonical indentation for nested calls, argument alignment,
operator spacing, comment preservation in position (leading/trailing attachment), `Paren` nodes
preserved. Configurable only minimally (indent width). Property-tested for idempotence and
reparse-equality.

### 8.4 Linter

Registry- and AST-driven rules, each with id, severity, span, message, docs link:

- Hardcoded 15/18-char record IDs (regex on string literals with ID shape).
- Nested `IF` depth over threshold ⇒ suggest CASE/simplifier.
- Comparison of picklist via `TEXT()` where `ISPICKVAL` is idiomatic.
- Deprecated / discouraged constructs (registry `lintNotes`).
- Source length vs context `charLimit`, with explicit "compiled size differs and cannot be
  computed exactly" phrasing.
- Function-availability and return-type findings from the analysis layer surface in the same
  panel.

### 8.5 Permalinks

`lz-string` compressToEncodedURIComponent of
`{ v: 1, context, formula, fields: {name: {type, blank, value}}, blankMode }` in the URL hash.
Decoded on load; version field for forward compatibility. This is the sharing/growth mechanism —
the "Copy link" affordance should be prominent next to results.

## 9. UI

Single-page layout: context picker (with Tier 2 disclaimer where applicable) → CodeMirror editor
(highlighting, inline squiggles, hover docs, autocomplete) → tabbed or stacked panels:
**Simulate** (field form + result + blank-mode toggle), **Problems** (diagnostics + lint),
**Simplify** (step log + apply button), **Format** (one-click, in-editor). Mobile-usable but
desktop-first. Errors and empty states follow direction-not-mood copy. Visual design follows
the "calibrated instrument" direction; product name, palette, and any cross-linking live in one
theme module (`src/theme/`) so branding changes stay a one-file change. The tool is hosted at
`formulas.cirrus.tools`.

## 10. Testing & conformance

- **Golden corpus** (`corpus/*.json`): `(formula, context, inputs, blankMode, expected)` rows.
  Sources, in trust order: real-org verification (authoritative), salesforce/formula-engine
  JS-generation oracle output, formulon's adapted tests (seed). The corpus is the project's
  durable asset — language-agnostic, reusable by any future implementation.
- **Conformance number** (corpus pass rate) reported in CI; it is the project's headline metric.
- **Property tests** (fast-check): formatter idempotence + reparse-equality; simplifier
  equivalence incl. blanks/modes; lexer round-trip.
- **Error-recovery suite:** malformed inputs asserting diagnostic count/positions/messages and
  recovered-AST shape.
- **VERIFICATION.md** tracks every org-verified behavior and every open question (text `=` case
  sensitivity per context, div-by-zero surfacing per context, blank propagation per operator per
  mode, ADDMONTHS month-end, DST datetime math, TEXT() output formats, numeric precision
  boundaries, Tier 2 availability matrices).

## 11. Build order

The layers were built bottom-up, mirroring the dependency direction in §2: the syntax pipeline
first (lexer → error-recovering parser → AST → CodeMirror integration), then analysis and
context configuration, then the evaluator (value domain, formulon port with fixes, simulation
boundary, golden corpus in CI), then the AST-consuming features (formatter, linter, simplifier,
permalinks), and finally the oracle conformance work and visual design. Contributors extending
the tool should follow the same discipline: semantics land in the corpus before they land in
code.
