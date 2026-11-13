import {
  type ChangeOrigin,
  type MonsterInstance,
  type NewMonsterInstance,
  type Rng,
  resolveEncounter,
  type EncounterRepository,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterDirectory,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";
import { makeTestSetupPorts } from "@ttrpg-agents/engine/testing";

const origin: ChangeOrigin = { source: "mcp", commandId: "seed" };

const WOLF = "srd-2024_wolf";
const GOBLIN = "srd-2024_goblin-warrior";

const rng: Rng = { nextInt: (max) => 3 % max };

let ctx: ToolContext;
let tick: number;

beforeEach(() => {
  tick = 1000;
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("table not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    encounters: new SqliteEncounterDirectory(openDatabase(":memory:"), {
      now: () => tick++,
    }),
    monsters: loadSrdMonsters(),
    rng,
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group-1",
    browser: { showPage: () => Promise.reject(new Error("not stubbed")) },
    setup: makeTestSetupPorts(),
    newCommandId: () => "command",
  };
});

async function call(name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(ctx, args);
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function seed(...items: NewMonsterInstance[]): MonsterInstance[] {
  return repoOf(ctx).addInstances(() => items, origin);
}

function byName(name: string): MonsterInstance {
  const found = repoOf(ctx)
    .listInstances()
    .find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found;
}

function wolf(displayName: string, initiative: number): NewMonsterInstance {
  return { monsterKey: WOLF, displayName, maxHp: 11, initiative };
}

function goblin(displayName: string, initiative: number): NewMonsterInstance {
  return { monsterKey: GOBLIN, displayName, maxHp: 7, initiative };
}

async function remove(...targets: string[]): Promise<void> {
  const r = await call("remove_monsters", { targets });
  expect(r.isError).toBeUndefined();
}

/** The current encounter's repository (created when there is none), resolved as a tool call does. */
function repoOf(context: ToolContext): EncounterRepository {
  return context.encounters.repositoryFor(
    resolveEncounter(context.encounters).id,
  );
}

describe("restore_monsters", () => {
  it("restore_monsters brings back removed monsters and replies with each one's name and HP, and its old name when renamed", async () => {
    seed(
      wolf("Wolf 1", 12),
      wolf("Wolf 2", 9),
      goblin("Goblin Warrior 1", 15),
      goblin("Goblin Warrior 2", 14),
    );
    const wolf2 = byName("Wolf 2");
    const goblin1 = byName("Goblin Warrior 1");
    repoOf(ctx).applyDamage(wolf2.id, 6, origin);
    await remove("Wolf 2", "Goblin Warrior 1");
    seed(goblin("Goblin Warrior 1", 3), goblin("Goblin Warrior 3", 3));

    const r = await call("restore_monsters", {
      targets: ["Wolf 2", goblin1.id],
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      "Restored 2: Wolf 2 (5/11 HP), Goblin Warrior 4 (7/7 HP, was Goblin Warrior 1)",
    );
    expect(r.structuredContent).toEqual({
      summary: text(r),
      restored: [
        {
          id: wolf2.id,
          name: "Wolf 2",
          monsterKey: WOLF,
          hp: 5,
          maxHp: 11,
          initiative: 9,
          armorClass: null,
          renamedFrom: null,
        },
        {
          id: goblin1.id,
          name: "Goblin Warrior 4",
          monsterKey: GOBLIN,
          hp: 7,
          maxHp: 7,
          initiative: 15,
          armorClass: null,
          renamedFrom: "Goblin Warrior 1",
        },
      ],
    });
    expect(repoOf(ctx).listRemovedInstances()).toEqual([]);
    expect(byName("Wolf 2").id).toBe(wolf2.id);
    expect(byName("Goblin Warrior 4").id).toBe(goblin1.id);
  });

  it("restore_monsters with a target that is not removed fails, says nothing was restored and restores nothing", async () => {
    seed(wolf("Wolf 1", 12), wolf("Wolf 2", 9));
    await remove("Wolf 2");
    const live = repoOf(ctx).listInstances();
    const removed = repoOf(ctx).listRemovedInstances();

    for (const targets of [
      ["Wolf 2", "Wolf 1"],
      ["Wolf 2", "Ghost"],
    ]) {
      const r = await call("restore_monsters", { targets });

      expect(r.isError, targets.join()).toBe(true);
      expect(text(r), targets.join()).toMatch(/Nothing was restored\.$/);
    }
    expect(repoOf(ctx).listInstances()).toEqual(live);
    expect(repoOf(ctx).listRemovedInstances()).toEqual(removed);
    expect(removed).toHaveLength(1);
  });
});

describe("list_encounter with removed monsters", () => {
  it("list_encounter names the removed monsters that can be restored, newest removal first", async () => {
    seed(wolf("Wolf 1", 12), wolf("Wolf 2", 9), goblin("Goblin Warrior 1", 15));
    await remove("Wolf 2");
    await remove("Goblin Warrior 1");
    const goblin1 = repoOf(ctx)
      .listRemovedInstances()
      .find((r) => r.instance.displayName === "Goblin Warrior 1")?.instance;
    const wolf2 = repoOf(ctx)
      .listRemovedInstances()
      .find((r) => r.instance.displayName === "Wolf 2")?.instance;

    const r = await call("list_encounter");

    expect(r.isError).toBeUndefined();
    const lines = text(r).split("\n");
    expect(lines.slice(-2)).toEqual([
      "",
      "Removed, can be restored: Goblin Warrior 1, Wolf 2.",
    ]);
    expect(text(r)).toContain("Wolf 1");
    expect(r.structuredContent?.["removed"]).toEqual([
      {
        id: goblin1?.id,
        name: "Goblin Warrior 1",
        monsterKey: GOBLIN,
        hp: 7,
        maxHp: 7,
        initiative: 15,
        armorClass: null,
      },
      {
        id: wolf2?.id,
        name: "Wolf 2",
        monsterKey: WOLF,
        hp: 11,
        maxHp: 11,
        initiative: 9,
        armorClass: null,
      },
    ]);
    expect(
      (r.structuredContent?.["instances"] as { name: string }[]).map(
        (i) => i.name,
      ),
    ).toEqual(["Wolf 1"]);
  });

  it("list_encounter of an empty encounter with removed monsters says it is empty and names them", async () => {
    seed(wolf("Wolf 1", 12));
    await remove("Wolf 1");

    const r = await call("list_encounter");

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      "The encounter is empty.\n\nRemoved, can be restored: Wolf 1.",
    );
    expect(r.structuredContent?.["instances"]).toEqual([]);
    expect(
      (r.structuredContent?.["removed"] as { name: string }[]).map(
        (i) => i.name,
      ),
    ).toEqual(["Wolf 1"]);
  });

  it("list_encounter leaves out the removed line when nothing can be restored", async () => {
    expect(text(await call("list_encounter"))).toBe("The encounter is empty.");

    seed(wolf("Wolf 1", 12), wolf("Wolf 2", 9));
    expect(text(await call("list_encounter"))).not.toContain("Removed");

    await remove("Wolf 2");
    expect(text(await call("list_encounter"))).toContain(
      "Removed, can be restored: Wolf 2.",
    );

    const restore = await call("restore_monsters", { targets: ["Wolf 2"] });
    expect(restore.isError).toBeUndefined();
    expect(text(await call("list_encounter"))).not.toContain("Removed");
  });
});
