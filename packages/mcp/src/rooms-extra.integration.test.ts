import type {
  MapRegistration,
  TableMapItem,
  TableSceneMap,
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

describe("list_rooms cells", () => {
  it("`list_rooms` shows - for a room that covers no cell under the live transform", async () => {
    let live: TableSceneMap = {
      grid: { dpi: 150, type: "SQUARE" },
      maps: [trollskull],
    };
    const maps = new SqliteMapRepository(openDatabase(":memory:"));
    maps.registerMap(registered);
    const ctx: ToolContext = {
      table: {
        sceneStatus: () => Promise.reject(new Error("not stubbed")),
        sceneMap: () => Promise.resolve(live),
      },
      repo: new SqliteEncounterRepository(openDatabase(":memory:")),
      maps,
      monsters: loadSrdMonsters(),
      rng: { nextInt: () => 0 },
      now: () => new Date("2026-01-01T00:00:00Z"),
      newGroupId: () => "group",
      newCommandId: () => "command",
    };
    const saved = await call(ctx, "set_rooms", {
      rooms: [{ name: "Closet", ranges: ["A1"] }],
    });
    expect(saved.isError).toBeFalsy();

    live = { ...live, maps: [{ ...trollskull, scale: { x: 0.4, y: 0.4 } }] };
    const r = await call(ctx, "list_rooms");
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("| Closet | confirmed | - |");
  });
});
