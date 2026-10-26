import type { RollLogEntry } from "../dice/log.js";
import type { Rng } from "../dice/rng.js";
import type { Point } from "../map/types.js";
import { footprintForSize } from "../monsters/footprint.js";
import type { Monster } from "../monsters/schema.js";
import type { MonsterIndex } from "../monsters/types.js";
import { rollInitiativeValues } from "./initiative.js";
import { rollMaxHp } from "./max-hp.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type { NewMonsterInstance } from "./types.js";
import {
  findJoinTargets,
  validateAddMonsters,
  type JoinTarget,
} from "./validate-add-monsters.js";

export const MAX_GROUP_COUNT = 50;

export type HpMode = "rolled" | "average";
export type InitiativeMode = "group" | "each";

export interface AddMonstersGroup {
  /** Monster key, e.g. `srd-2024_shadow`. */
  monster: string;
  count: number;
  /** Defaults to `rolled`. */
  hp?: HpMode;
  /** Reveal the group's stats to players; defaults to false (GM-only), or with `join` to the member's value. */
  statsVisible?: boolean;
  /** Spawn positions (scene units) for the group's instances, in order; instances past the last get none. */
  spawnPositions?: readonly Point[];
  /**
   * An instance of the active encounter, by id, else by exact display name:
   * the group's monsters join its initiative group and take its current
   * initiative (null included) instead of rolling. Absent: a new group.
   */
  join?: string;
}

export interface AddMonstersOptions {
  /** Max instances per group; positive integer. Defaults to `MAX_GROUP_COUNT`. */
  maxGroupCount?: number;
  /** `group` (default): one initiative roll per group; `each`: one per instance. A group with `join` rolls none. */
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
  /** Null only for a monster that joined a member with no initiative. */
  initiative: number | null;
  groupId: string;
}

export interface AddMonstersResult {
  instances: AddedInstance[];
  rolls: RollLogEntry[];
}

export {
  AddMonstersError,
  type AddMonstersErrorCode,
} from "./validate-add-monsters.js";

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

/**
 * Adds groups of monsters to the active encounter: rolls (or averages) HP and
 * initiative, assigns numbered names, and persists everything in one
 * transaction. A group with `join` takes its member's initiative group and
 * current initiative instead, and rolls no initiative. All input, and every
 * `join`, is checked before any roll or store write.
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

  validateAddMonsters(
    monsters,
    groups,
    options.maxGroupCount ?? MAX_GROUP_COUNT,
    initiativeMode,
  );
  const joins = findJoinTargets(repo, groups);

  const rolls: RollLogEntry[] = [];
  const hpModes: HpMode[] = [];
  const acs: number[] = [];

  const items: NewMonsterInstance[] = [];
  const saved = repo.addInstances((names) => {
    const planned = planAddMonsters(monsters, groups, joins, names, naming);
    for (const { monster, join, instances } of planned) {
      const groupId = join?.groupId ?? newGroupId();
      const groupStart = items.length;

      for (const instance of instances) {
        const hpRoll = rollMaxHp(
          { rng, now },
          monster.hp,
          instance.hpMode,
          instance.displayName,
        );
        if (hpRoll.roll !== null) rolls.push(hpRoll.roll);
        items.push({
          monsterKey: monster.key,
          displayName: instance.displayName,
          maxHp: hpRoll.maxHp,
          armorClass: monster.ac,
          groupId,
          footprint: instance.footprint,
          statsVisible: instance.statsVisible,
          spawnPosition: instance.spawnPosition,
        });
        hpModes.push(instance.hpMode);
        acs.push(monster.ac);
      }

      const groupItems = items.slice(groupStart);
      if (join === undefined) {
        const initiative = rollInitiativeValues(
          { monsters, rng, now },
          groupItems,
          initiativeMode,
        );
        rolls.push(...initiative.rolls);
        initiative.outcomes.forEach((outcome, k) => {
          const item = items[groupStart + k];
          if (item) item.initiative = outcome.initiative;
        });
      } else {
        for (const item of groupItems) item.initiative = join.initiative;
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
      item === undefined ||
      item.initiative === undefined ||
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

export interface PreviewMonstersDeps {
  repo: Pick<EncounterRepository, "listInstances">;
  monsters: MonsterIndex;
  naming?: NamingStrategy;
}

/** One would-be monster of a preview. */
export interface PreviewInstance {
  name: string;
  /** Index of its group in the input. */
  group: number;
  ac: number;
  averageHp: number;
  hpDice: string;
  initiativeModifier: number;
  /** The member a group with `join` joins; null for a new group, which would roll. */
  joins: { name: string; initiative: number | null } | null;
  /** Grid cells per side. */
  footprint: number;
}

