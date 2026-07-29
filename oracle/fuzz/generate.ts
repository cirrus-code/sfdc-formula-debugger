/**
 * WS4 differential fuzzer — grammar-driven constant-expression generator
 * (CONFORMANCE.md).
 *
 * Type-directed so the overwhelming majority of formulas type-check in both
 * engines: a discrepancy should be about semantics, not about one side
 * rejecting a nonsense expression. Constant expressions only — the oracle
 * harness can evaluate field-valued probes, but a field reference forces a
 * declared scale on every input, which is its own (already org-settled)
 * question and would drown the signal here.
 *
 * Determinism is the whole contract: same seed → byte-identical formula list.
 * Nothing here may read the clock or a global RNG.
 */

export type FuzzType = "Number" | "Text" | "Boolean";

export interface GeneratedFormula {
  readonly formula: string;
  readonly type: FuzzType;
}

export interface FuzzOptions {
  readonly seed: number;
  readonly count: number;
  /** Nesting budget per formula; each nested production spends one level. */
  readonly depth?: number;
}

interface Rng {
  /** Uniform in [0, 1). */
  float(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
}

/** mulberry32 — small, fast, and reproducible across engines. */
function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const float = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(float() * n);
  return {
    float,
    int,
    pick: <T>(xs: readonly T[]): T => xs[int(xs.length)]!,
    chance: (p: number): boolean => float() < p,
  };
}

/**
 * Literal pools. Numbers stay small enough that `^` and `*` chains rarely leave
 * the engines' representable range (overflow surfacing is org-settled and only
 * adds noise here); text avoids tabs, newlines, quotes and backslashes because
 * the oracle probe file is tab-separated and the two engines' string-escape
 * rules are not the subject under test.
 */
const NUMBERS = [
  "0",
  "1",
  "2",
  "3",
  "5",
  "7",
  "9",
  "10",
  "12",
  "100",
  "1000",
  "0.1",
  "0.5",
  "1.5",
  "2.5",
  "3.75",
  "12.125",
  "1234.5",
  "0.0001",
  "123456789",
] as const;

const TEXTS = [
  '""',
  '"a"',
  '"A"',
  '"ab"',
  '"abc"',
  '"abcabc"',
  '"Hello World"',
  '"  padded  "',
  '" "',
  '"0"',
  '"12"',
  '"12.5"',
  '"-3"',
  '"1e3"',
  '"x,y"',
  '"Ünïcøde"',
  '"it\'s"',
] as const;

/** Small integers for count/digit arguments, with a few out-of-range probes. */
const SMALL_INTS = ["0", "1", "2", "3", "4", "5", "10", "-1", "-2"] as const;

const NUM_OPS = ["+", "-", "*", "/"] as const;
const CMP_OPS = ["=", "<>", "<", "<=", ">", ">="] as const;
/** Exponents kept integral-ish; a fractional one is a deliberate rejection probe. */
const EXPONENTS = ["0", "1", "2", "3", "-1", "-2", "0.5"] as const;

interface Production {
  readonly weight: number;
  readonly build: () => string;
}

function choose(rng: Rng, productions: readonly Production[]): string {
  const total = productions.reduce((sum, p) => sum + p.weight, 0);
  let roll = rng.float() * total;
  for (const p of productions) {
    roll -= p.weight;
    if (roll < 0) {
      return p.build();
    }
  }
  return productions[productions.length - 1]!.build();
}

class Generator {
  constructor(private readonly rng: Rng) {}

  gen(type: FuzzType, depth: number): string {
    switch (type) {
      case "Number":
        return this.number(depth);
      case "Text":
        return this.text(depth);
      case "Boolean":
        return this.boolean(depth);
      default: {
        const never: never = type;
        throw new Error(`unhandled fuzz type ${String(never)}`);
      }
    }
  }

  /** Binary operands are parenthesized only half the time: precedence and
   * associativity differences between the two parsers are findings, not noise. */
  private binary(left: string, op: string, right: string): string {
    const body = `${left} ${op} ${right}`;
    return this.rng.chance(0.5) ? `(${body})` : body;
  }

  private list(
    type: FuzzType,
    depth: number,
    min: number,
    max: number,
  ): string {
    const n = min + this.rng.int(max - min + 1);
    return Array.from({ length: n }, () => this.gen(type, depth)).join(", ");
  }

