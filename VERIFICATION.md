# VERIFICATION.md — behaviors pending org confirmation

Per CLAUDE.md rule 9, no behavioral claim about Salesforce semantics ships as
"supported" until it is confirmed against a real dev org and encoded as a golden
test. This file tracks every such open question. Until an item is verified, the
implementation either follows the golden corpus or marks the construct
unsupported — it never guesses.

Status legend: ❓ unverified · 🔬 verifying · ✅ verified (golden test id)

## Syntax / parsing

- ❓ **Operator precedence table** (`syntax/parser.ts` `BINARY_PRECEDENCE`).
  Currently encodes DESIGN §3.2's stated order (highest→lowest): unary sign; `^`;
  `* /`; `+ -`; `&`; comparisons (`< <= > >=`); equality (`= <>`). Two specific
  points need org confirmation:
  - Whether unary `-` binds tighter than `^` (so `-2^2` = `(-2)^2` = 4) or looser
    (`-(2^2)` = -4). The current prefix-unary structure yields the former.
  - Whether comparison truly binds tighter than equality in Salesforce, or they
    share one level.
- ❓ **`==` / `!=` operators.** Lexed and parsed as equality operators for
  recovery, but Salesforce formulas use only `=` / `<>`. Analysis should decide
  whether these are a hard error or a lenient alias; not yet settled.

## Semantics (from CLAUDE.md NEEDS-VERIFICATION list)

- ❓ Case sensitivity of text `=` / `<>` comparisons (per context, if it differs).
- ❓ Exact div-by-zero and overflow surfacing per context (formula field vs
  validation rule).
- ❓ Blank propagation through each arithmetic/comparison operator under both
  blank-handling modes ("treat blanks as zeroes" vs "as blanks").
- ❓ Date/datetime arithmetic edge cases: month-end `ADDMONTHS`, DST-adjacent
  datetime math, `TEXT()` output formats per type.
- ❓ Numeric precision/scale limits and rounding at display boundaries.
- ❓ Per-context function and global availability for every Tier 2 context.

## Verified

_(none yet — corpus and org-verification work begins in Phase 3.)_
