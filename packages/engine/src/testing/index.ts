import type { MonsterInstance } from "../encounter/types.js";
import type {
  CreatureRecord,
  CreatureRepository,
} from "../monsters/creatures.js";
import type { Monster } from "../monsters/schema.js";
import {
  staticMonsterIndex,
  type MonsterIndex,
  type MonsterSet,
} from "../monsters/types.js";
import type {
  BackupFacts,
  BridgeFacts,
  DatabaseFacts,
  SettingsFacts,
  SetupPorts,
} from "../setup/port.js";

/**
 * Test data only. The store generates real instances, so production code must
 * never import this module; the lint config enforces that.
 */
const DEFAULTS: MonsterInstance = {
  id: "i1",
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: "Shadow 1",
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: 1,
  footprint: 1,
  statsVisible: false,
  spawnPosition: null,
};

/**
 * A full `MonsterInstance` for tests: the defaults, with `overrides` replacing
 * any of them. Each call returns a new object.
 */
export function makeTestInstance(
  overrides: Partial<MonsterInstance> = {},
): MonsterInstance {
  return { ...DEFAULTS, ...overrides };
}

/**
 * Ports for a ready setup (default profile, no config file, no problems, no
 * settings, database at version 15 of 15, a backup taken at 09:00 UTC on
 * 2026-11-12, bridge on 5199 with a connected tab in room "test-room", now
 * 10:00 UTC on 2026-11-12), with `overrides` replacing parts of each fact and
 * `now`; each call returns new objects.
 */
export function makeTestSetupPorts(
  overrides: {
    settings?: Partial<SettingsFacts>;
    database?: Partial<DatabaseFacts>;
    backups?: Partial<BackupFacts>;
    bridge?: Partial<BridgeFacts>;
    now?: Date;
  } = {},
): SetupPorts {
  const settings: SettingsFacts = {
    profile: "default (not a linked git worktree)",
    configFile: {
      path: "/home/test/.config/ttrpg-agents/config.json",
      found: false,
    },
    problems: [],
    settings: [],
    ...overrides.settings,
  };
  const database: DatabaseFacts = {
    path: "/home/test/.local/share/ttrpg-agents/encounters.db",
    expectedVersion: 15,
    file: { kind: "found", version: 15 },
    ...overrides.database,
  };
  const backups: BackupFacts = {
    dir: "/home/test/.local/share/ttrpg-agents/backups",
    newest: {
      kind: "found",
      path: "/home/test/.local/share/ttrpg-agents/backups/encounters-20261112T090000Z.db",
      takenAt: "2026-11-12T09:00:00.000Z",
    },
    ...overrides.backups,
  };
  const now = overrides.now ?? new Date("2026-11-12T10:00:00.000Z");
  const bridge: BridgeFacts = {
    port: 5199,
    tokenFile: "/home/test/.config/ttrpg-agents/agent-token",
    answer: { kind: "gm-tab-connected", roomId: "test-room" },
    ...overrides.bridge,
  };
  return {
    settings,
    database: { check: () => database, checkBackups: () => backups },
    bridge: { check: () => Promise.resolve(bridge) },
    now: () => new Date(now.getTime()),
  };
}

/** A MonsterIndex over `monsters` (in order) with the given aliases (old name -> key) and D&D Beyond pages (key -> segment). */
export function makeTestMonsterIndex(
  monsters: readonly Monster[],
  extras?: {
    aliases?: Record<string, string>;
    dndBeyondPages?: Record<string, string>;
  },
): MonsterIndex {
  const set: MonsterSet = {
    monsters: [...monsters],
    byKey: new Map(monsters.map((m) => [m.key, m])),
    aliases: new Map(Object.entries(extras?.aliases ?? {})),
    dndBeyondPages: new Map(Object.entries(extras?.dndBeyondPages ?? {})),
  };
  return staticMonsterIndex(set);
}

/**
 * A full invented statblock (homebrew_mossling, "Mossling") that passes
 * monsterSchema and has no check findings, with `overrides` replacing any
 * field. Each call returns a new object.
 */
export function makeTestMonster(overrides: Partial<Monster> = {}): Monster {
  return {
    key: "homebrew_mossling",
    name: "Mossling",
    source: { book: "homebrew" },
    size: "medium",
    type: "beast",
    alignment: "unaligned",
    ac: 10,
    armorDetail: "",
    hp: { average: 5, dice: "1d8 + 1" },
    speeds: { walk: 30 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    initiativeModifier: 0,
    cr: 0,
    saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: {},
    senses: {},
    languages: "",
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    sections: {
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
    },
    ...overrides,
  };
}

/** An in-memory CreatureRepository; `put` stores any data, as a store holding a record that fails the schema would. */
export interface TestCreatureRepository extends CreatureRepository {
  put(key: string, data: unknown): void;
}

/** A deep copy of JSON data, as a store that serialises its records returns it. */
function copy(data: unknown): unknown {
  return data === undefined ? undefined : JSON.parse(JSON.stringify(data));
}

/** An in-memory CreatureRepository seeded with each creature under its own key. Records are copied in and out. */
export function makeTestCreatureRepository(
  creatures: readonly Monster[] = [],
): TestCreatureRepository {
  const records = new Map<string, unknown>();
  const record = (key: string): CreatureRecord => ({
    key,
    data: copy(records.get(key)),
  });
  const repo: TestCreatureRepository = {
    put: (key, data) => {
      records.set(key, copy(data));
    },
    getRecord: (key) => (records.has(key) ? record(key) : undefined),
    listRecords: () => [...records.keys()].sort().map(record),
    insert: (key, monster) => {
      if (records.has(key)) throw new Error(`duplicate key ${key}`);
      repo.put(key, monster);
    },
    replace: (key, monster) => {
      if (!records.has(key)) throw new Error(`no record ${key}`);
      repo.put(key, monster);
    },
    delete: (key) => {
      records.delete(key);
    },
  };
  for (const creature of creatures) repo.insert(creature.key, creature);
  return repo;
}
