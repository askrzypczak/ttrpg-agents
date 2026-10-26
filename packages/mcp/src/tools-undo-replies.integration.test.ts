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
    newGroupId: () => `group-${String(tick)}`,
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

    expect(await undoText()).toBe("Undid set_initiative: nothing had changed.");
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
      "Undid set_max_hp: Wolf 1 max HP 5 -> 11, HP 5 -> 9/11",
    );
  });

  it("undo of an armor class change names the armor class before and after", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 18 });

    expect(await undoText()).toBe("Undid set_armor_class: Wolf 1 AC 18 -> 12");
  });

  it("undo of an armor class set on a monster that had none says it was not restored", async () => {
    seed(wolf("Wolf 1", { armorClass: null }));
    await ok("set_armor_class", { target: "Wolf 1", armorClass: 15 });

    expect(await undoText()).toBe(
      "Undid set_armor_class: Wolf 1 AC not restored: it had none",
    );
  });

  it("undo of a change to a monster removed at the table since says it was left removed", async () => {
    const [w] = seed(wolf("Wolf 1"));
    await ok("apply_damage", { target: "Wolf 1", amount: 4 });
    ctx.repo.removeInstances([w!.id], table);

    expect(await undoText()).toBe(
      "Undid apply_damage: Wolf 1 was removed at the table; left removed",
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
    expect(lines).toContain("Wolf 1 back in its earlier initiative group");
  });

  it("undo of a move says the token moved back", async () => {
    await ok("set_rooms", { rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }] });
    seed(wolf("Wolf 1", { spawnPosition: { x: 3000, y: 3000 } }));
    await ok("move_monsters", { targets: ["Wolf 1"], room: "Kitchen" });

    expect(await undoText()).toBe(
      "Undid move_monsters: Wolf 1 token moved back",
    );
  });

  it("undo of revealing stats says they are hidden again", async () => {
    seed(wolf("Wolf 1"));
    await ok("set_stats_visibility", { targets: ["Wolf 1"], visible: true });

    expect(await undoText()).toBe(
      "Undid set_stats_visibility: Wolf 1 stats hidden from players",
    );
  });

  it("undo of hiding stats says they are revealed again", async () => {
    seed(wolf("Wolf 1", { statsVisible: true }));
    await ok("set_stats_visibility", { targets: ["Wolf 1"], visible: false });

    expect(await undoText()).toBe(
      "Undid set_stats_visibility: Wolf 1 stats revealed to players",
    );
  });
});
