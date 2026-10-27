import { DomainError } from "../errors.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import { createNumberedNaming, type NamingStrategy } from "./add-monsters.js";
import type { ChangeOrigin } from "./origin.js";
import { TargetError, resolveTargets } from "./queries.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export type RestoreMonstersErrorCode =
  "not_removed" | "unknown_monster" | "nothing_cleared";

export class RestoreMonstersError extends DomainError {
  declare readonly code: RestoreMonstersErrorCode;
  constructor(code: RestoreMonstersErrorCode, message: string) {
    super(code, message);
    this.name = "RestoreMonstersError";
  }
}

export interface RestoreMonstersDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  /** Names a restored monster whose name is taken; defaults to createNumberedNaming(). */
  naming?: NamingStrategy;
}

export interface RestoredMonster {
  instance: MonsterInstance;
  /** The name it had when removed, when it came back under a new one; else null. */
  renamedFrom: string | null;
}

/** Restores removed monsters by id or exact name, all or nothing. */
export function restoreMonsters(
  deps: RestoreMonstersDeps,
  targets: readonly string[],
  origin: ChangeOrigin,
): RestoredMonster[] {
  const removed = deps.repo.listRemovedInstances().map((r) => r.instance);
  const resolved = resolveRemoved(deps.repo, removed, targets);
  return restoreResolved(deps, resolved, origin);
}

/**
 * Restores the last clear's instances not restored since, in creation order,
 * all or nothing. Throws RestoreMonstersError `nothing_cleared` when there are
 * none, `unknown_monster` as restoreMonsters does.
 */
export function restoreEncounter(
  deps: RestoreMonstersDeps,
  origin: ChangeOrigin,
): RestoredMonster[] {
  const cleared = clearedNotRestored(deps.repo);
  if (cleared.length === 0) {
    throw new RestoreMonstersError(
      "nothing_cleared",
      "No cleared monsters to restore",
    );
  }
  return restoreResolved(deps, cleared, origin);
}

/**
 * Whether restoreEncounter has something to bring back: the last clear's
 * instances not restored since.
 */
export function canRestoreEncounter(
  repo: Pick<EncounterRepository, "listRemovedInstances">,
): boolean {
  return clearedNotRestored(repo).length > 0;
}

/** The last clear's instances not restored since, in creation order. */
function clearedNotRestored(
  repo: Pick<EncounterRepository, "listRemovedInstances">,
): MonsterInstance[] {
  return repo
    .listRemovedInstances()
    .filter((r) => r.cleared)
    .map((r) => r.instance);
}

/**
 * Puts the resolved removed instances back in one write, each under its name
 * or, when that is taken, the next free number; checks every monster type
 * first so an unknown one restores nothing.
 */
function restoreResolved(
  deps: RestoreMonstersDeps,
  resolved: readonly MonsterInstance[],
  origin: ChangeOrigin,
): RestoredMonster[] {
  for (const instance of resolved) monsterOf(deps.monsters, instance);

  const restored = deps.repo.restoreInstances(
    resolved.map((i) => i.id),
    (instance, namesInUse) =>
      namesInUse.includes(instance.displayName)
        ? // A fresh default strategy per rename scans the names in use now,
          // including those kept earlier in this call.
          (deps.naming ?? createNumberedNaming())({
            monster: monsterOf(deps.monsters, instance),
            existingNames: namesInUse,
          })
        : instance.displayName,
    origin,
  );

  const removedNames = new Map(resolved.map((i) => [i.id, i.displayName]));
  return restored.map((instance) => {
    const before = removedNames.get(instance.id);
    return {
      instance,
      renamedFrom:
        before === undefined || before === instance.displayName ? null : before,
    };
  });
}

/**
 * Resolves the targets among the removed instances. A target that fails there
 * but names a live instance is reported as not removed; any other failure is
 * the TargetError itself.
 */
function resolveRemoved(
  repo: EncounterRepository,
  removed: readonly MonsterInstance[],
  targets: readonly string[],
): MonsterInstance[] {
  try {
    return resolveTargets(removed, targets);
  } catch (e) {
    if (!(e instanceof TargetError)) throw e;
    const live = repo.listInstances();
    const names = [
      ...new Set(
        e.unresolved.flatMap((target) =>
          live
            .filter((i) => i.id === target || i.displayName === target)
            .map((i) => i.displayName),
        ),
      ),
    ];
    if (names.length === 0) throw e;
    throw new RestoreMonstersError(
      "not_removed",
      `${names.join(", ")} ${names.length === 1 ? "is" : "are"} in the encounter, not removed`,
    );
  }
}

function monsterOf(monsters: MonsterIndex, instance: MonsterInstance): Monster {
  const monster = monsters.byKey.get(instance.monsterKey);
  if (!monster) {
    throw new RestoreMonstersError(
      "unknown_monster",
      `Cannot restore ${instance.displayName}: monster type ${instance.monsterKey} is not in the monster index`,
    );
  }
  return monster;
}
