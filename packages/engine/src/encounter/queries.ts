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
  const resolved: MonsterInstance[] = [];
  const unresolved: string[] = [];
  const ambiguous: string[] = [];
  const problems: string[] = [];
  for (const target of targets) {
    const byId = instances.find((i) => i.id === target);
    const byName = instances.filter((i) => i.displayName === target);
    const found = byId ?? (byName.length === 1 ? byName[0] : undefined);
    if (found) {
      if (!resolved.some((i) => i.id === found.id)) resolved.push(found);
    } else if (byName.length > 1) {
      ambiguous.push(target);
      problems.push(
        `Ambiguous target "${target}": ${String(byName.length)} instances share that name; use an id`,
      );
    } else {
      unresolved.push(target);
      problems.push(`Unknown target "${target}"`);
    }
  }
  if (problems.length > 0) {
    throw new TargetError(problems.join("; "), unresolved, ambiguous);
  }
  return resolved;
}

/** Initiative descending, nulls last, then creation order. */
export function compareByInitiative(
  a: MonsterInstance,
  b: MonsterInstance,
): number {
  if (a.initiative !== b.initiative) {
    if (a.initiative === null) return 1;
    if (b.initiative === null) return -1;
    return b.initiative - a.initiative;
  }
  return a.createdAt - b.createdAt;
}
