import type { MapRegistration, TableMapItem } from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  SqliteMapRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

/** A 10 x 10 cell map, unrotated, at 100 dpi on a 100-unit grid. */
const registered: MapRegistration = {
  itemId: "map-1",
  name: "Manor",
  placement: {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    imageOffset: { x: 0, y: 0 },
    imageWidth: 1000,
    imageHeight: 1000,
    imageDpi: 100,
    sceneDpi: 100,
  },
};

/** The same map item, moved three cells to the right since it was registered. */
const movedItem: TableMapItem = {
  id: "map-1",
  name: "Manor",
  imageWidth: 1000,
  imageHeight: 1000,
  imageDpi: 100,
  imageOffset: { x: 0, y: 0 },
  position: { x: 300, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
};

const movedLine =
  "The map moved since it was registered; cells are read where it is now. Use the map again to confirm the new position.";

function context(): ToolContext {
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  maps.registerMap(registered);
  return {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () =>
        Promise.resolve({
          grid: { dpi: 100, type: "SQUARE" },
          maps: [movedItem],
        }),
      sceneTokens: () => Promise.resolve({ tokens: [] }),
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
  args: unknown,
): Promise<ToolResult> {
  return tools.find((t) => t.name === name)!.handler(ctx, args);
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

describe("move_monsters on a moved map", () => {
  it("move_monsters says the map moved when it moved since it was registered", async () => {
    const ctx = context();
    expect(
      (
        await call(ctx, "add_monsters", {
          groups: [{ monster: "srd-2024_goblin-warrior", count: 1 }],
        })
      ).isError,
    ).toBeFalsy();
    expect(
      (
        await call(ctx, "set_rooms", {
          rooms: [{ name: "Attic", ranges: ["A1"] }],
        })
      ).isError,
    ).toBeFalsy();

    const r = await call(ctx, "move_monsters", {
      targets: ["Goblin Warrior 1"],
      room: "Attic",
    });

    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Moved into Attic: Goblin Warrior 1 at A1.");
    expect(text(r)).toContain(movedLine);
    expect(r.structuredContent?.["moved"]).toBe(true);
  });
});
