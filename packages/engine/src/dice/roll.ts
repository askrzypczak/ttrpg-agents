import { parseDice, type DiceExpression } from "./parse.js";
import type { Rng } from "./rng.js";

export interface RollResult {
  expression: string;
  /** Individual die results, one array per dice term, in expression order. */
  dice: number[][];
  /** Sum of the signed constant terms. */
  modifier: number;
  total: number;
}

function toExpression(expr: string | DiceExpression): DiceExpression {
  return typeof expr === "string" ? parseDice(expr) : expr;
}

export function roll(expr: string | DiceExpression, rng: Rng): RollResult {
  const parsed = toExpression(expr);
  const dice: number[][] = [];
  let modifier = 0;
  let total = 0;
  for (const term of parsed.terms) {
    if (term.kind === "constant") {
      modifier += term.sign * term.value;
      total += term.sign * term.value;
    } else {
      const results: number[] = [];
      for (let i = 0; i < term.count; i++) {
        const value = rng.nextInt(term.sides) + 1;
        results.push(value);
        total += term.sign * value;
      }
      dice.push(results);
    }
  }
  return { expression: parsed.source, dice, modifier, total };
}

/** Statblock average: the mean, floored toward -infinity (so "1 - 1d4" is -2, not -1). */
export function average(expr: string | DiceExpression): number {
  const parsed = toExpression(expr);
  let twice = 0; // doubled to stay in integers
  for (const term of parsed.terms) {
    twice +=
      term.kind === "constant"
        ? term.sign * term.value * 2
        : term.sign * term.count * (term.sides + 1);
  }
  return Math.floor(twice / 2);
}
