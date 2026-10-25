import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MapRegistration, SavedRoom } from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteMapRepository } from "./map-repository.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const trollskull: MapRegistration = {
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

/** The same map item after the GM moves, turns and rescales it. */
const trollskullRealigned: MapRegistration = {
  ...trollskull,
  placement: {
    ...trollskull.placement,
    position: { x: 300, y: -450 },
    rotation: 90,
    scale: { x: 1.05, y: 1.05 },
    imageOffset: { x: 12, y: 8 },
  },
};

const sewers: MapRegistration = {
  itemId: "map-2",
  name: "Sewers",
  placement: {
    position: { x: 1500, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    imageOffset: { x: 0, y: 0 },
    imageWidth: 2000,
    imageHeight: 1500,
    imageDpi: 100,
    sceneDpi: 150,
  },
};

/** An L-shaped room: two rectangles, with fractional image-px vertices. */
const taproom: SavedRoom = {
  name: "Taproom",
  status: "confirmed",
  polygons: [
    [
      { x: 500, y: 1250.5 },
      { x: 1100, y: 1250.5 },
      { x: 1100, y: 2000 },
      { x: 500, y: 2000 },
    ],
    [
      { x: 1100, y: 1250.5 },
      { x: 1400.25, y: 1250.5 },
      { x: 1400.25, y: 1500 },
      { x: 1100, y: 1500 },
    ],
  ],
};

const kitchen: SavedRoom = {
  name: "kitchen",
  status: "proposed",
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 360, y: 0 },
      { x: 360, y: 360 },
    ],
  ],
};

const cellar: SavedRoom = {
  name: "Cellar",
  status: "confirmed",
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ],
  ],
};

describe("SqliteMapRepository", () => {
  it("a new store has no active map", () => {
    const repo = new SqliteMapRepository(openDatabase(":memory:"));
    expect(repo.getActiveMap()).toBeUndefined();
  });

  it("a registered map survives reopening the store as the active map", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-map-"));
    dirs.push(dir);
    const path = join(dir, "enc.db");
    const first = openDatabase(path);
    new SqliteMapRepository(first).registerMap(trollskull);
    first.close();

    const second = openDatabase(path);
    expect(new SqliteMapRepository(second).getActiveMap()).toEqual(trollskull);
    second.close();
  });

  it("re-registering the same map item replaces its transform and makes it active again", () => {
    const repo = new SqliteMapRepository(openDatabase(":memory:"));
    repo.registerMap(trollskull);
    repo.registerMap(sewers);
    expect(repo.getActiveMap()).toEqual(sewers);
    repo.registerMap(trollskullRealigned);
    expect(repo.getActiveMap()).toEqual(trollskullRealigned);
  });

  it("re-registering the same map item updates its row in place (the row is not deleted)", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteMapRepository(db);
    const rowid = (): unknown =>
      (
        db
          .prepare("SELECT rowid FROM map_registrations WHERE item_id = ?")
          .get("map-1") as { rowid: unknown } | undefined
      )?.rowid;
    repo.registerMap(trollskull);
    repo.registerMap(sewers);
    const before = rowid();
    expect(before).toBeDefined();
    repo.registerMap(trollskullRealigned);
    expect(rowid()).toBe(before);
  });

  it("a map item without saved rooms has no rooms", () => {
    const repo = new SqliteMapRepository(openDatabase(":memory:"));
    repo.registerMap(trollskull);
    expect(repo.getRooms("map-1")).toEqual([]);
  });

  it("replaceRooms stores each room's name, status and image-px polygons, and getRooms returns them in the order saved", () => {
    const repo = new SqliteMapRepository(openDatabase(":memory:"));
    repo.registerMap(trollskull);
    repo.replaceRooms("map-1", [taproom, kitchen, cellar]);
    expect(repo.getRooms("map-1")).toEqual([taproom, kitchen, cellar]);
    repo.replaceRooms("map-1", [cellar, taproom]);
    expect(repo.getRooms("map-1")).toEqual([cellar, taproom]);
  });

  it("replaceRooms replaces only that map item's rooms; another map's rooms are untouched", () => {
    const repo = new SqliteMapRepository(openDatabase(":memory:"));
    repo.registerMap(trollskull);
    repo.registerMap(sewers);
    repo.replaceRooms("map-1", [taproom, kitchen]);
    repo.replaceRooms("map-2", [cellar]);
    repo.replaceRooms("map-1", [kitchen]);
    expect(repo.getRooms("map-1")).toEqual([kitchen]);
    expect(repo.getRooms("map-2")).toEqual([cellar]);
  });

  it("rooms survive reopening the store and re-registering the same map item", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-map-"));
    dirs.push(dir);
    const path = join(dir, "enc.db");
    const first = openDatabase(path);
    const before = new SqliteMapRepository(first);
    before.registerMap(trollskull);
    before.replaceRooms("map-1", [taproom, kitchen]);
    first.close();

    const second = openDatabase(path);
    const after = new SqliteMapRepository(second);
    expect(after.getRooms("map-1")).toEqual([taproom, kitchen]);
    after.registerMap(sewers);
    after.registerMap(trollskullRealigned);
    expect(after.getRooms("map-1")).toEqual([taproom, kitchen]);
    second.close();
  });
});
