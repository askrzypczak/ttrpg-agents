import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MapRegistration } from "@ttrpg-agents/engine";
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
});
