import { createLogEntry, type RollLogEntry } from "../dice/log.js";
import type { Rng } from "../dice/rng.js";
import { roll } from "../dice/roll.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { InitiativeMode } from "./add-monsters.js";
import { UnknownInstanceError, UnknownMonsterError } from "./errors.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

/** What the roll needs from an instance, stored or about to be added. */
export interface InitiativeRollInput {
  monsterKey: string;
  displayName: string;
  /** Items with the same non-null groupId share one roll in group mode; null or absent rolls alone. */
  groupId?: string | null;
}

export interface InitiativeRollDeps {
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
}

/** One item's rolled initiative. */
export interface InitiativeRollOutcome {
  /** The d20 result. */
  roll: number;
  /** The monster's initiative modifier that was added. */
  modifier: number;
  /** roll + modifier. */
  initiative: number;
}

export interface InitiativeRollResult {
  /** One per input item, in input order. */
  outcomes: InitiativeRollOutcome[];
  /** One entry per d20 rolled, in roll order. */
  rolls: RollLogEntry[];
}

/**
 * Rolls initiative (1d20 plus the monster's initiative modifier) for each
 * item with the injected rng. Every item's monster is looked up before the
 * first roll, so an unknown monster throws UnknownMonsterError without
 * consuming randomness.
 *
 * `group`: items with the same non-null groupId share one roll, labelled with
 * the monster's name; an item without a groupId rolls alone. `each`: every item
 * rolls alone. A group whose items name different monsters (possible after a
 * merge) uses the first item's monster, in input order, for the shared modifier
 * and label.
 */
export function rollInitiativeValues(
  deps: InitiativeRollDeps,
  instances: readonly InitiativeRollInput[],
  mode: InitiativeMode,
): InitiativeRollResult {
  const { monsters, rng, now } = deps;
  const resolved = instances.map((item) => {
    const monster = monsters.byKey.get(item.monsterKey);
    if (monster === undefined) {
      throw new UnknownMonsterError(
        `${item.displayName}: unknown monster "${item.monsterKey}"`,
      );
    }
    return { item, monster };
  });

  const rolls: RollLogEntry[] = [];
  const rollOnce = (monster: Monster, label: string): InitiativeRollOutcome => {
    const result = roll("1d20", rng);
    rolls.push(createLogEntry(result, now(), label));
    return {
      roll: result.total,
      modifier: monster.initiativeModifier,
      initiative: result.total + monster.initiativeModifier,
    };
  };

  const sharedByGroup = new Map<string, InitiativeRollOutcome>();
  const outcomes = resolved.map(({ item, monster }): InitiativeRollOutcome => {
    const groupId = mode === "group" ? item.groupId : null;
    if (groupId == null) {
      return rollOnce(monster, `${item.displayName} initiative`);
    }
    const shared = sharedByGroup.get(groupId);
    if (shared !== undefined) return shared;
    const outcome = rollOnce(monster, `${monster.name} initiative (group)`);
    sharedByGroup.set(groupId, outcome);
    return outcome;
  });
  return { outcomes, rolls };
}

export interface RollInitiativeDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
}

/** One instance after its roll was written. */
export interface RolledInitiative {
  instance: MonsterInstance;
  /** Initiative before the roll; null when it had none. */
  before: number | null;
  roll: number;
  modifier: number;
}

export interface RollInitiativeResult {
  /** In the order of the given ids. */
  instances: RolledInitiative[];
  rolls: RollLogEntry[];
}

/**
 * Rolls initiative for existing instances of the active encounter and writes
 * each value through `setInitiative` with the one origin. Every id is checked
 * before the first roll, and every monster before the first roll or write, so
 * a failure changes nothing.
 */
export function rollInitiative(
  deps: RollInitiativeDeps,
  instanceIds: readonly string[],
  origin: ChangeOrigin,
  mode: InitiativeMode = "group",
): RollInitiativeResult {
  const { repo, monsters, rng, now } = deps;
  const byId = new Map(repo.listInstances().map((i) => [i.id, i] as const));
  const targets = instanceIds.map((id) => {
    const instance = byId.get(id);
    if (instance === undefined) {
      throw new UnknownInstanceError(`no instance ${id}`);
    }
    return instance;
  });
  const rolled = rollInitiativeValues({ monsters, rng, now }, targets, mode);
  const instances = targets.map((target, i): RolledInitiative => {
    const outcome = rolled.outcomes[i];
    if (outcome === undefined) {
      throw new Error(`Missing roll for instance ${target.id}`);
    }
    const updated = repo.setInitiative(target.id, outcome.initiative, origin);
    return {
      instance: updated,
      before: target.initiative,
      roll: outcome.roll,
      modifier: outcome.modifier,
    };
  });
  return { instances, rolls: rolled.rolls };
}
