import type {
  ChangeOrigin,
  MonsterInstance,
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
    repo: new SqliteEncounterRepository(openDatabase(":memory:"), {
      now: () => tick++,
    }),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters: loadSrdMonsters(),
    rng,
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group-1",
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
  return ctx.repo.addInstances(() => items, origin);
}

function wolf(displayName: string, initiative: number): NewMonsterInstance {
  return { monsterKey: WOLF, displayName, maxHp: 11, initiative };
}

function goblin(displayName: string, initiative: number): NewMonsterInstance {
  return { monsterKey: GOBLIN, displayName, maxHp: 7, initiative };
}

function names(items: unknown): string[] {
  return (items as { name: string }[]).map((i) => i.name);
}

function liveNames(): string[] {
  return ctx.repo.listInstances().map((i) => i.displayName);
}

function restorable(): [string, boolean][] {
  return ctx.repo
    .listRemovedInstances()
    .map((r) => [r.instance.displayName, r.cleared]);
}

async function clear(): Promise<ToolResult> {
  const r = await call("clear_encounter");
  expect(r.isError).toBeUndefined();
  return r;
}

describe("clear_encounter", () => {
  it("clear_encounter replies with the cleared monsters' names and says restore_encounter can bring them back", async () => {
    const [wolf1, goblin1] = seed(
      wolf("Wolf 1", 12),
      goblin("Goblin Warrior 1", 15),
    );

    const r = await clear();

    expect(text(r)).toBe(
      "Cleared 2 monsters: Wolf 1, Goblin Warrior 1. They can be restored with restore_encounter.",
    );
    expect(r.structuredContent?.["removed"]).toBe(2);
    expect(r.structuredContent?.["cleared"]).toMatchObject([
      { id: wolf1!.id, name: "Wolf 1", monsterKey: WOLF, hp: 11, maxHp: 11 },
      {
        id: goblin1!.id,
        name: "Goblin Warrior 1",
        monsterKey: GOBLIN,
        hp: 7,
        maxHp: 7,
      },
    ]);

    seed(wolf("Wolf 3", 4));
    const single = await clear();

    expect(text(single)).toBe(
      "Cleared 1 monster: Wolf 3. It can be restored with restore_encounter.",
    );
    expect(single.structuredContent?.["removed"]).toBe(1);
    expect(names(single.structuredContent?.["cleared"])).toEqual(["Wolf 3"]);
  });

  it("clear_encounter of an empty encounter says it is already empty and keeps what can be restored", async () => {
    const neverFilled = await clear();
    expect(text(neverFilled)).toBe(
      "The encounter is already empty; nothing was cleared.",
    );

    seed(wolf("Wolf 1", 12), wolf("Wolf 2", 9));
    await clear();

    const r = await clear();

    expect(text(r)).toBe(
      "The encounter is already empty; nothing was cleared.",
    );
    expect(r.structuredContent).toEqual({
      summary: "The encounter is already empty; nothing was cleared.",
      removed: 0,
      cleared: [],
    });
    expect(restorable()).toEqual([
      ["Wolf 1", true],
      ["Wolf 2", true],
    ]);
  });
});

