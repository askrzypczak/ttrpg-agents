import { randomUUID } from "node:crypto";
import { createLogEntry, type RollLogEntry } from "../dice/log.js";
import { roll } from "../dice/roll.js";
import type { Rng } from "../dice/rng.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/loader.js";
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
}

export interface AddMonstersOptions {
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
  /** Defaults to `crypto.randomUUID`. */
  newGroupId?: () => string;
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
  "empty" | "unknown_monster" | "invalid_count" | "invalid_hp";

export class AddMonstersError extends Error {
  readonly code: AddMonstersErrorCode;
  constructor(code: AddMonstersErrorCode, message: string) {
    super(message);
    this.name = "AddMonstersError";
    this.code = code;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "<Name> <n>", n continuing from the highest numeric suffix already used. */
export const defaultNaming: NamingStrategy = ({ monster, existingNames }) => {
  const pattern = new RegExp(`^${escapeRegExp(monster.name)} (\\d+)$`);
  let highest = 0;
  for (const name of existingNames) {
    const match = pattern.exec(name);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  return `${monster.name} ${highest + 1}`;
};

function validate(
  monsters: MonsterIndex,
  groups: readonly AddMonstersGroup[],
): void {
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
      group.count > MAX_GROUP_COUNT
    ) {
      throw new AddMonstersError(
        "invalid_count",
        `${where}: count must be an integer between 1 and ${MAX_GROUP_COUNT}, got ${String(group.count)}`,
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
  options: AddMonstersOptions = {},
): AddMonstersResult {
  const { repo, monsters, rng, now } = deps;
  const naming = deps.naming ?? defaultNaming;
  const newGroupId = deps.newGroupId ?? randomUUID;
  const initiativeMode = options.initiative ?? "group";

  validate(monsters, groups);

  const names = repo.listInstances().map((i) => i.displayName);
  const rolls: RollLogEntry[] = [];
  const items: NewMonsterInstance[] = [];
  const hpModes: HpMode[] = [];

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
        maxHp = Math.max(1, result.total);
      }
      items.push({ monsterKey: monster.key, displayName, maxHp, groupId });
      hpModes.push(hpMode);
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

  const saved = repo.addInstances(items);
  const instances = saved.map((s, i): AddedInstance => {
    const monster = monsters.byKey.get(s.monsterKey);
    return {
      id: s.id,
      name: s.displayName,
      monsterKey: s.monsterKey,
      ac: monster?.ac ?? 0,
      maxHp: s.maxHp,
      hpMode: hpModes[i] ?? "rolled",
      initiative: s.initiative ?? 0,
      groupId: s.groupId ?? "",
    };
  });
  return { instances, rolls };
}
