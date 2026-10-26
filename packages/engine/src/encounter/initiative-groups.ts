import type { RollLogEntry } from "../dice/log.js";
import { UnknownInstanceError } from "./errors.js";
import { rollInitiativeValues, type RollInitiativeDeps } from "./initiative.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export interface SplitInitiativeDeps extends RollInitiativeDeps {
  /** Source of group ids; injected so the engine stays free of Node. */
  newGroupId: () => string;
}

export interface MergeInitiativeDeps {
  repo: EncounterRepository;
  newGroupId: () => string;
}

export interface SplitInitiativeOptions {
  /** Roll each instance its own new initiative; default false keeps each value. */
  roll?: boolean;
}

/** One instance after a split or merge was written. */
export interface RegroupedInstance {
  instance: MonsterInstance;
  /** Initiative before the change; null when it had none. */
  before: number | null;
  /** The d20 and modifier of a rolled split; absent when nothing was rolled. */
  rolled?: { roll: number; modifier: number };
}

export interface SplitInitiativeResult {
  /** In the order of the given ids. */
  instances: RegroupedInstance[];
  /** One entry per d20 rolled; empty without `roll`. */
  rolls: RollLogEntry[];
}

export interface MergeInitiativeResult {
  /** In the order of the given ids. */
  instances: RegroupedInstance[];
  /** The initiative the group shares; null when no named instance has one. */
  initiative: number | null;
}

/**
 * The stored instances named by `instanceIds`, in the order given. Throws
 * UnknownInstanceError for an id not in the active encounter.
 */
function namedInstances(
  repo: EncounterRepository,
  instanceIds: readonly string[],
): MonsterInstance[] {
  const byId = new Map(repo.listInstances().map((i) => [i.id, i] as const));
  return instanceIds.map((id) => {
    const instance = byId.get(id);
    if (instance === undefined) {
      throw new UnknownInstanceError(`no instance ${id}`);
    }
    return instance;
  });
}

/**
 * Gives each named instance of the active encounter a new initiative group of
 * its own, so it acts on its own. An unnamed member of the old group keeps that
 * group and still shares it with the other unnamed members.
 *
 * Without `roll` each instance keeps its initiative and nothing is rolled. With
 * `roll`, each instance rolls its own initiative (`rollInitiativeValues` in
 * `each` mode) and that value is written.
 *
 * Validation comes first: every id is checked, and with `roll` every monster is
 * looked up, before the first roll or write, so a failure changes no group and
 * no initiative. Writes then run per instance in the given order: the group,
 * then the initiative when rolled. Without `roll` no initiative is written,
 * because an `mcp` initiative event drops a table edit held on that field.
 */
export function splitInitiative(
  deps: SplitInitiativeDeps,
  instanceIds: readonly string[],
  origin: ChangeOrigin,
  options?: SplitInitiativeOptions,
): SplitInitiativeResult {
  const { repo, monsters, rng, now, newGroupId } = deps;
  const targets = namedInstances(repo, instanceIds);
  const rolled =
    options?.roll === true
      ? rollInitiativeValues({ monsters, rng, now }, targets, "each")
      : undefined;
  const instances = targets.map((target, i): RegroupedInstance => {
    const regrouped = repo.setGroupId(target.id, newGroupId(), origin);
    if (rolled === undefined) {
      return { instance: regrouped, before: target.initiative };
    }
    const outcome = rolled.outcomes[i];
    if (outcome === undefined) {
      throw new Error(`Missing roll for instance ${target.id}`);
    }
    return {
      instance: repo.setInitiative(target.id, outcome.initiative, origin),
      before: target.initiative,
      rolled: { roll: outcome.roll, modifier: outcome.modifier },
    };
  });
  return { instances, rolls: rolled?.rolls ?? [] };
}

/**
 * Puts the named instances of the active encounter into one new initiative
 * group, so they act together. The shared initiative is the one of the first
 * named instance that has one, or null when none has; nothing is rolled (a
 * fresh shared roll is `rollInitiative` after the merge).
 *
 * The group gets a fresh id rather than a member's old one, so it holds exactly
 * the named instances and any unnamed member of an old group keeps that group.
 *
 * Validation comes first: every id is checked before the first write. Writes
 * then run per instance in the given order: the group, then the initiative, but
 * only for an instance whose value differs from the shared one. An `mcp`
 * initiative event drops a table edit held on that field, so a member already
 * at the shared value gets no initiative write. With no shared value nothing is
 * written to initiative.
 */
export function mergeInitiative(
  deps: MergeInitiativeDeps,
  instanceIds: readonly string[],
  origin: ChangeOrigin,
): MergeInitiativeResult {
  const { repo, newGroupId } = deps;
  const targets = namedInstances(repo, instanceIds);
  const shared =
    targets.find((target) => target.initiative !== null)?.initiative ?? null;
  const group = newGroupId();
  const instances = targets.map((target): RegroupedInstance => {
    const regrouped = repo.setGroupId(target.id, group, origin);
    const instance =
      shared !== null && target.initiative !== shared
        ? repo.setInitiative(target.id, shared, origin)
        : regrouped;
    return { instance, before: target.initiative };
  });
  return { instances, initiative: shared };
}
