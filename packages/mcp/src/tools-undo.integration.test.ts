import type {
  ChangeOrigin,
  EncounterRepository,
  MapRegistration,
  MonsterInstance,
  NewMonsterInstance,
  Rng,
  TableMapItem,
  TableSceneMap,
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

// SRD 5.2: Wolf AC 12, HP 11; Dire Wolf large, AC 14, HP 22.
const WOLF = "srd-2024_wolf";
const DIRE_WOLF = "srd-2024_dire-wolf";
const GOBLIN = "srd-2024_goblin-warrior";

const table: ChangeOrigin = { source: "table", commandId: "table" };

const NOT_COVERED = (tool: string): string =>
  `The last change was ${tool}, which undo does not cover; nothing was changed.`;

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270 (32 x 24 cells). */
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

function scene(...maps: TableMapItem[]): TableSceneMap {
  return { grid: { dpi: 150, type: "SQUARE" }, maps };
}

const rng: Rng = { nextInt: (max) => 3 % max };

interface Write {
  method: string;
  origin: ChangeOrigin;
}

/** Delegates every call to `inner`, recording the origin of each call that takes one. */
function recording(
  inner: EncounterRepository,
  writes: Write[],
): EncounterRepository {
  return new Proxy(inner, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const last = args.at(-1);
        if (
          typeof last === "object" &&
          last !== null &&
          "source" in last &&
          "commandId" in last
        ) {
          writes.push({
            method: String(property),
            origin: last as ChangeOrigin,
          });
        }
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

let ctx: ToolContext;
let writes: Write[];
let issuedCommandIds: string[];

beforeEach(() => {
  let tick = 1000;
  writes = [];
  issuedCommandIds = [];
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  maps.registerMap(registered);
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.resolve(scene(trollskull)),
      sceneTokens: () => Promise.resolve({ tokens: [] }),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: recording(
      new SqliteEncounterRepository(openDatabase(":memory:"), {
        now: () => tick++,
      }),
      writes,
    ),
    maps,
    monsters: loadSrdMonsters(),
    rng,
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${String(tick)}`,
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

/** Calls a tool and expects it to succeed. */
async function ok(name: string, args: unknown = {}): Promise<ToolResult> {
  const result = await call(name, args);
  expect(result.isError, `${name}: ${text(result)}`).toBeFalsy();
  return result;
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function wolf(
  displayName: string,
  extra: Partial<NewMonsterInstance> = {},
): NewMonsterInstance {
  return {
    monsterKey: WOLF,
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

function byName(name: string): MonsterInstance {
  const found = ctx.repo.listInstances().find((i) => i.displayName === name);
  if (!found) throw new Error(`no instance ${name}`);
  return found;
}

function names(): string[] {
  return ctx.repo.listInstances().map((i) => i.displayName);
}

async function saveKitchen(): Promise<void> {
  await ok("set_rooms", { rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }] });
}

describe("undo", () => {
  it("undo after add_monsters removes the added monsters, one line each", async () => {
    seed({ monsterKey: GOBLIN, displayName: "Goblin Warrior 1", maxHp: 7 });
    await ok("add_monsters", { groups: [{ monster: WOLF, count: 2 }] });
    expect(names()).toEqual(["Goblin Warrior 1", "Wolf 1", "Wolf 2"]);

    const r = await ok("undo");

    expect(names()).toEqual(["Goblin Warrior 1"]);
    const lines = text(r).split("\n");
    expect(lines[0]).toBe("Undid add_monsters:");
    expect(lines).toContain("Wolf 1 removed");
    expect(lines).toContain("Wolf 2 removed");
    expect(r.structuredContent).toMatchObject({ undone: "add_monsters" });
  });

  it("undo after add_monsters with join removes the joined monsters and leaves the member's group and initiative", async () => {
    seed({
      monsterKey: GOBLIN,
      displayName: "Boss",
      maxHp: 7,
      initiative: 17,
      groupId: "boss-group",
    });
    await ok("add_monsters", {
      groups: [{ monster: WOLF, count: 2, join: "Boss" }],
    });

    const r = await ok("undo");

    expect(names()).toEqual(["Boss"]);
    expect(byName("Boss")).toMatchObject({
      groupId: "boss-group",
      initiative: 17,
    });
    expect(text(r)).toContain("Wolf 1 removed");
    expect(text(r)).toContain("Wolf 2 removed");
  });

  it("undo after move_monsters moves the monsters back to their earlier spawn positions", async () => {
    await saveKitchen();
    seed(
      wolf("Wolf 1", { spawnPosition: { x: 3000, y: 3000 } }),
      wolf("Wolf 2", { spawnPosition: { x: 3150, y: 3000 } }),
    );
    await ok("move_monsters", {
      targets: ["Wolf 1", "Wolf 2"],
      room: "Kitchen",
    });
    expect(byName("Wolf 1").spawnPosition).not.toEqual({ x: 3000, y: 3000 });

    const r = await ok("undo");

    expect(byName("Wolf 1").spawnPosition).toEqual({ x: 3000, y: 3000 });
    expect(byName("Wolf 2").spawnPosition).toEqual({ x: 3150, y: 3000 });
    expect(text(r)).toContain("Undid move_monsters:");
  });

  it("undo after move_monsters of a monster with no earlier spawn position leaves it and says its token was not moved back", async () => {
    await saveKitchen();
    seed(
      wolf("Wolf 1", { spawnPosition: { x: 3000, y: 3000 } }),
      wolf("Wolf 2"),
    );
    await ok("move_monsters", {
      targets: ["Wolf 1", "Wolf 2"],
      room: "Kitchen",
    });
    const moved = byName("Wolf 2").spawnPosition;
    expect(moved).not.toBeNull();

    const r = await ok("undo");

    expect(byName("Wolf 1").spawnPosition).toEqual({ x: 3000, y: 3000 });
    expect(byName("Wolf 2").spawnPosition).toEqual(moved);
    expect(text(r)).toContain(
      "Wolf 2 token not moved back: it had no spawn position",
    );
  });

  it('undo after apply_damage sets the HP back and replies "Undid apply_damage: <name> HP a -> b/max"', async () => {
    seed(wolf("Wolf 1"));
    await ok("apply_damage", { target: "Wolf 1", amount: 4 });
    expect(byName("Wolf 1").currentHp).toBe(7);

    const r = await ok("undo");

    expect(byName("Wolf 1").currentHp).toBe(11);
    expect(text(r)).toBe(
      "Undid apply_damage: Wolf 1 HP 7 -> 11/11\nNothing left to undo.",
    );
    expect(r.structuredContent).toMatchObject({ undone: "apply_damage" });
    expect(r.structuredContent?.["changes"]).toHaveLength(1);
  });

  it("undo after heal sets the HP back", async () => {
    const [w] = seed(wolf("Wolf 1"));
    ctx.repo.setHp(w!.id, 3, table);
    await ok("heal", { target: "Wolf 1", amount: 5 });
    expect(byName("Wolf 1").currentHp).toBe(8);

    await ok("undo");

    expect(byName("Wolf 1").currentHp).toBe(3);
  });

  it("undo after set_hp sets the HP back", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_hp", { target: "Wolf 1", hp: 2 });

    await ok("undo");

    expect(byName("Wolf 1").currentHp).toBe(11);
  });

  it("undo after set_max_hp sets the max HP and HP back", async () => {
    const [w] = seed(wolf("Wolf 1"));
    ctx.repo.setHp(w!.id, 9, table);
    await ok("set_max_hp", { target: "Wolf 1", maxHp: 5 });
    expect(byName("Wolf 1")).toMatchObject({ maxHp: 5, currentHp: 5 });

    await ok("undo");

    expect(byName("Wolf 1")).toMatchObject({ maxHp: 11, currentHp: 9 });
  });

  it("undo after reset_max_hp sets each monster's max HP and HP back", async () => {
    const [a] = seed(
      wolf("Wolf 1", { maxHp: 5 }),
      wolf("Wolf 2", { maxHp: 6 }),
    );
    ctx.repo.setHp(a!.id, 3, table);
    const before = ctx.repo.listInstances();
    await ok("reset_max_hp", { targets: ["Wolf 1", "Wolf 2"], hp: "average" });
    expect(byName("Wolf 1").maxHp).toBe(11);
    expect(byName("Wolf 2").maxHp).toBe(11);

    await ok("undo");

    expect(ctx.repo.listInstances()).toEqual(before);
  });

  it("undo after set_armor_class sets the armor class back", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });

    await ok("undo");

    expect(byName("Wolf 1").armorClass).toBe(12);
  });

  it("undo after remove_monsters restores the removed monsters", async () => {
    seed(wolf("Wolf 1"), wolf("Wolf 2"), wolf("Wolf 3"));
    const before = ctx.repo.listInstances();
    await ok("remove_monsters", { targets: ["Wolf 1", "Wolf 3"] });
    expect(names()).toEqual(["Wolf 2"]);

    const r = await ok("undo");

    expect(ctx.repo.listInstances()).toEqual(before);
    expect(text(r)).toContain("Wolf 1 restored");
    expect(text(r)).toContain("Wolf 3 restored");
  });

  it("undo after restore_monsters removes the restored monsters again", async () => {
    const [, w2] = seed(wolf("Wolf 1"), wolf("Wolf 2"));
    ctx.repo.removeInstances([w2!.id], table);
    await ok("restore_monsters", { targets: ["Wolf 2"] });
    expect(names()).toEqual(["Wolf 1", "Wolf 2"]);

    const r = await ok("undo");

    expect(names()).toEqual(["Wolf 1"]);
    expect(ctx.repo.listRemovedInstances().map((e) => e.instance.id)).toEqual([
      w2!.id,
    ]);
    expect(text(r)).toContain("Wolf 2 removed");
  });

  it("undo after restore_encounter removes the restored monsters again", async () => {
    seed(wolf("Wolf 1"), wolf("Wolf 2"));
    await ok("clear_encounter");
    await ok("restore_encounter");
    expect(names()).toEqual(["Wolf 1", "Wolf 2"]);

    const r = await ok("undo");

    expect(names()).toEqual([]);
    expect(text(r)).toContain("Wolf 1 removed");
    expect(text(r)).toContain("Wolf 2 removed");
  });

  it("undo after change_monster_type sets the type, name, HP, AC, initiative and footprint back", async () => {
    seed(wolf("Wolf 1"));
    const before = ctx.repo.listInstances();
    await ok("change_monster_type", {
      targets: ["Wolf 1"],
      monster: DIRE_WOLF,
    });
    expect(ctx.repo.listInstances()[0]?.monsterKey).toBe(DIRE_WOLF);

    await ok("undo");

    expect(ctx.repo.listInstances()).toEqual(before);
  });

  it("undo after rename_monster sets the name back", async () => {
    seed(wolf("Wolf 1"));
    await ok("rename_monster", { target: "Wolf 1", name: "Alpha" });

    const r = await ok("undo");

    expect(names()).toEqual(["Wolf 1"]);
    expect(text(r)).toContain("Alpha renamed to Wolf 1");
  });

  it("undo after set_initiative sets the initiative back", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_initiative", { target: "Wolf 1", initiative: 20 });

    await ok("undo");

    expect(byName("Wolf 1").initiative).toBe(15);
  });

  it("undo after roll_initiative sets each rolled initiative back", async () => {
    seed(wolf("Wolf 1", { initiative: 1 }), wolf("Wolf 2", { initiative: 2 }));
    await ok("roll_initiative", {
      targets: ["Wolf 1", "Wolf 2"],
      mode: "each",
    });
    expect(byName("Wolf 1").initiative).not.toBe(1);

    await ok("undo");

    expect(byName("Wolf 1").initiative).toBe(1);
    expect(byName("Wolf 2").initiative).toBe(2);
  });

  it("undo after split_initiative puts the monsters back in their group with their initiative", async () => {
    seed(
      wolf("Wolf 1", { groupId: "pack", initiative: 12 }),
      wolf("Wolf 2", { groupId: "pack", initiative: 12 }),
    );
    const before = ctx.repo.listInstances();
    await ok("split_initiative", { targets: ["Wolf 1", "Wolf 2"], roll: true });
    expect(byName("Wolf 1").groupId).not.toBe("pack");

    await ok("undo");

    expect(ctx.repo.listInstances()).toEqual(before);
  });

  it("undo after merge_initiative puts each monster back in its group with its initiative", async () => {
    seed(
      wolf("Wolf 1", { groupId: "a", initiative: 12 }),
      wolf("Wolf 2", { groupId: "b", initiative: 9 }),
    );
    const before = ctx.repo.listInstances();
    await ok("merge_initiative", { targets: ["Wolf 1", "Wolf 2"] });
    expect(byName("Wolf 1").groupId).toBe(byName("Wolf 2").groupId);

    await ok("undo");

    expect(ctx.repo.listInstances()).toEqual(before);
  });

  it("undo after set_stats_visibility sets the visibility back", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_stats_visibility", { targets: ["Wolf 1"], visible: true });

    const r = await ok("undo");

    expect(byName("Wolf 1").statsVisible).toBe(false);
    expect(text(r)).toContain("Wolf 1 stats hidden from players");
  });

  it('undo with nothing to undo replies "Nothing to undo." and changes nothing', async () => {
    seed(wolf("Wolf 1"));
    const before = ctx.repo.listInstances();
    writes.length = 0;

    const r = await ok("undo");

    expect(text(r)).toBe("Nothing to undo.");
    expect(ctx.repo.listInstances()).toEqual(before);
    expect(writes).toEqual([]);
  });

  it("undo leaves an HP changed at the table after the command and names it in the reply", async () => {
    const [w] = seed(wolf("Wolf 1"));
    await ok("apply_damage", { target: "Wolf 1", amount: 4 });
    ctx.repo.setHp(w!.id, 5, table);

    const r = await ok("undo");

    expect(byName("Wolf 1").currentHp).toBe(5);
    expect(text(r)).toContain("Wolf 1 HP 5/11 left as set at the table");
  });

  it("a second undo reverses the command before the first, never the first undo", async () => {
    seed(wolf("Wolf 1"));
    await ok("apply_damage", { target: "Wolf 1", amount: 4 });
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });

    const first = await ok("undo");
    expect(text(first)).toContain("Undid set_armor_class:");
    expect(byName("Wolf 1")).toMatchObject({ armorClass: 12, currentHp: 7 });

    const second = await ok("undo");
    expect(text(second)).toContain("Undid apply_damage:");
    expect(byName("Wolf 1")).toMatchObject({ armorClass: 12, currentHp: 11 });

    const third = await ok("undo");
    expect(text(third)).toBe("Nothing to undo.");
    expect(byName("Wolf 1")).toMatchObject({ armorClass: 12, currentHp: 11 });
  });

  it("undo after use_map, set_rooms or remove_rooms says the change is not covered and changes nothing, and the next undo reaches the encounter change before it", async () => {
    seed(wolf("Wolf 1"));
    const mapCalls: [string, unknown][] = [
      ["use_map", {}],
      ["set_rooms", { rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }] }],
      ["remove_rooms", { names: ["Kitchen"] }],
    ];
    for (const [tool, args] of mapCalls) {
      await ok("apply_damage", { target: "Wolf 1", amount: 4 });
      await ok(tool, args);
      const rooms = ctx.maps.getRooms("map-1");
      const active = ctx.maps.getActiveMap();

      const notCovered = await ok("undo");
      expect(text(notCovered), tool).toBe(
        [
          NOT_COVERED(tool),
          "Next undo would reverse apply_damage: Wolf 1.",
        ].join("\n"),
      );
      expect(byName("Wolf 1").currentHp, tool).toBe(7);
      expect(ctx.maps.getRooms("map-1"), tool).toEqual(rooms);
      expect(ctx.maps.getActiveMap(), tool).toEqual(active);

      const reversed = await ok("undo");
      expect(text(reversed), tool).toContain("Undid apply_damage:");
      expect(byName("Wolf 1").currentHp, tool).toBe(11);
    }
  });

  it('undo after a clear_encounter that cleared monsters replies "Nothing to undo." and changes nothing', async () => {
    await ok("add_monsters", { groups: [{ monster: WOLF, count: 2 }] });
    await ok("apply_damage", { target: "Wolf 1", amount: 2 });
    await ok("clear_encounter");
    const removed = ctx.repo.listRemovedInstances();

    const r = await ok("undo");

    expect(text(r)).toBe("Nothing to undo.");
    expect(names()).toEqual([]);
    expect(ctx.repo.listRemovedInstances()).toEqual(removed);
  });

  it('undo\'s writes carry source mcp, one fresh command id and command "undo"', async () => {
    seed(wolf("Wolf 1", { maxHp: 5 }), wolf("Wolf 2", { maxHp: 6 }));
    await ok("reset_max_hp", { targets: ["Wolf 1", "Wolf 2"], hp: "average" });
    const earlier = [...issuedCommandIds];
    writes.length = 0;

    await ok("undo");

    const undoWrites = writes.filter((w) => w.method !== "noteCommand");
    expect(undoWrites.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(undoWrites.map((w) => w.origin.commandId));
    expect(ids.size).toBe(1);
    const [id] = [...ids];
    expect(earlier).not.toContain(id);
    for (const write of undoWrites) {
      expect(write.origin, write.method).toEqual({
        source: "mcp",
        commandId: id,
        command: "undo",
      });
    }
  });
});
