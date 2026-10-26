import {
  TableUnavailableError,
  cellCenter,
  displayGrid,
  parseCellLabel,
  type MapPlacement,
  type MapRegistration,
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

const movedLine =
  "The map moved since it was registered; cells are read where it is now. Use the map again to confirm the new position.";

function scene(...maps: TableMapItem[]): TableSceneMap {
  return { grid: { dpi: 150, type: "SQUARE" }, maps };
}

function contextWith(
  sceneMap: TablePort["sceneMap"],
  active?: MapRegistration,
  sceneTokens: TablePort["sceneTokens"] = () =>
    Promise.reject(new Error("not stubbed")),
): ToolContext {
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  if (active) maps.registerMap(active);
  return {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap,
      sceneTokens,
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
  return r.content.map((c) => c.text).join("\n");
}

describe("room tools", () => {
  it("`set_rooms` saves the rooms with their ranges and status and reports each saved room with its ranges", async () => {
    const ctx = contextWith(
      () => Promise.resolve(scene(trollskull)),
      registered,
    );
    const r = await call(ctx, "set_rooms", {
      rooms: [
        { name: "Taproom", ranges: ["T5:AB11"] },
        { name: "Kitchen", ranges: ["A1:C3", "D1:D2"] },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(
      "Saved 2 rooms on Trollskull Manor (confirmed): Taproom T5:AB11; Kitchen A1:C3, D1:D2.",
    );
    expect(text(r)).not.toContain(movedLine);
    expect(r.structuredContent).toMatchObject({
      rooms: [
        { name: "Taproom", status: "confirmed", ranges: ["T5:AB11"] },
        { name: "Kitchen", status: "confirmed", ranges: ["A1:C3", "D1:D2"] },
      ],
      moved: false,
    });
    expect(
      ctx.maps.getRooms("map-1").map((room) => [room.name, room.status]),
    ).toEqual([
      ["Taproom", "confirmed"],
      ["Kitchen", "confirmed"],
    ]);

    const proposed = await call(ctx, "set_rooms", {
      rooms: [{ name: "Cellar", ranges: ["A20:C24"] }],
      status: "proposed",
    });
    expect(proposed.isError).toBeFalsy();
    expect(text(proposed)).toContain("on Trollskull Manor (proposed)");
    expect(text(proposed)).toContain("Cellar A20:C24");
    expect(ctx.maps.getRooms("map-1").at(-1)?.status).toBe("proposed");
  });

  it("`set_rooms` and `list_rooms` add the map-moved line when the live transform differs from the registered one", async () => {
    const ctx = contextWith(
      () => Promise.resolve(scene({ ...trollskull, scale: { x: 2, y: 2 } })),
      registered,
    );
    const set = await call(ctx, "set_rooms", {
      rooms: [{ name: "Taproom", ranges: ["AM9:BD22"] }],
    });
    expect(set.isError).toBeFalsy();
    expect(text(set)).toContain(movedLine);
    const listed = await call(ctx, "list_rooms");
    expect(listed.isError).toBeFalsy();
    expect(text(listed)).toContain("AM9:BD22");
    expect(text(listed)).toContain(movedLine);
  });

  it("`list_rooms` lists each room with its status and ranges, and says when the map has no rooms", async () => {
    const ctx = contextWith(
      () => Promise.resolve(scene(trollskull)),
      registered,
    );
    const empty = await call(ctx, "list_rooms");
    expect(empty.isError).toBeFalsy();
    expect(text(empty)).toContain("No rooms saved for Trollskull Manor yet.");

    await call(ctx, "set_rooms", {
      rooms: [{ name: "Kitchen", ranges: ["A1:C3", "D1:D2"] }],
    });
    await call(ctx, "set_rooms", {
      rooms: [{ name: "Taproom", ranges: ["T5:AB11"] }],
      status: "proposed",
    });
    const r = await call(ctx, "list_rooms");
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Rooms on Trollskull Manor:");
    expect(text(r)).toContain("| Room | Status | Cells |");
    expect(text(r)).toContain("| Kitchen | confirmed | A1:C3, D1:D2 |");
    expect(text(r)).toContain("| Taproom | proposed | T5:AB11 |");
    expect(text(r)).not.toContain(movedLine);
    expect(r.structuredContent).toMatchObject({
      rooms: [
        { name: "Kitchen", status: "confirmed", ranges: ["A1:C3", "D1:D2"] },
        { name: "Taproom", status: "proposed", ranges: ["T5:AB11"] },
      ],
      moved: false,
    });
  });

  it("`remove_rooms` reports the removed rooms", async () => {
    const ctx = contextWith(
      () => Promise.resolve(scene(trollskull)),
      registered,
    );
    await call(ctx, "set_rooms", {
      rooms: [
        { name: "Attic", ranges: ["A1"] },
        { name: "Taproom", ranges: ["T5:AB11"] },
        { name: "Cellar", ranges: ["A20:C24"] },
      ],
    });
    const r = await call(ctx, "remove_rooms", { names: ["Attic", "Cellar"] });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain(
      "Removed 2 rooms from Trollskull Manor: Attic, Cellar.",
    );
    expect(ctx.maps.getRooms("map-1").map((room) => room.name)).toEqual([
      "Taproom",
    ]);
  });

  it("without an active map, `set_rooms`, `list_rooms` and `remove_rooms` return an isError result telling the DM to use the map first", async () => {
    const ctx = contextWith(() => Promise.resolve(scene(trollskull)));
    const results = [
      await call(ctx, "set_rooms", {
        rooms: [{ name: "Taproom", ranges: ["T5:AB11"] }],
      }),
      await call(ctx, "list_rooms"),
      await call(ctx, "remove_rooms", { names: ["Taproom"] }),
    ];
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/use the map first/i);
    }
  });

  it("`set_rooms` and `list_rooms` return an isError result carrying the port's TableUnavailableError message", async () => {
    const message = "no Owlbear GM tab is connected to the bridge";
    const ctx = contextWith(
      () => Promise.reject(new TableUnavailableError(message)),
      registered,
    );
    const results = [
      await call(ctx, "set_rooms", {
        rooms: [{ name: "Taproom", ranges: ["T5:AB11"] }],
      }),
      await call(ctx, "list_rooms"),
    ];
    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(text(r)).toContain(message);
    }
  });
});

describe("add_monsters in a room", () => {
  const GOBLIN = "srd-2024_goblin-warrior";

  /** A one-cell token on the table covering a display cell of the map at `placement`. */
  function tokenOn(label: string, placement: MapPlacement): TableToken {
    const cell = displayGrid(placement).displayToSceneCell(
      parseCellLabel(label),
    );
    const centre = cellCenter(cell, placement.sceneDpi);
    const half = placement.sceneDpi / 2;
    return {
      bounds: {
        min: { x: centre.x - half, y: centre.y - half },
        max: { x: centre.x + half, y: centre.y + half },
      },
    };
  }

  /** The reply lines in order, each found after the previous one. */
  function expectInOrder(reply: string, lines: string[]): void {
    let from = 0;
    for (const line of lines) {
      const at = reply.indexOf(line, from);
      expect(at, `"${line}" after position ${String(from)}`).toBeGreaterThan(
        -1,
      );
      from = at + line.length;
    }
  }

  it("add_monsters with a room places the group and lists each placed monster's display cell", async () => {
    const ctx = contextWith(
      () => Promise.resolve(scene(trollskull)),
      registered,
      () => Promise.resolve({ tokens: [tokenOn("B1", registered.placement)] }),
    );
    await call(ctx, "set_rooms", {
      rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }],
    });
    const r = await call(ctx, "add_monsters", {
      groups: [{ monster: GOBLIN, count: 2, room: "kitchen" }],
    });
    expect(r.isError).toBeFalsy();
    const placements = r.structuredContent?.["placements"] as {
      name: string;
      room: string;
      cell: string | null;
    }[];
    expect(placements.map((p) => [p.name, p.room])).toEqual([
      ["Goblin Warrior 1", "Kitchen"],
      ["Goblin Warrior 2", "Kitchen"],
    ]);
    const [first, second] = placements.map((p) => p.cell);
    expect([first, second].sort()).toEqual(["A1", "C1"]);
    expect(r.structuredContent?.["moved"]).toBe(false);
    expectInOrder(text(r), [
      "| Goblin Warrior 2 |",
      `Placed in Kitchen: Goblin Warrior 1 at ${String(first)}, Goblin Warrior 2 at ${String(second)}.`,
      "Rolls:",
    ]);
    expect(text(r)).not.toContain("No free cell left");
    expect(text(r)).not.toContain(movedLine);
  });

  it("add_monsters lists the monsters left without a free cell and says their tokens appear in the row at the centre of the GM's view", async () => {
    const tokens: TableToken[] = [];
    const ctx = contextWith(
      () => Promise.resolve(scene(trollskull)),
      registered,
      () => Promise.resolve({ tokens }),
    );
    await call(ctx, "set_rooms", {
      rooms: [{ name: "Attic", ranges: ["A1"] }],
    });

    const several = await call(ctx, "add_monsters", {
      groups: [{ monster: GOBLIN, count: 3, room: "Attic" }],
    });
    expect(several.isError).toBeFalsy();
    expectInOrder(text(several), [
      "Placed in Attic: Goblin Warrior 1 at A1.",
      "No free cell left in Attic for Goblin Warrior 2, Goblin Warrior 3: their tokens appear in a row at the centre of the GM's view.",
      "Rolls:",
    ]);
    expect(
      (
        several.structuredContent?.["placements"] as { cell: string | null }[]
      ).map((p) => p.cell),
    ).toEqual(["A1", null, null]);

    tokens.push(tokenOn("A1", registered.placement));
    const one = await call(ctx, "add_monsters", {
      groups: [{ monster: GOBLIN, count: 1, room: "Attic" }],
    });
    expect(one.isError).toBeFalsy();
    expect(text(one)).toContain(
      "No free cell left in Attic for Goblin Warrior 4: its token appears in a row at the centre of the GM's view.",
    );
    expect(text(one)).not.toContain("Placed in Attic");
  });

  it("add_monsters gives each group with a room its own line, even in the same room", async () => {
    let groups = 0;
    const ctx: ToolContext = {
      ...contextWith(
        () => Promise.resolve(scene(trollskull)),
        registered,
        () => Promise.resolve({ tokens: [] }),
      ),
      // Unique per group, like the server's random UUIDs.
      newGroupId: () => `group-${String(++groups)}`,
    };
    await call(ctx, "set_rooms", {
      rooms: [{ name: "Kitchen", ranges: ["A1:C1"] }],
    });
    const r = await call(ctx, "add_monsters", {
      groups: [
        { monster: GOBLIN, count: 1, room: "Kitchen" },
        { monster: GOBLIN, count: 1, room: "kitchen" },
      ],
    });
    expect(r.isError).toBeFalsy();
    const [first, second] = (
      r.structuredContent?.["placements"] as { cell: string | null }[]
    ).map((p) => p.cell);
    expectInOrder(text(r), [
      `Placed in Kitchen: Goblin Warrior 1 at ${String(first)}.`,
      `Placed in Kitchen: Goblin Warrior 2 at ${String(second)}.`,
      "Rolls:",
    ]);
  });

  it("add_monsters with a room on a moved map adds the moved line", async () => {
    const moved = { ...trollskull, scale: { x: 2, y: 2 } };
    const ctx = contextWith(
      () => Promise.resolve(scene(moved)),
      registered,
      () => Promise.resolve({ tokens: [] }),
    );
    await call(ctx, "set_rooms", {
      rooms: [{ name: "Attic", ranges: ["A1"] }],
    });
    const r = await call(ctx, "add_monsters", {
      groups: [{ monster: GOBLIN, count: 1, room: "Attic" }],
    });
    expect(r.isError).toBeFalsy();
    expectInOrder(text(r), [
      "Placed in Attic: Goblin Warrior 1 at A1.",
      movedLine,
      "Rolls:",
    ]);
    expect(r.structuredContent?.["moved"]).toBe(true);
  });
});
