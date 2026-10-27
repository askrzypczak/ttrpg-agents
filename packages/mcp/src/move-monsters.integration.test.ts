import {
  cellCenter,
  displayGrid,
  parseCellLabel,
  type MapPlacement,
  type MapRegistration,
  type Point,
  type TableMapItem,
  type TablePort,
  type TableSceneMap,
  type TableToken,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  SqliteMapRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

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

/** Trollskull as registered by `use_map`, at scale 1x. */
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

const GOBLIN = "srd-2024_goblin-warrior";

function scene(...maps: TableMapItem[]): TableSceneMap {
  return { grid: { dpi: 150, type: "SQUARE" }, maps };
}

function contextWith(sceneTokens: TablePort["sceneTokens"]): ToolContext {
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  maps.registerMap(registered);
  return {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.resolve(scene(trollskull)),
      sceneTokens,
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    maps,
    monsters: loadSrdMonsters(),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group",
    newCommandId: () => "command",
  };
}

async function call(
  ctx: ToolContext,
  name: string,
  args: unknown = {},
): Promise<ToolResult> {
  return tools.find((t) => t.name === name)!.handler(ctx, args);
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

/** The scene centre of a display cell of the map at `placement`. */
function centreOf(label: string, placement: MapPlacement): Point {
  const cell = displayGrid(placement).displayToSceneCell(parseCellLabel(label));
  return cellCenter(cell, placement.sceneDpi);
}

/** A one-cell token on the table covering a display cell of the map at `placement`. */
function tokenOn(label: string, placement: MapPlacement): TableToken {
  const centre = centreOf(label, placement);
  const half = placement.sceneDpi / 2;
  return {
    bounds: {
      min: { x: centre.x - half, y: centre.y - half },
      max: { x: centre.x + half, y: centre.y + half },
    },
  };
}

/** Adds `count` goblin warriors without a room and saves the rooms; answers the instance ids. */
async function seed(
  ctx: ToolContext,
  count: number,
  rooms: { name: string; ranges: string[] }[],
): Promise<string[]> {
  const added = await call(ctx, "add_monsters", {
    groups: [{ monster: GOBLIN, count }],
  });
  expect(added.isError).toBeFalsy();
  const saved = await call(ctx, "set_rooms", { rooms });
  expect(saved.isError).toBeFalsy();
  return ctx.repo.listInstances().map((i) => i.id);
}

function spawnOf(ctx: ToolContext, id: string): unknown {
  return ctx.repo.listInstances().find((i) => i.id === id)?.spawnPosition;
}

type Placement = {
  id: string;
  name: string;
  room: string;
  cell: string | null;
};

describe("move_monsters", () => {
  it("move_monsters by id reports each monster's new cell in the room", async () => {
    const ctx = contextWith(() =>
      Promise.resolve({ tokens: [tokenOn("B1", registered.placement)] }),
    );
    const [first, second] = await seed(ctx, 2, [
      { name: "Kitchen", ranges: ["A1:C1"] },
    ]);

    const r = await call(ctx, "move_monsters", {
      targets: [first, second],
      room: "kitchen",
    });

    expect(r.isError).toBeFalsy();
    const placements = r.structuredContent?.["placements"] as Placement[];
    expect(placements.map((p) => [p.id, p.name, p.room])).toEqual([
      [first, "Goblin Warrior 1", "Kitchen"],
      [second, "Goblin Warrior 2", "Kitchen"],
    ]);
    const [a, b] = placements.map((p) => p.cell);
    expect([a, b].sort()).toEqual(["A1", "C1"]);
    expect(r.structuredContent?.["mapMoved"]).toBe(false);
    expect(text(r)).toContain(
      `Moved into Kitchen: Goblin Warrior 1 at ${String(a)}, Goblin Warrior 2 at ${String(b)}.`,
    );
    expect(text(r)).not.toContain("No free cell left");
    expect(spawnOf(ctx, first ?? "")).toEqual(
      centreOf(String(a), registered.placement),
    );
    expect(spawnOf(ctx, second ?? "")).toEqual(
      centreOf(String(b), registered.placement),
    );
  });

  it("move_monsters by exact name moves that monster", async () => {
    const ctx = contextWith(() => Promise.resolve({ tokens: [] }));
    const [first, second] = await seed(ctx, 2, [
      { name: "Attic", ranges: ["A1"] },
    ]);

    const r = await call(ctx, "move_monsters", {
      targets: ["Goblin Warrior 2"],
      room: "Attic",
    });

    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Moved into Attic: Goblin Warrior 2 at A1.");
    expect(r.structuredContent?.["placements"]).toEqual([
      { id: second, name: "Goblin Warrior 2", room: "Attic", cell: "A1" },
    ]);
    expect(spawnOf(ctx, second ?? "")).toEqual(
      centreOf("A1", registered.placement),
    );
    expect(spawnOf(ctx, first ?? "")).toBeNull();
  });

  it("move_monsters with an unknown or ambiguous target moves nothing", async () => {
    const ctx = contextWith(() => Promise.resolve({ tokens: [] }));
    const [first] = await seed(ctx, 1, [
      { name: "Kitchen", ranges: ["A1:C1"] },
    ]);

    const unknown = await call(ctx, "move_monsters", {
      targets: ["Goblin Warrior 1", "Ghost"],
      room: "Kitchen",
    });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('Unknown target "Ghost"');
    expect(text(unknown).endsWith(". Nothing was moved.")).toBe(true);
    expect(spawnOf(ctx, first ?? "")).toBeNull();

    ctx.repo.addInstances(
      () => [
        { monsterKey: GOBLIN, displayName: "Twin", maxHp: 10 },
        { monsterKey: GOBLIN, displayName: "Twin", maxHp: 10 },
      ],
      { source: "mcp", commandId: "seed" },
    );
    const ambiguous = await call(ctx, "move_monsters", {
      targets: ["Goblin Warrior 1", "Twin"],
      room: "Kitchen",
    });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toContain("Ambiguous");
    expect(text(ambiguous).endsWith(". Nothing was moved.")).toBe(true);
    expect(ctx.repo.listInstances().map((i) => i.spawnPosition)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("move_monsters lists the monsters left without a free cell and says they stay where they are", async () => {
    const tokens: TableToken[] = [];
    const ctx = contextWith(() => Promise.resolve({ tokens }));
    const ids = await seed(ctx, 3, [{ name: "Attic", ranges: ["A1"] }]);

    const several = await call(ctx, "move_monsters", {
      targets: ids,
      room: "Attic",
    });
    expect(several.isError).toBeFalsy();
    const reply = text(several);
    const moved = reply.indexOf("Moved into Attic: Goblin Warrior 1 at A1.");
    const stayed = reply.indexOf(
      "No free cell left in Attic for Goblin Warrior 2, Goblin Warrior 3: they stay where they are.",
    );
    expect(moved).toBeGreaterThan(-1);
    expect(stayed).toBeGreaterThan(moved);
    expect(
      (several.structuredContent?.["placements"] as Placement[]).map(
        (p) => p.cell,
      ),
    ).toEqual(["A1", null, null]);
    expect(ids.map((id) => spawnOf(ctx, id))).toEqual([
      centreOf("A1", registered.placement),
      null,
      null,
    ]);

    tokens.push(tokenOn("A1", registered.placement));
    const one = await call(ctx, "move_monsters", {
      targets: ["Goblin Warrior 2"],
      room: "Attic",
    });
    expect(one.isError).toBeFalsy();
    expect(text(one)).toContain(
      "No free cell left in Attic for Goblin Warrior 2: it stays where it is.",
    );
    expect(text(one)).not.toContain("Moved into Attic");
  });
});
