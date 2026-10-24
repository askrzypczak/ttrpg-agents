import { createLogEntry, type RollLogEntry } from "../dice/log.js";
import { roll } from "../dice/roll.js";
import type { Rng } from "../dice/rng.js";
import { footprintForSize } from "../monsters/footprint.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import { DomainError } from "../errors.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { NewMonsterInstance } from "./types.js";

export const MAX_GROUP_COUNT = 50;

export type HpMode = "rolled" | "average";
export type InitiativeMode = "group" | "each";

export interface AddMonstersGroup {
  /** Monster key, e.g. `srd-2024_shadow`. */
  monster: string;
  count: number;
  /** Defaults to `rolled`. */
  hp?: HpMode;
  /** Reveal the group's stats to players; defaults to false (GM-only). */
  statsVisible?: boolean;
}

export interface AddMonstersOptions {
  /** Max instances per group; positive integer. Defaults to `MAX_GROUP_COUNT`. */
  maxGroupCount?: number;
  /** `group` (default): one initiative roll per group; `each`: one per instance. */
  initiative?: InitiativeMode;
}

export type NamingStrategy = (ctx: {
  monster: Monster;
  existingNames: readonly string[];
}) => string;

export interface AddMonstersDeps {
  repo: EncounterRepository;
  monsters: MonsterIndex;
  rng: Rng;
  now: () => Date;
  naming?: NamingStrategy;
  /** Source of group ids; injected so the engine stays free of Node. */
  newGroupId: () => string;
}

export interface AddedInstance {
  id: string;
  name: string;
  monsterKey: string;
  ac: number;
  maxHp: number;
  hpMode: HpMode;
  initiative: number;
  groupId: string;
}

export interface AddMonstersResult {
  instances: AddedInstance[];
  rolls: RollLogEntry[];
}

export type AddMonstersErrorCode =
  | "empty"
  | "unknown_monster"
  | "invalid_count"
  | "invalid_hp"
  | "invalid_initiative";

export class AddMonstersError extends DomainError {
  declare readonly code: AddMonstersErrorCode;
  constructor(code: AddMonstersErrorCode, message: string) {
    super(code, message);
    this.name = "AddMonstersError";
  }
}

/**
 * Default naming: "<Name> <n>", n continuing from the highest numeric suffix
 * already used for that exact monster name. Create one per addMonsters call:
 * it scans `existingNames` once (on first use), then each call is O(1).
 */
export function createNumberedNaming(): NamingStrategy {
  let highest: Map<string, number> | undefined;
  return ({ monster, existingNames }) => {
    if (highest === undefined) {
      const map = new Map<string, number>();
      for (const name of existingNames) {
        const space = name.lastIndexOf(" ");
        if (space < 0) continue;
        const suffix = name.slice(space + 1);
        if (!/^\d+$/.test(suffix)) continue;
        const prefix = name.slice(0, space);
        map.set(prefix, Math.max(map.get(prefix) ?? 0, Number(suffix)));
      }
      highest = map;
    }
    const next = (highest.get(monster.name) ?? 0) + 1;
    highest.set(monster.name, next);
    return `${monster.name} ${String(next)}`;
  };
}

function validate(
  monsters: MonsterIndex,
  groups: readonly AddMonstersGroup[],
  maxGroupCount: number,
  initiative: unknown,
): void {
  if (!Number.isInteger(maxGroupCount) || maxGroupCount < 1) {
    throw new AddMonstersError(
      "invalid_count",
      `maxGroupCount must be a positive integer, got ${String(maxGroupCount)}`,
    );
  }
  if (initiative !== "group" && initiative !== "each") {
    throw new AddMonstersError(
      "invalid_initiative",
      `initiative must be "group" or "each", got ${String(initiative)}`,
    );
  }
  if (groups.length === 0) {
    throw new AddMonstersError("empty", "No monster groups given");
  }
  groups.forEach((group, i) => {
    const where = `Group ${i + 1} (${group.monster})`;
    if (!monsters.byKey.has(group.monster)) {
      throw new AddMonstersError(
        "unknown_monster",
        `${where}: unknown monster "${group.monster}"`,
      );
    }
    if (
      !Number.isInteger(group.count) ||
      group.count < 1 ||
      group.count > maxGroupCount
    ) {
      throw new AddMonstersError(
        "invalid_count",
        `${where}: count must be an integer between 1 and ${String(maxGroupCount)}, got ${String(group.count)}`,
      );
    }
    if (
      group.hp !== undefined &&
      group.hp !== "rolled" &&
      group.hp !== "average"
    ) {
      throw new AddMonstersError(
        "invalid_hp",
        `${where}: hp must be "rolled" or "average", got ${String(group.hp)}`,
      );
    }
  });
}

