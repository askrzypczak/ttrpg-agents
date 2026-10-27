import type {
  ChangeOrigin,
  MapRegistration,
  MonsterInstance,
  NewMonsterInstance,
  TableMapItem,
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

const table: ChangeOrigin = { source: "table", commandId: "table" };

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const trollskull: TableMapItem = {
  id: "map-1",
  name: "Trollskull Manor",
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  imageOffset: { x: 0, y: 0 },
  position: { x: 0, y: 0 },
  rotation: 270,
  scale: { x: 1, y: 1 },
};

const registered: MapRegistration = {
  itemId: "map-1",
  name: "Trollskull Manor",
  placement: {
    position: { x: 0, y: 0 },
    rotation: 270,
    scale: { x: 1, y: 1 },
    imageOffset: { x: 0, y: 0 },
    imageWidth: 3000,
    imageHeight: 4000,
    imageDpi: 125,
    sceneDpi: 150,
  },
};

let ctx: ToolContext;

beforeEach(() => {
  let tick = 1000;
  let commands = 0;
  let groups = 0;
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  maps.registerMap(registered);
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () =>
        Promise.resolve({
          grid: { dpi: 150, type: "SQUARE" },
          maps: [trollskull],
        }),
      sceneTokens: () => Promise.resolve({ tokens: [] }),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:"), {
      now: () => tick++,
    }),
    maps,
    monsters: loadSrdMonsters(),
    rng: { nextInt: (max) => 3 % max },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${String(++groups)}`,
    newCommandId: () => `command-${String(++commands)}`,
  };
});

async function ok(name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const result = await tool.handler(ctx, args);
  expect(result.isError, name).toBeFalsy();
  return result;
}

async function undoText(): Promise<string> {
  const r = await ok("undo");
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function wolf(
  displayName: string,
  extra: Partial<NewMonsterInstance> = {},
): NewMonsterInstance {
  return {
    monsterKey: "srd-2024_wolf",
    displayName,
    maxHp: 11,
    armorClass: 12,
    initiative: 15,
    ...extra,
  };
}

/** Seeds with a table origin, so the seed itself is not undoable. */
function seed(...items: NewMonsterInstance[]): MonsterInstance[] {
  return ctx.repo.addInstances(() => items, table);
}

describe("undo replies", () => {
  it("undo of a command that left every value as it was replies that nothing had changed", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_initiative", { target: "Wolf 1", initiative: 15 });

    expect(await undoText()).toBe(
      "Undid set_initiative: nothing had changed.\nNothing left to undo.",
    );
  });

  it("undo of a merge into monsters that had no initiative group says the group was not restored", async () => {
    seed(wolf("Wolf 1", { initiative: 12 }), wolf("Wolf 2", { initiative: 9 }));
    await ok("merge_initiative", { targets: ["Wolf 1", "Wolf 2"] });

    const lines = (await undoText()).split("\n");

    expect(lines[0]).toBe("Undid merge_initiative:");
    expect(lines).toContain(
      "Wolf 1 initiative group not restored: it had none",
    );
    expect(lines).toContain("Wolf 2 initiative 12 -> 9");
  });

  it("undo of a max HP change names the max HP and the HP before and after", async () => {
    const [w] = seed(wolf("Wolf 1"));
    ctx.repo.setHp(w!.id, 9, table);
    await ok("set_max_hp", { target: "Wolf 1", maxHp: 5 });

    expect(await undoText()).toBe(
      "Undid set_max_hp: Wolf 1 max HP 5 -> 11, HP 5 -> 9/11\nNothing left to undo.",
    );
  });

  it("undo of an armor class change names the armor class before and after", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });

    expect(await undoText()).toBe(
      "Undid set_armor_class: Wolf 1 AC 18 -> 12\nNothing left to undo.",
    );
  });

  it("undo of an armor class set on a monster that had none says it was not restored", async () => {
    seed(wolf("Wolf 1", { armorClass: null }));
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 15 });

    expect(await undoText()).toBe(
      "Undid set_armor_class: Wolf 1 AC not restored: it had none\nNothing left to undo.",
    );
  });

  it("undo of a change to a monster removed at the table since says it was left removed", async () => {
    const [w] = seed(wolf("Wolf 1"));
    await ok("apply_damage", { target: "Wolf 1", amount: 4 });
    ctx.repo.removeInstances([w!.id], table);

    expect(await undoText()).toBe(
      "Undid apply_damage: Wolf 1 was removed at the table; left removed\nNothing left to undo.",
    );
  });

  it("undo of a split says each monster is back in its earlier initiative group", async () => {
    seed(
      wolf("Wolf 1", { groupId: "pack", initiative: 12 }),
      wolf("Wolf 2", { groupId: "pack", initiative: 12 }),
    );
    await ok("split_initiative", { targets: ["Wolf 1", "Wolf 2"] });

    const lines = (await undoText()).split("\n");

    expect(lines[0]).toBe("Undid split_initiative:");
    expect(lines).toContain(
      "Wolf 1 back in its earlier initiative group, with Wolf 2",
    );
  });

  it("undo of a move says the token moved back", async () => {
    await ok("set_rooms", { rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }] });
    seed(wolf("Wolf 1", { spawnPosition: { x: 3000, y: 3000 } }));
    await ok("move_monsters", { targets: ["Wolf 1"], room: "Kitchen" });

    expect(await undoText()).toBe(
      "Undid move_monsters: Wolf 1 token moved back\nNext undo would reach set_rooms, which it does not cover.",
    );
  });

  it("undo of revealing stats says they are hidden again", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_stats_visibility", { targets: ["Wolf 1"], visible: true });

    expect(await undoText()).toBe(
      "Undid set_stats_visibility: Wolf 1 stats hidden from players\nNothing left to undo.",
    );
  });

  it("undo of hiding stats says they are revealed again", async () => {
    seed(wolf("Wolf 1", { statsVisible: true }));
    await ok("set_stats_visibility", { targets: ["Wolf 1"], visible: false });

    expect(await undoText()).toBe(
      "Undid set_stats_visibility: Wolf 1 stats revealed to players\nNothing left to undo.",
    );
  });
});

function replyText(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function byName(name: string): MonsterInstance {
  const found = ctx.repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found;
}

describe("undo structured content and next-undo line", () => {
  it("undo's structured content has no instance records: each change names the monster, the field and its value before and after", async () => {
    const [w] = seed(wolf("Wolf 1"));
    await ok("rename_monster", { target: "Wolf 1", name: "Alpha" });
    await ok("apply_damage", { target: "Alpha", amount: 4 });

    const first = await ok("undo");

    expect(first.structuredContent).toEqual({
      summary: replyText(first),
      undone: "apply_damage",
      notCovered: null,
      changes: [{ monster: "Alpha", field: "hp", before: 7, after: 11 }],
      kept: [],
      next: { command: "rename_monster", monsters: ["Alpha"], covered: true },
    });

    const second = await ok("undo");

    expect(second.structuredContent).toEqual({
      summary: replyText(second),
      undone: "rename_monster",
      notCovered: null,
      changes: [
        { monster: "Wolf 1", field: "name", before: "Alpha", after: "Wolf 1" },
      ],
      kept: [],
      next: null,
    });
    for (const r of [first, second]) {
      const json = JSON.stringify(r.structuredContent);
      expect(json).not.toContain(w!.id);
      for (const key of ["encounterId", "createdAt", "spawnPosition"]) {
        expect(json).not.toContain(key);
      }
    }
  });

  it("undo of a max HP change reports max HP and HP as separate changes", async () => {
    const [w] = seed(wolf("Wolf 1"));
    ctx.repo.setHp(w!.id, 9, table);
    await ok("set_max_hp", { target: "Wolf 1", maxHp: 5 });

    const r = await ok("undo");

    expect(r.structuredContent?.["changes"]).toEqual([
      { monster: "Wolf 1", field: "maxHp", before: 5, after: 11 },
      { monster: "Wolf 1", field: "hp", before: 5, after: 9 },
    ]);
  });

  it("undo of a type change reports the type, name, max HP, HP, AC and initiative that changed as separate changes", async () => {
    seed(wolf("Wolf 1"));
    await ok("change_monster_type", {
      targets: ["Wolf 1"],
      monster: "srd-2024_dire-wolf",
      hp: "average",
    });
    const [mid] = ctx.repo.listInstances();
    if (!mid) throw new Error("no instance");

    const r = await ok("undo");

    const expected = [
      { field: "type", before: "Dire Wolf", after: "Wolf" },
      { field: "name", before: mid.displayName, after: "Wolf 1" },
      { field: "maxHp", before: mid.maxHp, after: 11 },
      { field: "hp", before: mid.currentHp, after: 11 },
      { field: "armorClass", before: mid.armorClass, after: 12 },
      { field: "initiative", before: mid.initiative, after: 15 },
    ]
      .filter((c) => c.before !== c.after)
      .map((c) => ({ monster: "Wolf 1", ...c }));
    expect(expected.length).toBeGreaterThanOrEqual(5);
    expect(r.structuredContent?.["changes"]).toEqual(expected);
  });

  it("undo of a split names the initiative group members before and after", async () => {
    seed(
      wolf("Wolf 1", { groupId: "pack", initiative: 12 }),
      wolf("Wolf 2", { groupId: "pack", initiative: 12 }),
      wolf("Wolf 3", { groupId: "pack", initiative: 12 }),
    );
    await ok("split_initiative", { targets: ["Wolf 1", "Wolf 2"] });

    const split = await ok("undo");

    const splitLines = replyText(split).split("\n");
    expect(splitLines).toContain(
      "Wolf 1 back in its earlier initiative group, with Wolf 2, Wolf 3",
    );
    expect(splitLines).toContain(
      "Wolf 2 back in its earlier initiative group, with Wolf 1, Wolf 3",
    );
    expect(split.structuredContent?.["changes"]).toEqual([
      {
        monster: "Wolf 1",
        field: "group",
        before: [],
        after: ["Wolf 2", "Wolf 3"],
      },
      {
        monster: "Wolf 2",
        field: "group",
        before: [],
        after: ["Wolf 1", "Wolf 3"],
      },
    ]);

    ctx.repo.setGroupId(byName("Wolf 1").id, "solo", table);
    await ok("merge_initiative", { targets: ["Wolf 1", "Wolf 2"] });

    const merge = await ok("undo");

    expect(replyText(merge).split("\n")).toContain(
      "Wolf 1 back in its earlier initiative group, on its own",
    );
    expect(merge.structuredContent?.["changes"]).toContainEqual({
      monster: "Wolf 1",
      field: "group",
      before: ["Wolf 2"],
      after: [],
    });
    expect(merge.structuredContent?.["changes"]).toContainEqual({
      monster: "Wolf 2",
      field: "group",
      before: ["Wolf 1"],
      after: ["Wolf 3"],
    });
  });

  it("undo of an add or a removal reports each monster's existence before and after", async () => {
    seed(wolf("Wolf 1"));
    await ok("add_monsters", {
      groups: [{ monster: "srd-2024_goblin-warrior", count: 2 }],
    });

    const add = await ok("undo");

    expect(add.structuredContent?.["changes"]).toEqual([
      {
        monster: "Goblin Warrior 1",
        field: "existence",
        before: "in the encounter",
        after: "removed",
      },
      {
        monster: "Goblin Warrior 2",
        field: "existence",
        before: "in the encounter",
        after: "removed",
      },
    ]);

    await ok("remove_monsters", { targets: ["Wolf 1"] });

    const removal = await ok("undo");

    expect(removal.structuredContent?.["changes"]).toEqual([
      {
        monster: "Wolf 1",
        field: "existence",
        before: "removed",
        after: "in the encounter",
      },
    ]);
  });

  it("undo lists what it left alone and why: changed at the table, removed at the table, no earlier value", async () => {
    const [w1, w2] = seed(
      wolf("Wolf 1"),
      wolf("Wolf 2"),
      wolf("Wolf 3", { armorClass: null }),
    );

    await ok("apply_damage", { target: "Wolf 1", amount: 4 });
    ctx.repo.setHp(w1!.id, 5, table);
    const changedAtTable = await ok("undo");

    await ok("apply_damage", { target: "Wolf 2", amount: 4 });
    ctx.repo.removeInstances([w2!.id], table);
    const removedAtTable = await ok("undo");

    await ok("set_armor_class", { target: "Wolf 3", armorClass: 15 });
    const noEarlierValue = await ok("undo");

    expect(changedAtTable.structuredContent?.["kept"]).toEqual([
      { monster: "Wolf 1", field: "hp", reason: "changed at the table" },
    ]);
    expect(removedAtTable.structuredContent?.["kept"]).toEqual([
      { monster: "Wolf 2", field: "existence", reason: "removed at the table" },
    ]);
    expect(noEarlierValue.structuredContent?.["kept"]).toEqual([
      { monster: "Wolf 3", field: "armorClass", reason: "no earlier value" },
    ]);
    for (const r of [changedAtTable, removedAtTable, noEarlierValue]) {
      expect(r.structuredContent?.["changes"]).toEqual([]);
    }
  });

  it("undo replies with what the next undo would reverse, naming its monsters", async () => {
    seed(wolf("Wolf 1"), wolf("Wolf 2"));
    await ok("set_stats_visibility", {
      targets: ["Wolf 1", "Wolf 2"],
      visible: true,
    });
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });

    const r = await ok("undo");

    expect(replyText(r)).toBe(
      [
        "Undid set_armor_class: Wolf 1 AC 18 -> 12",
        "Next undo would reverse set_stats_visibility: Wolf 1, Wolf 2.",
      ].join("\n"),
    );
    expect(r.structuredContent?.["next"]).toEqual({
      command: "set_stats_visibility",
      monsters: ["Wolf 1", "Wolf 2"],
      covered: true,
    });
  });

  it("undo of the last change left replies that nothing is left to undo", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });

    const r = await ok("undo");

    expect(replyText(r)).toBe(
      "Undid set_armor_class: Wolf 1 AC 18 -> 12\nNothing left to undo.",
    );
    expect(r.structuredContent?.["next"]).toBeNull();
  });

  it("undo of a map or room change says nothing was changed and what the next undo would reverse", async () => {
    seed(wolf("Wolf 1"));
    await ok("apply_damage", { target: "Wolf 1", amount: 4 });
    await ok("set_rooms", { rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }] });

    const r = await ok("undo");

    const reply = [
      "The last change was set_rooms, which undo does not cover; nothing was changed.",
      "Next undo would reverse apply_damage: Wolf 1.",
    ].join("\n");
    expect(replyText(r)).toBe(reply);
    expect(r.structuredContent).toEqual({
      summary: reply,
      undone: null,
      notCovered: "set_rooms",
      changes: [],
      kept: [],
      next: { command: "apply_damage", monsters: ["Wolf 1"], covered: true },
    });
    expect(byName("Wolf 1").currentHp).toBe(7);
  });

  it("undo whose next change is a map or room change says the next undo would reach it without reversing it", async () => {
    await ok("set_rooms", { rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }] });
    seed(wolf("Wolf 1"));
    await ok("apply_damage", { target: "Wolf 1", amount: 4 });

    const r = await ok("undo");

    expect(replyText(r)).toBe(
      [
        "Undid apply_damage: Wolf 1 HP 7 -> 11/11",
        "Next undo would reach set_rooms, which it does not cover.",
      ].join("\n"),
    );
    expect(r.structuredContent?.["next"]).toEqual({
      command: "set_rooms",
      monsters: [],
      covered: false,
    });
  });

  it("undo names up to five monsters in the next-undo line and counts more", async () => {
    await ok("add_monsters", {
      groups: [{ monster: "srd-2024_wolf", count: 5 }],
    });
    await ok("add_monsters", {
      groups: [{ monster: "srd-2024_goblin-warrior", count: 6 }],
    });
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });

    const six = await ok("undo");
    expect(replyText(six).split("\n").at(-1)).toBe(
      "Next undo would reverse add_monsters: 6 monsters.",
    );

    const five = await ok("undo");
    expect(replyText(five).split("\n").at(-1)).toBe(
      "Next undo would reverse add_monsters: Wolf 1, Wolf 2, Wolf 3, Wolf 4, Wolf 5.",
    );
  });

  it("undo reports armor class, initiative, stats visibility and position changes, and the same keys when nothing is left", async () => {
    await ok("set_rooms", { rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }] });
    seed(wolf("Wolf 1", { spawnPosition: { x: 3000, y: 3000 } }));

    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });
    const armorClass = await ok("undo");
    expect(armorClass.structuredContent?.["changes"]).toEqual([
      { monster: "Wolf 1", field: "armorClass", before: 18, after: 12 },
    ]);

    await ok("set_initiative", { target: "Wolf 1", initiative: 20 });
    const initiative = await ok("undo");
    expect(initiative.structuredContent?.["changes"]).toEqual([
      { monster: "Wolf 1", field: "initiative", before: 20, after: 15 },
    ]);

    await ok("set_stats_visibility", { targets: ["Wolf 1"], visible: true });
    const statsVisible = await ok("undo");
    expect(statsVisible.structuredContent?.["changes"]).toEqual([
      { monster: "Wolf 1", field: "statsVisible", before: true, after: false },
    ]);

    await ok("move_monsters", { targets: ["Wolf 1"], room: "Kitchen" });
    const position = await ok("undo");
    expect(position.structuredContent?.["changes"]).toEqual([
      {
        monster: "Wolf 1",
        field: "position",
        before: "moved",
        after: "moved back",
      },
    ]);

    const roomChange = await ok("undo");
    expect(roomChange.structuredContent?.["notCovered"]).toBe("set_rooms");

    expect((await ok("undo")).structuredContent).toEqual({
      summary: "Nothing to undo.",
      undone: null,
      notCovered: null,
      changes: [],
      kept: [],
      next: null,
    });
  });
});
