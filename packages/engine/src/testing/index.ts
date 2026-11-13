import type { MonsterInstance } from "../encounter/types.js";
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
