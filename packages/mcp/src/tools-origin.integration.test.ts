import type {
  ChangeOrigin,
  EncounterRepository,
  NewMonsterInstance,
  Rng,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  SqliteMapRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

const SHADOW = "srd-2024_shadow";
const seedOrigin: ChangeOrigin = { source: "table", commandId: "seed" };

const rng: Rng = { nextInt: (max) => 3 % max };

interface Write {
  method: string;
  origin: ChangeOrigin;
}

/** Delegates to `inner` and records the origin of every mutation. */
function recordingRepo(
  inner: EncounterRepository,
  writes: Write[],
): EncounterRepository {
  const record = (method: string, origin: ChangeOrigin): void => {
    writes.push({ method, origin });
  };
  return {
    getOrCreateActiveEncounter: () => inner.getOrCreateActiveEncounter(),
    listInstances: () => inner.listInstances(),
    addInstances: (build, origin) => (
      record("addInstances", origin),
      inner.addInstances(build, origin)
    ),
    applyDamage: (id, amount, origin) => (
      record("applyDamage", origin),
      inner.applyDamage(id, amount, origin)
    ),
    applyHealing: (id, amount, origin) => (
      record("applyHealing", origin),
      inner.applyHealing(id, amount, origin)
    ),
    removeInstances: (ids, origin) => (
      record("removeInstances", origin),
      inner.removeInstances(ids, origin)
    ),
    renameInstance: (id, name, origin) => (
      record("renameInstance", origin),
      inner.renameInstance(id, name, origin)
    ),
    setInitiative: (id, initiative, origin) => (
      record("setInitiative", origin),
      inner.setInitiative(id, initiative, origin)
    ),
    setHp: (id, hp, origin) => (
      record("setHp", origin),
      inner.setHp(id, hp, origin)
    ),
    setMaxHp: (id, maxHp, origin) => (
      record("setMaxHp", origin),
      inner.setMaxHp(id, maxHp, origin)
    ),
    setArmorClass: (id, armorClass, origin) => (
      record("setArmorClass", origin),
      inner.setArmorClass(id, armorClass, origin)
    ),
    setStatsVisible: (id, visible, origin) => (
      record("setStatsVisible", origin),
      inner.setStatsVisible(id, visible, origin)
    ),
    clearEncounter: (origin) => {
      record("clearEncounter", origin);
      inner.clearEncounter(origin);
    },
  };
}

let ctx: ToolContext;
let writes: Write[];
let issuedCommandIds: string[];

beforeEach(() => {
  writes = [];
  issuedCommandIds = [];
  const inner = new SqliteEncounterRepository(openDatabase(":memory:"));
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("table not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: recordingRepo(inner, writes),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters: loadSrdMonsters(),
    rng,
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group-1",
    newCommandId: () => {
      const id = `command-${String(issuedCommandIds.length + 1)}`;
      issuedCommandIds.push(id);
      return id;
    },
  };
});

async function call(name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(ctx, args);
}

/** Seeds through the repository, then forgets the recorded seed write. */
function seed(...names: string[]): void {
  const items: NewMonsterInstance[] = names.map((displayName) => ({
    monsterKey: SHADOW,
    displayName,
    maxHp: 20,
    initiative: 10,
  }));
  ctx.repo.addInstances(() => items, seedOrigin);
  writes.length = 0;
}

describe("tool write origin", () => {
  it("add_monsters passes source mcp and a fresh commandId to the repository", async () => {
    const result = await call("add_monsters", {
      groups: [{ monster: SHADOW, count: 2 }],
    });

    expect(result.isError).toBeUndefined();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      method: "addInstances",
      origin: { source: "mcp", commandId: issuedCommandIds[0] },
    });
    expect(issuedCommandIds).toHaveLength(1);
  });

  it("apply_damage, heal, remove_monsters, rename_monster, set_initiative, set_stats_visibility and clear_encounter each pass source mcp to the repository", async () => {
    seed("Shadow 1", "Shadow 2");

    const calls: [string, unknown, string][] = [
      ["apply_damage", { target: "Shadow 1", amount: 3 }, "applyDamage"],
      ["heal", { target: "Shadow 1", amount: 1 }, "applyHealing"],
      [
        "rename_monster",
        { target: "Shadow 1", name: "Boss" },
        "renameInstance",
      ],
      ["set_initiative", { target: "Boss", initiative: 15 }, "setInitiative"],
      [
        "set_stats_visibility",
        { targets: ["Boss"], visible: true },
        "setStatsVisible",
      ],
      ["remove_monsters", { targets: ["Boss"] }, "removeInstances"],
      ["clear_encounter", {}, "clearEncounter"],
    ];
    for (const [name, args, method] of calls) {
      writes.length = 0;
      const result = await call(name, args);

      expect(result.isError, name).toBeUndefined();
      expect(
        writes.map((w) => w.method),
        name,
      ).toEqual([method]);
      expect(writes[0]?.origin.source, name).toBe("mcp");
      expect(writes[0]?.origin.commandId, name).toMatch(/^command-/);
    }
  });

  it("two tool calls get different command ids", async () => {
    seed("Shadow 1");

    await call("apply_damage", { target: "Shadow 1", amount: 1 });
    await call("apply_damage", { target: "Shadow 1", amount: 1 });

    expect(writes).toHaveLength(2);
    expect(writes[0]?.origin.source).toBe("mcp");
    expect(writes[0]?.origin.commandId).not.toBe(writes[1]?.origin.commandId);
  });

  it("the writes within one tool call share one command id", async () => {
    seed("Shadow 1", "Shadow 2", "Shadow 3");

    const result = await call("set_stats_visibility", {
      targets: ["Shadow 1", "Shadow 2", "Shadow 3"],
      visible: true,
    });

    expect(result.isError).toBeUndefined();
    expect(writes).toHaveLength(3);
    expect(writes[0]?.origin.source).toBe("mcp");
    expect(new Set(writes.map((w) => w.origin.commandId)).size).toBe(1);
  });

  it("roll_initiative passes source mcp and one command id to every setInitiative write", async () => {
    seed("Shadow 1", "Shadow 2", "Shadow 3");

    const result = await call("roll_initiative", {
      targets: ["Shadow 1", "Shadow 2", "Shadow 3"],
      mode: "each",
    });

    expect(result.isError).toBeUndefined();
    expect(writes.map((w) => w.method)).toEqual([
      "setInitiative",
      "setInitiative",
      "setInitiative",
    ]);
    expect(issuedCommandIds).toHaveLength(1);
    for (const write of writes) {
      expect(write.origin).toEqual({
        source: "mcp",
        commandId: issuedCommandIds[0],
      });
    }
  });
});