/**
 * Adds groups of monsters to the active encounter: rolls (or averages) HP and
 * initiative, assigns numbered names, and persists everything in one
 * transaction. All input is validated before any roll or store write.
 */
export function addMonsters(
  deps: AddMonstersDeps,
  groups: readonly AddMonstersGroup[],
  origin: ChangeOrigin,
  options: AddMonstersOptions = {},
): AddMonstersResult {
  const { repo, monsters, rng, now } = deps;
  const naming = deps.naming ?? createNumberedNaming();
  const newGroupId = deps.newGroupId;
  const initiativeMode = options.initiative ?? "group";

  validate(
    monsters,
    groups,
    options.maxGroupCount ?? MAX_GROUP_COUNT,
    initiativeMode,
  );

  const rolls: RollLogEntry[] = [];
  const hpModes: HpMode[] = [];
  const acs: number[] = [];

  const items: NewMonsterInstance[] = [];
  const saved = repo.addInstances((names) => {
    for (const group of groups) {
      const monster = monsters.byKey.get(group.monster);
      /* v8 ignore next -- validated above */
      if (monster === undefined) continue;
      const hpMode = group.hp ?? "rolled";
      const groupId = newGroupId();
      const groupStart = items.length;

      for (let n = 0; n < group.count; n++) {
        const displayName = naming({ monster, existingNames: names });
        names.push(displayName);
        let maxHp = monster.hp.average;
        if (hpMode === "rolled") {
          const result = roll(monster.hp.dice, rng);
          rolls.push(createLogEntry(result, now(), `${displayName} HP`));
          // Clamp to 1; the logged roll keeps the raw total, so it can differ from maxHp.
          maxHp = Math.max(1, result.total);
        }
        items.push({
          monsterKey: monster.key,
          displayName,
          maxHp,
          armorClass: monster.ac,
          groupId,
          footprint: footprintForSize(monster.size),
          statsVisible: group.statsVisible ?? false,
        });
        hpModes.push(hpMode);
        acs.push(monster.ac);
      }

      const rollInitiative = (label: string): number => {
        const result = roll("1d20", rng);
        rolls.push(createLogEntry(result, now(), label));
        return result.total + monster.initiativeModifier;
      };
      if (initiativeMode === "group") {
        const initiative = rollInitiative(`${monster.name} initiative (group)`);
        for (let i = groupStart; i < items.length; i++) {
          const item = items[i];
          if (item) item.initiative = initiative;
        }
      } else {
        for (let i = groupStart; i < items.length; i++) {
          const item = items[i];
          if (item)
            item.initiative = rollInitiative(`${item.displayName} initiative`);
        }
      }
    }
    return items;
  }, origin);
  if (saved.length !== items.length) {
    throw new Error(
      `Store persisted ${saved.length} instances, expected ${items.length}`,
    );
  }
  const instances = saved.map((s, i): AddedInstance => {
    const item = items[i];
    const ac = acs[i];
    const hpMode = hpModes[i];
    if (
      item?.initiative == null ||
      item.groupId == null ||
      ac === undefined ||
      hpMode === undefined
    ) {
      throw new Error(`Missing local data for instance ${i}`);
    }
    return {
      id: s.id,
      name: item.displayName,
      monsterKey: item.monsterKey,
      ac,
      maxHp: item.maxHp,
      hpMode,
      initiative: item.initiative,
      groupId: item.groupId,
    };
  });
  return { instances, rolls };
}
