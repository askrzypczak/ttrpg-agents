import {
  TableUnavailableError,
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

const sewers: TableMapItem = { ...trollskull, id: "map-2", name: "Sewers" };

function scene(...maps: TableMapItem[]): TableSceneMap {
  return { grid: { dpi: 150, type: "SQUARE" }, maps };
}

function contextWith(sceneMap: TablePort["sceneMap"]): ToolContext {
  return {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap,
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters: loadSrdMonsters(),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group",
    newCommandId: () => "command",
  };
}

async function useMap(
  ctx: ToolContext,
  args: unknown = {},
): Promise<ToolResult> {
  return tools.find((t) => t.name === "use_map")!.handler(ctx, args);
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

describe("use_map", () => {
  it("`use_map` reports the map name and its 32 x 24 grid with column and row labels for the Trollskull transform", async () => {
    const ctx = contextWith(() => Promise.resolve(scene(trollskull)));
    const r = await useMap(ctx);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Trollskull Manor");
    expect(text(r)).toContain("32 x 24");
    expect(text(r)).toContain("A-AF");
    expect(text(r)).toContain("1-24");
    expect(r.structuredContent).toEqual({
      itemId: "map-1",
      name: "Trollskull Manor",
      cols: 32,
      rows: 24,
    });
  });

  it("`use_map` passes `name` to pick among several maps", async () => {
    const ctx = contextWith(() => Promise.resolve(scene(trollskull, sewers)));
    const r = await useMap(ctx, { name: "sewers" });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Sewers");
    expect(r.structuredContent?.itemId).toBe("map-2");
  });

  it("`use_map` returns an `isError` result carrying the port's `TableUnavailableError` message", async () => {
    const message = "no Owlbear GM tab is connected to the bridge";
    const ctx = contextWith(() =>
      Promise.reject(new TableUnavailableError(message)),
    );
    const r = await useMap(ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(message);
  });
});
