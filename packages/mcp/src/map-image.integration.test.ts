import {
  type MapRegistration,
  type TableMapImage,
  type TableMapItem,
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

const image: TableMapImage = {
  mimeType: "image/jpeg",
  data: "/9j/4AAQSkZJRg==",
  width: 1600,
  height: 1200,
};

const movedLine =
  "The map moved since it was registered; cells are read where it is now. Use the map again to confirm the new position.";

function scene(...maps: TableMapItem[]): TableSceneMap {
  return { grid: { dpi: 150, type: "SQUARE" }, maps };
}

/** A context whose table answers the scene and the image, recording the image requests. */
function contextWith(answer: TableSceneMap): {
  ctx: ToolContext;
  imageCalls: string[];
} {
  const imageCalls: string[] = [];
  const maps = new SqliteMapRepository(openDatabase(":memory:"));
  maps.registerMap(registered);
  const ctx: ToolContext = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.resolve(answer),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: (itemId) => {
        imageCalls.push(itemId);
        return Promise.resolve(image);
      },
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    maps,
    monsters: loadSrdMonsters(),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group",
    newCommandId: () => "command",
  };
  return { ctx, imageCalls };
}

async function getMapImage(ctx: ToolContext): Promise<ToolResult> {
  return tools.find((t) => t.name === "get_map_image")!.handler(ctx, {});
}

function textBlocks(r: ToolResult): string[] {
  return r.content.flatMap((c) => (c.type === "text" ? [c.text] : []));
}

describe("get_map_image", () => {
  it("get_map_image returns an image content block with the table's data and mime type, and a text line with the grid size", async () => {
    const { ctx, imageCalls } = contextWith(scene(trollskull));
    const r = await getMapImage(ctx);
    expect(r.isError).toBeFalsy();
    expect(r.content).toEqual([
      { type: "image", data: image.data, mimeType: "image/jpeg" },
      {
        type: "text",
        text: "Trollskull Manor: 32 x 24 cells, columns A-AF left to right, rows 1-24 top to bottom, labelled on the image's edges.",
      },
    ]);
    expect(r.structuredContent).toEqual({
      itemId: "map-1",
      name: "Trollskull Manor",
      cols: 32,
      rows: 24,
      mapMoved: false,
      width: 1600,
      height: 1200,
    });
    expect(imageCalls).toEqual(["map-1"]);
  });

  it("get_map_image adds the moved line when the map moved since it was registered", async () => {
    const { ctx } = contextWith(
      scene({ ...trollskull, scale: { x: 2, y: 2 } }),
    );
    const r = await getMapImage(ctx);
    expect(r.isError).toBeFalsy();
    expect(r.content[0]).toEqual({
      type: "image",
      data: image.data,
      mimeType: "image/jpeg",
    });
    expect(textBlocks(r)).toEqual([
      `Trollskull Manor: 64 x 48 cells, columns A-BL left to right, rows 1-48 top to bottom, labelled on the image's edges.\n\n${movedLine}`,
    ]);
    expect(r.structuredContent).toMatchObject({ mapMoved: true });
  });
});
