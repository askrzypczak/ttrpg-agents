import type { RollResult } from "./roll.js";

export interface RollLogEntry {
  expression: string;
  dice: number[][];
  total: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/** The clock is injected so core logic stays deterministic. */
export function createLogEntry(result: RollResult, now: Date): RollLogEntry {
  return {
    expression: result.expression,
    dice: result.dice.map((d) => [...d]),
    total: result.total,
    timestamp: now.toISOString(),
  };
}
