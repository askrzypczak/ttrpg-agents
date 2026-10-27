import type { RollLogEntry } from "../dice/log.js";
import type { Rng } from "../dice/rng.js";
import { footprintForSize } from "../monsters/footprint.js";
import type { MonsterIndex } from "../monsters/types.js";
import {
  createNumberedNaming,
  type HpMode,
  type NamingStrategy,
} from "./add-monsters.js";
import {
  SameMonsterError,
  UnknownInstanceError,
  UnknownMonsterError,
} from "./errors.js";
import { rollMaxHp } from "./max-hp.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository, MonsterChange } from "./repository.js";
import type { MonsterInstance } from "./types.js";

export interface ChangeMonsterTypeDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
  naming?: NamingStrategy;
}

/** One changed instance: as listed before the change and as written. */
export interface ChangedMonster {
  before: MonsterInstance;
  after: MonsterInstance;
  /** True when its footprint grew. */
  noLongerFits: boolean;
  /**
   * The kept d20 roll: the old initiative less the old monster's modifier;
   * null when the target had no initiative.
   */
  initiativeRoll: number | null;
}

export interface ChangeMonsterTypeResult {
  /** One per given id, in that order. */
  instances: ChangedMonster[];
  /** One entry per HP roll, in id order; empty in average mode. */
  rolls: RollLogEntry[];
}

/**
 * Changes existing instances to another monster type, keeping each one's id,
 * group, stats visibility, spawn position and damage taken.
 *
 * Each target gets a name numbered as for an add (in input order), the new
 * monster's max HP (average or rolled), AC and footprint. Its current HP is
 * the new max less the damage it had taken (at least 0); an initiative keeps
 * its roll with the new monster's modifier, and none stays none. Everything is
 * checked before any roll or write: UnknownMonsterError for an unknown key (or
 * a target with an initiative whose current monster is not in the index),
 * UnknownInstanceError for an id that is not a live instance, SameMonsterError
 * for a target already of that monster. The changes are written in one
 * repository call.
 */
export function changeMonsterType(
  deps: ChangeMonsterTypeDeps,
  instanceIds: readonly string[],
  monsterKey: string,
  mode: HpMode,
  origin: ChangeOrigin,
): ChangeMonsterTypeResult {
  const { repo, monsters, rng, now } = deps;
  const monster = monsters.byKey.get(monsterKey);
  if (monster === undefined) {
    throw new UnknownMonsterError(`unknown monster "${monsterKey}"`);
  }
  const live = repo.listInstances();
  const byId = new Map(live.map((i) => [i.id, i] as const));
  const targets = instanceIds.map((id) => {
    const instance = byId.get(id);
    if (instance === undefined) {
      throw new UnknownInstanceError(`no instance ${id}`);
    }
    return instance;
  });
  const oldModifiers = targets.map((instance) => {
    if (instance.initiative === null) return 0;
    const old = monsters.byKey.get(instance.monsterKey);
    if (old === undefined) {
      throw new UnknownMonsterError(
        `${instance.displayName}: unknown monster "${instance.monsterKey}"`,
      );
    }
    return old.initiativeModifier;
  });
  for (const instance of targets) {
    if (instance.monsterKey === monster.key) {
      throw new SameMonsterError(
        `${instance.displayName} already is a ${monster.name}`,
      );
    }
  }

  const naming = deps.naming ?? createNumberedNaming();
  const names = live.map((i) => i.displayName);
  const footprint = footprintForSize(monster.size);
  const rolls: RollLogEntry[] = [];
  const changes = targets.map((instance, n): MonsterChange => {
    const displayName = naming({ monster, existingNames: names });
    names.push(displayName);
    const hp = rollMaxHp({ rng, now }, monster.hp, mode, displayName);
    if (hp.roll !== null) rolls.push(hp.roll);
    const damageTaken = instance.maxHp - instance.currentHp;
    return {
      id: instance.id,
      monsterKey: monster.key,
      displayName,
      maxHp: hp.maxHp,
      currentHp: Math.max(0, hp.maxHp - damageTaken),
      armorClass: monster.ac,
      initiative:
        instance.initiative === null
          ? null
          : instance.initiative -
            (oldModifiers[n] ?? 0) +
            monster.initiativeModifier,
      footprint,
    };
  });

  const written = repo.changeMonsters(changes, origin);
  const instances = targets.map((before, n): ChangedMonster => {
    const after = written[n];
    if (after === undefined) {
      throw new Error(
        `Store changed ${String(written.length)} instances, expected ${String(targets.length)}`,
      );
    }
    return {
      before,
      after,
      noLongerFits: after.footprint > before.footprint,
      initiativeRoll: null,
    };
  });
  return { instances, rolls };
}
