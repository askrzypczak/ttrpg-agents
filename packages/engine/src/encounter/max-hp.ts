import { createLogEntry, type RollLogEntry } from "../dice/log.js";
import type { Rng } from "../dice/rng.js";
import { roll } from "../dice/roll.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import type { HpMode } from "./add-monsters.js";
import { UnknownInstanceError, UnknownMonsterError } from "./errors.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository, HpChange } from "./repository.js";

export interface MaxHpRollDeps {
  rng: Rng;
  now: () => Date;
}

/** One instance's max HP choice. */
export interface MaxHpRoll {
  /** The average, or the roll's total raised to at least 1. */
  maxHp: number;
  /** The HP dice roll labelled "<displayName> HP", with the raw total; null in average mode. */
  roll: RollLogEntry | null;
}

/**
 * Max HP from a monster's HP: its average (no rng consumed), or a roll of its
 * HP dice with the injected rng, raised to at least 1 (the log keeps the raw total).
 */
export function rollMaxHp(
  deps: MaxHpRollDeps,
  hp: Monster["hp"],
  mode: HpMode,
  displayName: string,
): MaxHpRoll {
  if (mode === "average") {
    return { maxHp: hp.average, roll: null };
  }
  const { rng, now } = deps;
  const result = roll(hp.dice, rng);
  const entry = createLogEntry(result, now(), `${displayName} HP`);
  // Clamp to 1; the logged roll keeps the raw total, so it can differ from maxHp.
  return { maxHp: Math.max(1, result.total), roll: entry };
}

export interface ResetMaxHpDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
}

export interface ResetMaxHpResult {
  /**
   * One per given id, in that order: `before` is the instance before the
   * setMaxHp write, `after` the instance after the last write (the setHp
   * result when one was made).
   */
  instances: HpChange[];
  /** One entry per HP roll, in id order; empty in average mode. */
  rolls: RollLogEntry[];
}

/**
 * Sets the max HP of existing instances to their monster's average or a new
 * roll. Checks every id and monster before any roll or write (throws
 * UnknownInstanceError / UnknownMonsterError, changing nothing). An instance
 * at full HP ends at full HP at the new max; otherwise current HP is kept,
 * lowered to the new max if above it.
 */
export function resetMaxHp(
  deps: ResetMaxHpDeps,
  instanceIds: readonly string[],
  mode: HpMode,
  origin: ChangeOrigin,
): ResetMaxHpResult {
  const { repo, monsters, rng, now } = deps;
  const byId = new Map(repo.listInstances().map((i) => [i.id, i] as const));
  const targets = instanceIds.map((id) => {
    const instance = byId.get(id);
    if (instance === undefined) {
      throw new UnknownInstanceError(`no instance ${id}`);
    }
    const monster = monsters.byKey.get(instance.monsterKey);
    if (monster === undefined) {
      throw new UnknownMonsterError(
        `${instance.displayName}: unknown monster "${instance.monsterKey}"`,
      );
    }
    return { instance, monster };
  });

  const rolls: RollLogEntry[] = [];
  const planned = targets.map(({ instance, monster }) => {
    const choice = rollMaxHp(
      { rng, now },
      monster.hp,
      mode,
      instance.displayName,
    );
    if (choice.roll !== null) rolls.push(choice.roll);
    return { id: instance.id, maxHp: choice.maxHp };
  });

  const instances = planned.map(({ id, maxHp }): HpChange => {
    const { before, after } = repo.setMaxHp(id, maxHp, origin);
    if (before.currentHp === before.maxHp && after.currentHp < after.maxHp) {
      return {
        before,
        after: repo.setHp(id, after.maxHp, origin).after,
      };
    }
    return { before, after };
  });
  return { instances, rolls };
}
