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

const WOLF = "srd-2024_wolf";
const DIRE_WOLF = "srd-2024_dire-wolf";

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

async function call(name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const result = await tool.handler(ctx, args);
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

describe("reply summary", () => {
  it("every in-scope tool's structured content carries its reply text as summary", async () => {
    await call("set_rooms", {
      rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }],
    });
    seed(
      wolf("Wolf 1", { groupId: "pack", initiative: 12 }),
      wolf("Wolf 2", { groupId: "pack", initiative: 12 }),
      wolf("Wolf 3", { groupId: "other", initiative: 9 }),
      wolf("Wolf 4"),
    );

    const replies: [string, ToolResult][] = [];
    const run = async (name: string, args: unknown = {}): Promise<void> => {
      replies.push([name, await call(name, args)]);
    };

    await run("preview_monsters", {
      groups: [{ monster: WOLF, count: 2 }],
    });
    await run("move_monsters", { targets: ["Wolf 1"], room: "Kitchen" });
    await run("set_hp", { target: "Wolf 1", hp: 4 });
    await run("set_max_hp", { target: "Wolf 2", maxHp: 20 });
    await run("reset_max_hp", { targets: ["Wolf 2"], hp: "average" });
    await run("set_armor_class", { target: "Wolf 3", armorClass: 16 });
    await call("remove_monsters", { targets: ["Wolf 4"] });
    await run("restore_monsters", { targets: ["Wolf 4"] });
    await run("change_monster_type", {
      targets: ["Wolf 4"],
      monster: DIRE_WOLF,
      hp: "average",
    });
    await run("roll_initiative", { targets: ["Wolf 3"] });
    await run("split_initiative", { targets: ["Wolf 1"] });
    await run("merge_initiative", { targets: ["Wolf 1", "Wolf 3"] });
    await run("undo");
    await run("add_monsters", {
      groups: [{ monster: WOLF, count: 1, join: "Wolf 2" }],
    });
    await run("list_encounter");
    await call("clear_encounter");
    await run("restore_encounter");

    expect(replies.map(([name]) => name).sort()).toEqual(
      [
        "preview_monsters",
        "move_monsters",
        "set_hp",
        "set_max_hp",
        "reset_max_hp",
        "set_armor_class",
        "restore_monsters",
        "restore_encounter",
        "change_monster_type",
        "roll_initiative",
        "split_initiative",
        "merge_initiative",
        "undo",
        "add_monsters",
        "list_encounter",
      ].sort(),
    );
    for (const [name, r] of replies) {
      expect(r.structuredContent?.["summary"], name).toBe(text(r));
    }
  });
});
