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

const origin: ChangeOrigin = { source: "table", commandId: "seed" };

const WOLF = "srd-2024_wolf";
const GOBLIN = "srd-2024_goblin-warrior";
const monsters = loadSrdMonsters();
const wolf = monsters.byKey.get(WOLF);
if (!wolf || !monsters.byKey.has(GOBLIN)) {
  throw new Error("SRD fixtures missing");
}

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max. */
function cycleRng(...values: number[]): Rng {
  let i = 0;
  return {
    nextInt(max) {
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
}

function signed(n: number): string {
  return n >= 0 ? `+${String(n)}` : String(n);
}

let ctx: ToolContext;

beforeEach(() => {
  let groups = 0;
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters,
    rng: cycleRng(6, 12),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${String(++groups)}`,
    newCommandId: () => "command",
  };
});

async function call(name: string, args: unknown): Promise<ToolResult> {
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

function item(
  monsterKey: string,
  displayName: string,
  initiative: number | null,
  groupId: string | null,
): NewMonsterInstance {
  return { monsterKey, displayName, maxHp: 11, initiative, groupId };
}

function view(i: MonsterInstance): Record<string, unknown> {
  return {
    id: i.id,
    name: i.displayName,
    monsterKey: i.monsterKey,
    hp: i.currentHp,
    maxHp: i.maxHp,
    initiative: i.initiative,
    armorClass: i.armorClass,
  };
}

function find(name: string): MonsterInstance {
  const found = ctx.repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found;
}

describe("split_initiative", () => {
  it("split_initiative by id and by exact name gives each monster its own group, keeps its initiative and reports one line per monster", async () => {
    const [wolf1] = seed(
      item(WOLF, "Wolf 1", 14, "pack"),
      item(WOLF, "Wolf 2", null, "pack"),
      item(WOLF, "Wolf 3", 14, "pack"),
    );
    if (!wolf1) throw new Error("seed failed");

    const r = await call("split_initiative", {
      targets: [wolf1.id, "Wolf 2"],
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "Wolf 1: own initiative group, initiative 14",
        "Wolf 2: own initiative group, initiative unset",
      ].join("\n"),
    );
    const after1 = find("Wolf 1");
    const after2 = find("Wolf 2");
    expect([after1, after2, find("Wolf 3")].map((i) => i.groupId)).toEqual([
      "group-1",
      "group-2",
      "pack",
    ]);
    expect(ctx.repo.listInstances().map((i) => i.initiative)).toEqual([
      14,
      null,
      14,
    ]);
    expect(r.structuredContent).toEqual({
      summary: text(r),
      instances: [
        { ...view(after1), before: 14 },
        { ...view(after2), before: null },
      ],
      rolls: [],
    });
  });

  it("split_initiative with roll true reports roll, modifier, before and after for each monster", async () => {
    seed(item(WOLF, "Wolf 1", 14, "pack"), item(WOLF, "Wolf 2", null, "pack"));
    const mod = wolf.initiativeModifier;

    const r = await call("split_initiative", {
      targets: ["Wolf 1", "Wolf 2"],
      roll: true,
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        `Wolf 1: own initiative group, initiative 14 -> ${String(7 + mod)} (d20 7, modifier ${signed(mod)})`,
        `Wolf 2: own initiative group, initiative unset -> ${String(13 + mod)} (d20 13, modifier ${signed(mod)})`,
      ].join("\n"),
    );
    const after1 = find("Wolf 1");
    const after2 = find("Wolf 2");
    expect([after1, after2].map((i) => [i.initiative, i.groupId])).toEqual([
      [7 + mod, "group-1"],
      [13 + mod, "group-2"],
    ]);
    const structured = r.structuredContent;
    expect(structured?.["instances"]).toEqual([
      { ...view(after1), before: 14, roll: 7, modifier: mod },
      { ...view(after2), before: null, roll: 13, modifier: mod },
    ]);
    expect(structured?.["rolls"]).toEqual([
      expect.objectContaining({ expression: "1d20", total: 7 }),
      expect.objectContaining({ expression: "1d20", total: 13 }),
    ]);
  });
});

describe("merge_initiative", () => {
  it("merge_initiative gives the named monsters the first named monster's initiative and reports the group and each value before and after", async () => {
    const [goblin1] = seed(
      item(GOBLIN, "Goblin Warrior 1", 12, "goblins"),
      item(WOLF, "Wolf 1", 14, "pack"),
      item(WOLF, "Wolf 2", 12, "pack"),
      item(WOLF, "Wolf 3", 14, "pack"),
    );
    if (!goblin1) throw new Error("seed failed");

    const r = await call("merge_initiative", {
      targets: [goblin1.id, "Wolf 1", "Wolf 2"],
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "One initiative group: Goblin Warrior 1, Wolf 1, Wolf 2; shared initiative 12.",
        "Goblin Warrior 1: initiative 12 -> 12",
        "Wolf 1: initiative 14 -> 12",
        "Wolf 2: initiative 12 -> 12",
      ].join("\n"),
    );
    expect(
      ctx.repo
        .listInstances()
        .map((i) => [i.displayName, i.initiative, i.groupId]),
    ).toEqual([
      ["Goblin Warrior 1", 12, "group-1"],
      ["Wolf 1", 12, "group-1"],
      ["Wolf 2", 12, "group-1"],
      ["Wolf 3", 14, "pack"],
    ]);
    expect(r.structuredContent).toEqual({
      summary: text(r),
      instances: [
        { ...view(find("Goblin Warrior 1")), before: 12 },
        { ...view(find("Wolf 1")), before: 14 },
        { ...view(find("Wolf 2")), before: 12 },
      ],
      initiative: 12,
    });
  });

  it("merge_initiative reports unset as the shared initiative when no named monster has one", async () => {
    seed(item(WOLF, "Wolf 1", null, "pack"), item(WOLF, "Wolf 2", null, null));

    const r = await call("merge_initiative", {
      targets: ["Wolf 1", "Wolf 2"],
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "One initiative group: Wolf 1, Wolf 2; shared initiative unset.",
        "Wolf 1: initiative unset -> unset",
        "Wolf 2: initiative unset -> unset",
      ].join("\n"),
    );
    expect(r.structuredContent?.["initiative"]).toBeNull();
    expect(
      ctx.repo
        .listInstances()
        .map((i) => [i.displayName, i.initiative, i.groupId]),
    ).toEqual([
      ["Wolf 1", null, "group-1"],
      ["Wolf 2", null, "group-1"],
    ]);
  });
});

describe("regrouping failures", () => {
  it("split_initiative and merge_initiative fail and change nothing when a target is unknown or ambiguous", async () => {
    seed(
      item(WOLF, "Wolf 1", 14, "pack"),
      item(WOLF, "Twin", 9, "pair"),
      item(WOLF, "Twin", 9, "pair"),
    );
    const before = ctx.repo.listInstances();

    const calls: [string, Record<string, unknown>][] = [
      ["split_initiative", {}],
      ["split_initiative", { roll: true }],
      ["merge_initiative", {}],
    ];
    for (const [name, extra] of calls) {
      const unknown = await call(name, {
        targets: ["Wolf 1", "Ghost"],
        ...extra,
      });
      expect(unknown.isError, name).toBe(true);
      expect(text(unknown), name).toContain('Unknown target "Ghost"');
      expect(text(unknown), name).toContain("Nothing was changed.");

      const ambiguous = await call(name, {
        targets: ["Wolf 1", "Twin"],
        ...extra,
      });
      expect(ambiguous.isError, name).toBe(true);
      expect(text(ambiguous), name).toContain("Ambiguous");
      expect(text(ambiguous), name).toContain("Nothing was changed.");
    }
    expect(ctx.repo.listInstances()).toEqual(before);
  });
});
