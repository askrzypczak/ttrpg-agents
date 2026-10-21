import { parseDice } from "./parse.js";
import type { RollResult } from "./roll.js";

export interface RollLogEntry {
  expression: string;
  dice: number[][];
  /** Die sides per dice term, parallel to `dice`. */
  sides: number[];
  total: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** What the roll was for, e.g. "Shadow 3 HP". */
  label?: string;
}

/** The clock is injected so core logic stays deterministic. */
export function createLogEntry(
  result: RollResult,
  now: Date,
  label?: string,
): RollLogEntry {
  const sides: number[] = [];
  for (const term of parseDice(result.expression).terms) {
    if (term.kind === "dice") sides.push(term.sides);
  }
  const entry: RollLogEntry = {
    expression: result.expression,
    dice: result.dice.map((d) => [...d]),
    sides,
    total: result.total,
    timestamp: now.toISOString(),
  };
  if (label !== undefined) entry.label = label;
  return entry;
}
