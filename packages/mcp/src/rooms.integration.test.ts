import {
  TableUnavailableError,
  type MapRegistration,
  type TableMapItem,
  type TablePort,
  type TableSceneMap,
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
): ToolContext {
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  if (active) maps.registerMap(active);
  return {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap,
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
