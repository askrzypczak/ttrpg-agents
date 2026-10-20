import { DomainError } from "../errors.js";
import type { MonsterInstance } from "./types.js";

/** One or more targets did not resolve to exactly one instance. */
export class TargetError extends DomainError {
  readonly unresolved: string[];
  readonly ambiguous: string[];
  constructor(message: string, unresolved: string[], ambiguous: string[]) {
    super("target", message);
    this.name = "TargetError";
    this.unresolved = unresolved;
    this.ambiguous = ambiguous;
  }
}

/**
 * Resolves each target by instance id first, else exact displayName.
 * Returns the instances deduped in first-seen order; throws TargetError if any
 * target is unknown or ambiguous.
 */
export function resolveTargets(
  instances: readonly MonsterInstance[],
  targets: readonly string[],
): MonsterInstance[] {
  void instances;
  void targets;
  throw new Error("not implemented");
}

/** Initiative descending, nulls last, then creation order. */
export function compareByInitiative(
  a: MonsterInstance,
  b: MonsterInstance,
): number {
  void a;
  void b;
  throw new Error("not implemented");
}