export interface MonstersPreview {
  instances: PreviewInstance[];
}

/** Dry run of addMonsters: same checks, joins and names; reads the store, writes nothing, rolls nothing. */
export function previewMonsters(
  deps: PreviewMonstersDeps,
  groups: readonly AddMonstersGroup[],
  options: AddMonstersOptions = {},
): MonstersPreview {
  const { repo, monsters } = deps;
  validateAddMonsters(
    monsters,
    groups,
    options.maxGroupCount ?? MAX_GROUP_COUNT,
    options.initiative ?? "group",
  );
  const joins = findJoinTargets(repo, groups);
  const names = repo.listInstances().map((instance) => instance.displayName);
  const planned = planAddMonsters(
    monsters,
    groups,
    joins,
    names,
    deps.naming ?? createNumberedNaming(),
  );
  const instances = planned.flatMap(({ group, monster, join, instances }) =>
    instances.map((instance): PreviewInstance => ({
      name: instance.displayName,
      group,
      ac: monster.ac,
      averageHp: monster.hp.average,
      hpDice: monster.hp.dice,
      initiativeModifier: monster.initiativeModifier,
      joins:
        join === undefined
          ? null
          : { name: join.name, initiative: join.initiative },
      footprint: instance.footprint,
    })),
  );
  return { instances };
}

/** A group of an add, before anything is rolled. */
interface PlannedGroup {
  /** Index of the group in the input. */
  group: number;
  monster: Monster;
  join: JoinTarget | undefined;
  instances: PlannedInstance[];
}

/** One would-be instance of a planned group, before anything is rolled. */
interface PlannedInstance {
  displayName: string;
  hpMode: HpMode;
  footprint: number;
  statsVisible: boolean;
  spawnPosition: Point | null;
}

/**
 * The roll-free part of an add, per group in input order: its monster, the
 * member it joins and each instance's name, HP mode, footprint, stats
 * visibility and spawn position. Names each instance against `names` and
 * pushes each new name onto it.
 */
function planAddMonsters(
  monsters: MonsterIndex,
  groups: readonly AddMonstersGroup[],
  joins: readonly (JoinTarget | undefined)[],
  names: string[],
  naming: NamingStrategy,
): PlannedGroup[] {
  const planned: PlannedGroup[] = [];
  for (const [g, group] of groups.entries()) {
    const monster = monsters.byKey.get(group.monster);
    /* v8 ignore next -- validated before planning */
    if (monster === undefined) continue;
    const join = joins[g];
    const hpMode = group.hp ?? "rolled";
    const instances: PlannedInstance[] = [];
    for (let n = 0; n < group.count; n++) {
      const displayName = naming({ monster, existingNames: names });
      names.push(displayName);
      instances.push({
        displayName,
        hpMode,
        footprint: footprintForSize(monster.size),
        statsVisible: group.statsVisible ?? join?.statsVisible ?? false,
        spawnPosition: group.spawnPositions?.[n] ?? null,
      });
    }
    planned.push({ group: g, monster, join, instances });
  }
  return planned;
}