  private number(depth: number): string {
    const rng = this.rng;
    if (depth <= 0) {
      return rng.pick(NUMBERS);
    }
    const d = depth - 1;
    return choose(rng, [
      { weight: 3, build: () => rng.pick(NUMBERS) },
      {
        weight: 6,
        build: () =>
          this.binary(this.number(d), rng.pick(NUM_OPS), this.number(d)),
      },
      {
        weight: 1,
        build: () => `(${this.number(d)}) ^ ${rng.pick(EXPONENTS)}`,
      },
      { weight: 1, build: () => `-(${this.number(d)})` },
      { weight: 1, build: () => `(${this.number(d)})` },
      { weight: 1, build: () => `ABS(${this.number(d)})` },
      { weight: 1, build: () => `SQRT(${this.number(d)})` },
      { weight: 1, build: () => `FLOOR(${this.number(d)})` },
      { weight: 1, build: () => `CEILING(${this.number(d)})` },
      { weight: 1, build: () => `MFLOOR(${this.number(d)})` },
      { weight: 1, build: () => `MCEILING(${this.number(d)})` },
      {
        weight: 2,
        build: () => `ROUND(${this.number(d)}, ${rng.pick(SMALL_INTS)})`,
      },
      // TRUNC is always two-argument here: the single-argument form is a
      // formula-field-only spelling that the oracle harness cannot even report
      // on (its arity error escapes as an i18n initialization failure).
      {
        weight: 2,
        build: () => `TRUNC(${this.number(d)}, ${rng.pick(SMALL_INTS)})`,
      },
      { weight: 2, build: () => `MOD(${this.number(d)}, ${this.number(d)})` },
      { weight: 1, build: () => `MIN(${this.list("Number", d, 2, 3)})` },
      { weight: 1, build: () => `MAX(${this.list("Number", d, 2, 3)})` },
      { weight: 2, build: () => `LEN(${this.text(d)})` },
      { weight: 1, build: () => `FIND(${this.text(d)}, ${this.text(d)})` },
      { weight: 1, build: () => `VALUE(${this.text(d)})` },
      {
        weight: 2,
        build: () =>
          `IF(${this.boolean(d)}, ${this.number(d)}, ${this.number(d)})`,
      },
    ]);
  }

  private text(depth: number): string {
    const rng = this.rng;
    if (depth <= 0) {
      return rng.pick(TEXTS);
    }
    const d = depth - 1;
    return choose(rng, [
      { weight: 4, build: () => rng.pick(TEXTS) },
      { weight: 5, build: () => this.binary(this.text(d), "&", this.text(d)) },
      // `+` over text is the org-overruled blank-absorption case; keep it rare
      // but present so the triage rule that covers it stays exercised.
      { weight: 1, build: () => this.binary(this.text(d), "+", this.text(d)) },
      {
        weight: 2,
        build: () => `LEFT(${this.text(d)}, ${rng.pick(SMALL_INTS)})`,
      },
      {
        weight: 2,
        build: () => `RIGHT(${this.text(d)}, ${rng.pick(SMALL_INTS)})`,
      },
      {
        weight: 2,
        build: () =>
          `MID(${this.text(d)}, ${rng.pick(SMALL_INTS)}, ${rng.pick(SMALL_INTS)})`,
      },
      { weight: 1, build: () => `TRIM(${this.text(d)})` },
      { weight: 1, build: () => `UPPER(${this.text(d)})` },
      { weight: 1, build: () => `LOWER(${this.text(d)})` },
      { weight: 3, build: () => `TEXT(${this.number(d)})` },
      {
        weight: 2,
        build: () => `IF(${this.boolean(d)}, ${this.text(d)}, ${this.text(d)})`,
      },
    ]);
  }

  private boolean(depth: number): string {
    const rng = this.rng;
    if (depth <= 0) {
      return rng.pick(["TRUE", "FALSE"]);
    }
    const d = depth - 1;
    return choose(rng, [
      { weight: 2, build: () => rng.pick(["TRUE", "FALSE"]) },
      {
        weight: 5,
        build: () =>
          this.binary(this.number(d), rng.pick(CMP_OPS), this.number(d)),
      },
      {
        weight: 4,
        build: () => this.binary(this.text(d), rng.pick(CMP_OPS), this.text(d)),
      },
      { weight: 2, build: () => `AND(${this.list("Boolean", d, 2, 3)})` },
      { weight: 2, build: () => `OR(${this.list("Boolean", d, 2, 3)})` },
      { weight: 1, build: () => `NOT(${this.boolean(d)})` },
      {
        weight: 1,
        build: () => this.binary(this.boolean(d), "&&", this.boolean(d)),
      },
      {
        weight: 1,
        build: () => this.binary(this.boolean(d), "||", this.boolean(d)),
      },
      { weight: 2, build: () => `CONTAINS(${this.text(d)}, ${this.text(d)})` },
      { weight: 1, build: () => `ISBLANK(${this.text(d)})` },
      { weight: 1, build: () => `ISBLANK(${this.number(d)})` },
      { weight: 1, build: () => `ISNUMBER(${this.text(d)})` },
      {
        weight: 1,
        build: () =>
          `IF(${this.boolean(d)}, ${this.boolean(d)}, ${this.boolean(d)})`,
      },
    ]);
  }
}

const TYPES: readonly FuzzType[] = ["Number", "Text", "Boolean"];

/** Long formulas are all tail, no new signal, and slow the oracle down. */
const MAX_FORMULA_LENGTH = 400;

export function generateFormulas(
  opts: FuzzOptions,
): readonly GeneratedFormula[] {
  const depth = opts.depth ?? 3;
  const rng = makeRng(opts.seed);
  const generator = new Generator(rng);
  const seen = new Set<string>();
  const out: GeneratedFormula[] = [];
  // Duplicates are pure oracle cost, so retry them — but a bounded number of
  // times, since a small depth budget has a finite formula space.
  const maxAttempts = opts.count * 20;
  for (let i = 0; out.length < opts.count && i < maxAttempts; i += 1) {
    const type = TYPES[i % TYPES.length]!;
    const formula = generator.gen(type, depth);
    if (formula.length > MAX_FORMULA_LENGTH || seen.has(formula)) {
      continue;
    }
    seen.add(formula);
    out.push({ formula, type });
  }
  return out;
}