describe("restore_encounter", () => {
  it("restore_encounter brings back the cleared monsters and replies with each one's name and HP, and its old name when renamed", async () => {
    const [wolf1, wolf2, goblin1] = seed(
      wolf("Wolf 1", 12),
      wolf("Wolf 2", 9),
      goblin("Goblin Warrior 1", 15),
    );
    ctx.repo.applyDamage(wolf2!.id, 6, origin);
    await clear();
    const [addedGoblin] = seed(goblin("Goblin Warrior 1", 3));

    const r = await call("restore_encounter");

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      "Restored 3: Wolf 1 (11/11 HP), Wolf 2 (5/11 HP), Goblin Warrior 2 (7/7 HP, was Goblin Warrior 1)",
    );
    expect(r.structuredContent?.["restored"]).toMatchObject([
      {
        id: wolf1!.id,
        name: "Wolf 1",
        monsterKey: WOLF,
        hp: 11,
        maxHp: 11,
        initiative: 12,
        renamedFrom: null,
      },
      {
        id: wolf2!.id,
        name: "Wolf 2",
        monsterKey: WOLF,
        hp: 5,
        maxHp: 11,
        initiative: 9,
        renamedFrom: null,
      },
      {
        id: goblin1!.id,
        name: "Goblin Warrior 2",
        monsterKey: GOBLIN,
        hp: 7,
        maxHp: 7,
        initiative: 15,
        renamedFrom: "Goblin Warrior 1",
      },
    ]);
    expect(ctx.repo.listInstances().map((i) => i.id)).toEqual([
      wolf1!.id,
      wolf2!.id,
      goblin1!.id,
      addedGoblin!.id,
    ]);
    expect(ctx.repo.listRemovedInstances()).toEqual([]);
  });

  it("restore_encounter with nothing cleared fails and restores nothing", async () => {
    seed(wolf("Wolf 1", 12), wolf("Wolf 2", 9));
    const removed = await call("remove_monsters", { targets: ["Wolf 2"] });
    expect(removed.isError).toBeUndefined();
    const live = ctx.repo.listInstances();
    const removedBefore = ctx.repo.listRemovedInstances();

    const r = await call("restore_encounter");

    expect(r.isError).toBe(true);
    expect(text(r)).toContain("No cleared monsters to restore");
    expect(ctx.repo.listInstances()).toEqual(live);
    expect(ctx.repo.listRemovedInstances()).toEqual(removedBefore);
  });

  it("restore_monsters brings back one monster of the cleared encounter by name", async () => {
    seed(wolf("Wolf 1", 12), wolf("Wolf 2", 9));
    await clear();

    const r = await call("restore_monsters", { targets: ["Wolf 2"] });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe("Restored 1: Wolf 2 (11/11 HP)");
    expect(liveNames()).toEqual(["Wolf 2"]);
    expect(restorable()).toEqual([["Wolf 1", true]]);
  });
});

describe("list_encounter after a clear", () => {
  it("list_encounter after a clear names the cleared monsters when there are at most five and says restore_encounter brings them back", async () => {
    seed(
      wolf("Wolf 1", 12),
      wolf("Wolf 2", 9),
      wolf("Wolf 3", 8),
      goblin("Goblin Warrior 1", 15),
      goblin("Goblin Warrior 2", 14),
    );
    await clear();

    const r = await call("list_encounter");

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      "The encounter is empty.\n\nCleared encounter, can be restored with restore_encounter: Wolf 1, Wolf 2, Wolf 3, Goblin Warrior 1, Goblin Warrior 2.",
    );
    expect(r.structuredContent?.["removed"]).toEqual([]);
    expect(names(r.structuredContent?.["cleared"])).toEqual([
      "Wolf 1",
      "Wolf 2",
      "Wolf 3",
      "Goblin Warrior 1",
      "Goblin Warrior 2",
    ]);
  });

  it("list_encounter after a clear of more than five monsters says how many restore_encounter can bring back, without naming them", async () => {
    seed(
      wolf("Wolf 1", 12),
      wolf("Wolf 2", 9),
      wolf("Wolf 3", 8),
      goblin("Goblin Warrior 1", 15),
      goblin("Goblin Warrior 2", 14),
      goblin("Goblin Warrior 3", 13),
    );
    await clear();

    const r = await call("list_encounter");

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      "The encounter is empty.\n\nCleared encounter: 6 monsters, can be restored with restore_encounter.",
    );
    expect(r.structuredContent?.["removed"]).toEqual([]);
    expect(names(r.structuredContent?.["cleared"])).toHaveLength(6);
  });

  it("list_encounter after a clear names the monsters removed since before the cleared count", async () => {
    seed(wolf("Wolf 1", 12), wolf("Wolf 2", 9));
    await clear();
    seed(goblin("Goblin Warrior 1", 15), goblin("Goblin Warrior 2", 14));
    const removed = await call("remove_monsters", {
      targets: ["Goblin Warrior 1"],
    });
    expect(removed.isError).toBeUndefined();

    const r = await call("list_encounter");

    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("Goblin Warrior 2");
    expect(text(r).split("\n").slice(-3)).toEqual([
      "Removed, can be restored: Goblin Warrior 1.",
      "",
      "Cleared encounter, can be restored with restore_encounter: Wolf 1, Wolf 2.",
    ]);
    expect(names(r.structuredContent?.["instances"])).toEqual([
      "Goblin Warrior 2",
    ]);
    expect(names(r.structuredContent?.["removed"])).toEqual([
      "Goblin Warrior 1",
    ]);
    expect(names(r.structuredContent?.["cleared"])).toEqual([
      "Wolf 1",
      "Wolf 2",
    ]);
  });
});
