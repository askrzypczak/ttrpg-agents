import type {
  ChangeOrigin,
  MonsterInstance,
  NewMonsterInstance,
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

// SRD 5.2 values: Wolf medium, AC 12, HP 11 (2d8 + 2), initiative +2;
// Shadow medium, AC 12, HP 27, +2; Goblin Boss small, AC 17, HP 21, +2;
// Dire Wolf large, AC 14, HP 22 (3d10 + 6), +2; Owlbear large, AC 13, HP 59, +1;
// Zombie medium, AC 8, HP 15, -2.
const WOLF = "srd-2024_wolf";
const SHADOW = "srd-2024_shadow";
const DIRE_WOLF = "srd-2024_dire-wolf";
const GOBLIN_BOSS = "srd-2024_goblin-boss";
const OWLBEAR = "srd-2024_owlbear";
const ZOMBIE = "srd-2024_zombie";

let ctx: ToolContext;

beforeEach(() => {
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters: loadSrdMonsters(),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group",
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

function wolf(displayName: string): NewMonsterInstance {
  return {
    monsterKey: WOLF,
    displayName,
    maxHp: 11,
    armorClass: 12,
    initiative: 15,
  };
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

const stored = () =>
  ctx.repo
    .listInstances()
    .map((i) => [
      i.displayName,
      i.monsterKey,
      i.currentHp,
      i.maxHp,
      i.armorClass,
      i.initiative,
      i.footprint,
    ]);

describe("change_monster_type", () => {
  it("change_monster_type by id and by exact name replies one line per monster with its old and new name, HP, AC and initiative", async () => {
    const [hurt, shadow] = seed(wolf("Wolf 1"), {
      monsterKey: SHADOW,
      displayName: "Shadow 1",
      maxHp: 27,
      armorClass: null,
      initiative: null,
    });
    if (!hurt || !shadow) throw new Error("seed failed");
    ctx.repo.applyDamage(hurt.id, 6, origin);

    const r = await call("change_monster_type", {
      targets: [hurt.id, "Shadow 1"],
      monster: GOBLIN_BOSS,
      hp: "average",
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "Wolf 1 -> Goblin Boss 1: HP 5/11 -> 15/21, AC 12 -> 17, initiative 15 -> 15",
        "Shadow 1 -> Goblin Boss 2: HP 27/27 -> 21/21, AC none -> 17, initiative none -> none",
      ].join("\n"),
    );
    expect(stored()).toEqual([
      ["Goblin Boss 1", GOBLIN_BOSS, 15, 21, 17, 15, 1],
      ["Goblin Boss 2", GOBLIN_BOSS, 21, 21, 17, null, 1],
    ]);
    const after = ctx.repo.listInstances();
    expect(r.structuredContent).toEqual({
      summary: text(r),
      instances: after.map(view),
      before: [view({ ...hurt, currentHp: 5 }), view(shadow)],
      noLongerFits: [],
      rolls: [],
    });
  });

  it("change_monster_type says that a monster whose footprint grew no longer fits its cell", async () => {
    const [hurt, big] = seed(wolf("Wolf 1"), {
      monsterKey: DIRE_WOLF,
      displayName: "Dire Wolf 1",
      maxHp: 22,
      armorClass: 14,
      initiative: 10,
      footprint: 2,
    });
    if (!hurt || !big) throw new Error("seed failed");
    ctx.repo.applyDamage(hurt.id, 6, origin);

    const r = await call("change_monster_type", {
      targets: ["Wolf 1", "Dire Wolf 1"],
      monster: OWLBEAR,
      hp: "average",
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "Wolf 1 -> Owlbear 1: HP 5/11 -> 53/59, AC 12 -> 13, initiative 15 -> 14 (kept roll 13, modifier +1); no longer fits its cell (now 2x2 cells)",
        "Dire Wolf 1 -> Owlbear 2: HP 22/22 -> 59/59, AC 14 -> 13, initiative 10 -> 9 (kept roll 8, modifier +1)",
      ].join("\n"),
    );
    expect(r.structuredContent?.noLongerFits).toEqual(["Owlbear 1"]);
    expect(stored()).toEqual([
      ["Owlbear 1", OWLBEAR, 53, 59, 13, 14, 2],
      ["Owlbear 2", OWLBEAR, 59, 59, 13, 9, 2],
    ]);
  });

  it("change_monster_type names the monsters that no longer fit", async () => {
    seed(
      wolf("Wolf 1"),
      {
        monsterKey: DIRE_WOLF,
        displayName: "Dire Wolf 1",
        maxHp: 22,
        armorClass: 14,
        initiative: 10,
        footprint: 2,
      },
      wolf("Wolf 2"),
    );

    const r = await call("change_monster_type", {
      targets: ["Wolf 1", "Dire Wolf 1", "Wolf 2"],
      monster: OWLBEAR,
      hp: "average",
    });

    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.noLongerFits).toEqual([
      "Owlbear 1",
      "Owlbear 3",
    ]);
  });

  it("change_monster_type states the kept roll and modifier when initiative changed", async () => {
    // Wolf +2 -> Zombie -2: kept roll 15 - 2 = 13, new initiative 13 - 2 = 11.
    seed(wolf("Wolf 1"));

    const r = await call("change_monster_type", {
      targets: ["Wolf 1"],
      monster: ZOMBIE,
      hp: "average",
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      "Wolf 1 -> Zombie 1: HP 11/11 -> 15/15, AC 12 -> 8, initiative 15 -> 11 (kept roll 13, modifier -2)",
    );
  });

  it("change_monster_type says nothing about initiative when it did not change", async () => {
    // Wolf +2 -> Goblin Boss +2 keeps 15; no initiative stays none.
    seed(wolf("Wolf 1"), {
      monsterKey: SHADOW,
      displayName: "Shadow 1",
      maxHp: 27,
      armorClass: null,
      initiative: null,
    });

    const r = await call("change_monster_type", {
      targets: ["Wolf 1", "Shadow 1"],
      monster: GOBLIN_BOSS,
      hp: "average",
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "Wolf 1 -> Goblin Boss 1: HP 11/11 -> 21/21, AC 12 -> 17, initiative 15 -> 15",
        "Shadow 1 -> Goblin Boss 2: HP 27/27 -> 21/21, AC none -> 17, initiative none -> none",
      ].join("\n"),
    );
  });

  it("change_monster_type with hp rolled adds a Rolls line per HP roll", async () => {
    // Each call yields the next counter value; each die shows it plus one.
    let n = 0;
    ctx.rng = { nextInt: (max) => n++ % max };
    // Dire Wolf HP is 3d10 + 6: 1+2+3+6 = 12, then 4+5+6+6 = 21.
    seed(wolf("Wolf 1"), wolf("Wolf 2"));

    const r = await call("change_monster_type", {
      targets: ["Wolf 1", "Wolf 2"],
      monster: DIRE_WOLF,
      hp: "rolled",
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "Wolf 1 -> Dire Wolf 1: HP 11/11 -> 12/12, AC 12 -> 14, initiative 15 -> 15; no longer fits its cell (now 2x2 cells)",
        "Wolf 2 -> Dire Wolf 2: HP 11/11 -> 21/21, AC 12 -> 14, initiative 15 -> 15; no longer fits its cell (now 2x2 cells)",
        "",
        "Rolls:",
        "- Dire Wolf 1 HP: 3d10 + 6 = 12",
        "- Dire Wolf 2 HP: 3d10 + 6 = 21",
      ].join("\n"),
    );
    expect(r.structuredContent?.rolls).toMatchObject([
      { label: "Dire Wolf 1 HP", total: 12 },
      { label: "Dire Wolf 2 HP", total: 21 },
    ]);
  });

  it("change_monster_type with an unknown target or an unknown monster key fails and changes nothing", async () => {
    seed(wolf("Wolf 1"), wolf("Wolf 2"));
    const before = stored();

    const unknownTarget = await call("change_monster_type", {
      targets: ["Wolf 1", "Ghost"],
      monster: DIRE_WOLF,
    });
    expect(unknownTarget.isError).toBe(true);
    expect(text(unknownTarget)).toContain('Unknown target "Ghost"');
    expect(text(unknownTarget)).toMatch(/Nothing was changed\.$/);

    const unknownMonster = await call("change_monster_type", {
      targets: ["Wolf 1", "Wolf 2"],
      monster: "srd-2024_not-a-monster",
    });
    expect(unknownMonster.isError).toBe(true);

    expect(stored()).toEqual(before);
  });
});
