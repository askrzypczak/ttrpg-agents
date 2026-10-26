import type {
  MapRegistration,
  Rng,
  TableMapItem,
  TableSceneMap,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterLog,
  SqliteEncounterRepository,
  SqliteMapRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

const SHADOW = "srd-2024_shadow";
const TROLL = "srd-2024_troll";
const GOBLIN = "srd-2024_goblin-warrior";
const monsters = loadSrdMonsters();

/** A 10 x 10 cell map, unrotated, at the scene origin on a 150-unit grid: display cell A1 is its top-left cell. */
const manor: TableMapItem = {
  id: "map-1",
  name: "Manor",
  imageWidth: 1500,
  imageHeight: 1500,
  imageDpi: 150,
  imageOffset: { x: 0, y: 0 },
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
};

const registered: MapRegistration = {
  itemId: "map-1",
  name: "Manor",
  placement: {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    imageOffset: { x: 0, y: 0 },
    imageWidth: 1500,
    imageHeight: 1500,
    imageDpi: 150,
    sceneDpi: 150,
  },
};

const scene: TableSceneMap = {
  grid: { dpi: 150, type: "SQUARE" },
  maps: [manor],
};

/** Test-only Rng that always yields 0 and counts its draws. */
function countingRng(): Rng & { draws: number } {
  const rng = {
    draws: 0,
    nextInt: () => {
      rng.draws += 1;
      return 0;
    },
  };
  return rng;
}

let ctx: ToolContext;
let rng: Rng & { draws: number };
let log: SqliteEncounterLog;

beforeEach(() => {
  const db = openDatabase(":memory:");
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  maps.registerMap(registered);
  rng = countingRng();
  log = new SqliteEncounterLog(db);
  let groupN = 0;
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.resolve(scene),
      sceneTokens: () => Promise.resolve({ tokens: [] }),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(db),
    maps,
    monsters,
    rng,
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${String(++groupN)}`,
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

async function seedShadows(count: number): Promise<void> {
  const r = await call("add_monsters", {
    groups: [{ monster: SHADOW, count }],
  });
  expect(r.isError).toBeUndefined();
}

async function saveRooms(
  rooms: { name: string; ranges: string[] }[],
): Promise<void> {
  const r = await call("set_rooms", { rooms });
  expect(r.isError).toBeFalsy();
}

describe("preview_monsters", () => {
  it("preview_monsters says nothing was added and lists each would-be monster's name, AC, average HP with dice, initiative modifier and footprint", async () => {
    const r = await call("preview_monsters", {
      groups: [
        { monster: TROLL, count: 1 },
        { monster: SHADOW, count: 2 },
        { monster: GOBLIN, count: 1 },
      ],
    });
    expect(r.isError).toBeUndefined();
    const reply = text(r);
    expect(reply.split("\n")[0]).toBe(
      "Preview only: nothing was added or rolled.",
    );
    expect(reply).toContain("| name | AC | HP | initiative | footprint |");
    expect(reply).toContain("| Troll 1 | 15 | 94 (9d10 + 45) | +1 | 2 x 2 |");
    expect(reply).toContain("| Shadow 1 | 12 | 27 (5d8 + 5) | +2 | 1 x 1 |");
    expect(reply).toContain("| Shadow 2 | 12 | 27 (5d8 + 5) | +2 | 1 x 1 |");
    expect(reply).toContain(
      "| Goblin Warrior 1 | 15 | 10 (3d6) | +2 | 1 x 1 |",
    );
    expect(reply.indexOf("| Troll 1 |")).toBeLessThan(
      reply.indexOf("| Shadow 1 |"),
    );
    expect(reply.indexOf("| Shadow 2 |")).toBeLessThan(
      reply.indexOf("| Goblin Warrior 1 |"),
    );
  });

  it("preview_monsters leaves the store, the change log and the tool context's rng untouched", async () => {
    await seedShadows(2);
    await saveRooms([{ name: "Attic", ranges: ["A1:B2"] }]);
    const before = ctx.repo.listInstances();
    const seq = log.latestSeq();
    const draws = rng.draws;

    const r = await call("preview_monsters", {
      groups: [
        { monster: TROLL, count: 2, room: "Attic" },
        { monster: SHADOW, count: 1, join: "Shadow 1" },
        { monster: GOBLIN, count: 2, hp: "rolled" },
      ],
      initiative: "each",
    });
    expect(r.isError).toBeUndefined();
    expect(ctx.repo.listInstances()).toEqual(before);
    expect(log.latestSeq()).toBe(seq);
    expect(rng.draws).toBe(draws);
  });

  it("preview_monsters shows a joined monster's initiative as the member's current initiative with the member's name", async () => {
    await seedShadows(2);
    const member = ctx.repo
      .listInstances()
      .find((i) => i.displayName === "Shadow 1");
    if (!member) throw new Error("no instance Shadow 1");
    ctx.repo.setInitiative(member.id, 14, { source: "mcp", commandId: "seed" });

    const r = await call("preview_monsters", {
      groups: [{ monster: SHADOW, count: 1, join: "Shadow 1" }],
    });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain(
      "| Shadow 3 | 12 | 27 (5d8 + 5) | 14 (joins Shadow 1) | 1 x 1 |",
    );
  });

  it("preview_monsters with a room lists the cells the monsters would take and the ones left with no free cell", async () => {
    await saveRooms([{ name: "Attic", ranges: ["A1:B2"] }]);

    const r = await call("preview_monsters", {
      groups: [{ monster: TROLL, count: 2, room: "attic" }],
    });
    expect(r.isError).toBeUndefined();
    const reply = text(r);
    expect(reply).toContain("Would be placed in Attic: Troll 1 at A1:B2.");
    expect(reply).toContain("No free cell left in Attic for Troll 2.");
    expect(r.structuredContent?.["placements"]).toEqual([
      { name: "Troll 1", room: "Attic", cell: "A1:B2" },
      { name: "Troll 2", room: "Attic", cell: null },
    ]);
    expect(ctx.repo.listInstances()).toEqual([]);
  });

  it("preview_monsters fails with the same message as add_monsters for the same invalid arguments", async () => {
    await seedShadows(1);
    await saveRooms([{ name: "Attic", ranges: ["A1:B2"] }]);
    const cases: { label: string; args: unknown }[] = [
      {
        label: "count 0",
        args: { groups: [{ monster: SHADOW, count: 0 }] },
      },
      {
        label: "unknown monster",
        args: { groups: [{ monster: "srd-2024_nobody", count: 1 }] },
      },
      {
        label: "unknown join",
        args: { groups: [{ monster: SHADOW, count: 1, join: "Shadow 9" }] },
      },
      {
        label: "unknown room",
        args: { groups: [{ monster: SHADOW, count: 1, room: "Library" }] },
      },
    ];
    for (const c of cases) {
      const added = await call("add_monsters", c.args);
      const previewed = await call("preview_monsters", c.args);
      expect(added.isError, c.label).toBe(true);
      expect(previewed.isError, c.label).toBe(true);
      expect(text(previewed), c.label).toBe(text(added));
    }
  });
});
