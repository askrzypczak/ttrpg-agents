import { describe, expect, it } from "vitest";
import {
  MapSelectionError,
  UnknownInstanceError,
  UnknownRoomError,
  cellRangeToPolygon,
  moveMonstersIntoRoom,
  parseCellRange,
  type ChangeOrigin,
  type EncounterRepository,
  type MapPlacement,
  type MapRegistration,
  type MapRepository,
  type MonsterInstance,
  type Point,
  type SavedRoom,
  type TableMapItem,
  type TablePort,
  type TableSceneMap,
  type TableToken,
} from "../index.js";
import { makeTestInstance } from "../testing/index.js";

const origin: ChangeOrigin = { source: "mcp", commandId: "c1" };

/**
 * A 10 x 10 cell map, unrotated, at scene (200, 100) on a 100-unit grid with
 * 100 image px per cell: display cell A1 is scene cell (2, 1), centred at
 * (250, 150); B1 at (350, 150); C1 at (450, 150).
 */
const placement: MapPlacement = {
  position: { x: 200, y: 100 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  imageOffset: { x: 0, y: 0 },
  imageWidth: 1000,
  imageHeight: 1000,
  imageDpi: 100,
  sceneDpi: 100,
};

const registered: MapRegistration = {
  itemId: "map-1",
  name: "Manor",
  placement,
};

function mapItem(at: MapPlacement): TableMapItem {
  return {
    id: "map-1",
    name: "Manor",
    imageWidth: at.imageWidth,
    imageHeight: at.imageHeight,
    imageDpi: at.imageDpi,
    imageOffset: at.imageOffset,
    position: at.position,
    rotation: at.rotation,
    scale: at.scale,
  };
}

function scene(...maps: TableMapItem[]): TableSceneMap {
  return { grid: { dpi: 100, type: "SQUARE" }, maps };
}

function room(name: string, range: string): SavedRoom {
  return {
    name,
    status: "confirmed",
    polygons: [cellRangeToPolygon(placement, parseCellRange(range))],
  };
}

/** Three cells in a row: A1, B1 and C1. */
const taproom = room("Taproom", "A1:C1");
/** One cell: E5, scene cell (6, 5), centred at (650, 550). */
const attic = room("Attic", "E5");

const cellCentres: Record<string, Point> = {
  A1: { x: 250, y: 150 },
  B1: { x: 350, y: 150 },
  C1: { x: 450, y: 150 },
  E5: { x: 650, y: 550 },
};

/** Where the seeded monsters start: display cell J10, outside every room. */
const start: Point = { x: 1150, y: 1050 };

/** A table that answers with the given scene and tokens and counts the questions. */
function tableWith(
  answer: TableSceneMap,
  tokens: TableToken[] = [],
): Pick<TablePort, "sceneMap" | "sceneTokens"> & {
  sceneMapCalls: number;
  sceneTokensCalls: number;
} {
  const table = {
    sceneMapCalls: 0,
    sceneTokensCalls: 0,
    sceneMap: () => {
      table.sceneMapCalls += 1;
      return Promise.resolve(answer);
    },
    sceneTokens: () => {
      table.sceneTokensCalls += 1;
      return Promise.resolve({ tokens });
    },
  };
  return table;
}

/** An in-memory map repository holding one active map and its rooms. */
function mapsWith(
  active: MapRegistration | undefined,
  rooms: SavedRoom[] = [],
): Pick<MapRepository, "getActiveMap" | "getRooms"> {
  return {
    getActiveMap: () => active,
    getRooms: (itemId) =>
      active && itemId === active.itemId ? structuredClone(rooms) : [],
  };
}

type SpawnWrite = Parameters<EncounterRepository["setSpawnPositions"]>;

/** An in-memory encounter store that records each `setSpawnPositions` call. */
class MemoryEncounter implements Pick<
  EncounterRepository,
  "listInstances" | "setSpawnPositions"
> {
  readonly stored: MonsterInstance[];
  readonly writes: { positions: SpawnWrite[0]; origin: ChangeOrigin }[] = [];

  constructor(instances: MonsterInstance[]) {
    this.stored = structuredClone(instances);
  }

  listInstances(): MonsterInstance[] {
    return structuredClone(this.stored);
  }

  setSpawnPositions(
    positions: SpawnWrite[0],
    writeOrigin: ChangeOrigin,
  ): MonsterInstance[] {
    this.writes.push({
      positions: structuredClone(positions),
      origin: writeOrigin,
    });
    const found = positions.map(({ id }) => {
      const instance = this.stored.find((i) => i.id === id);
      if (instance === undefined)
        throw new UnknownInstanceError(`Unknown instance "${id}"`);
      return instance;
    });
    positions.forEach(({ spawnPosition }, n) => {
      (found[n] as MonsterInstance).spawnPosition = { ...spawnPosition };
    });
    return structuredClone(found);
  }
}

let created = 0;

function monster(
  id: string,
  displayName: string,
  over: Partial<MonsterInstance> = {},
): MonsterInstance {
  return makeTestInstance({
    id,
    displayName,
    monsterKey: "goblin",
    maxHp: 7,
    currentHp: 5,
    initiative: 12,
    createdAt: ++created,
    spawnPosition: start,
    ...over,
  });
}

const goblins = [
  monster("g1", "Goblin 1"),
  monster("g2", "Goblin 2"),
  monster("g3", "Goblin 3"),
];
const bandits = [
  monster("b1", "Bandit 1", { monsterKey: "bandit", initiative: 8 }),
  monster("b2", "Bandit 2", { monsterKey: "bandit", initiative: 8 }),
];
const ogre = monster("o1", "Ogre 1", {
  monsterKey: "ogre",
  footprint: 2,
  maxHp: 59,
  currentHp: 40,
  initiative: 3,
});

function setup(
  options: {
    active?: MapRegistration | undefined;
    rooms?: SavedRoom[];
    scene?: TableSceneMap;
    tokens?: TableToken[];
  } = {},
) {
  const repo = new MemoryEncounter([...goblins, ...bandits, ogre]);
  const table = tableWith(
    options.scene ?? scene(mapItem(placement)),
    options.tokens ?? [],
  );
  const maps = mapsWith(
    "active" in options ? options.active : registered,
    options.rooms ?? [taproom, attic],
  );
  return { repo, table, deps: { repo, table, maps } };
}

function spawnOf(repo: MemoryEncounter, id: string): unknown {
  return repo.listInstances().find((i) => i.id === id)?.spawnPosition;
}

describe("moveMonstersIntoRoom", () => {
  it("moveMonstersIntoRoom places each named monster on a free cell whose centre is inside the room", async () => {
    const { deps, repo } = setup();
    const result = await moveMonstersIntoRoom(
      deps,
      ["g1", "g2", "g3"],
      "Taproom",
      origin,
    );
    expect(result.placements.map((p) => p.cell).sort()).toEqual([
      "A1",
      "B1",
      "C1",
    ]);
    for (const p of result.placements) {
      expect(spawnOf(repo, p.id)).toEqual(cellCentres[p.cell ?? ""]);
    }
  });

  it("moveMonstersIntoRoom does not pick a cell whose centre lies inside a token's bounds on the table", async () => {
    // B1 (the middle of the room) is the cell the picker would choose first.
    const { deps } = setup({
      tokens: [
        { bounds: { min: { x: 300, y: 100 }, max: { x: 400, y: 200 } } },
      ],
    });
    const result = await moveMonstersIntoRoom(
      deps,
      ["g1", "g2"],
      "Taproom",
      origin,
    );
    expect(result.placements.map((p) => p.cell).sort()).toEqual(["A1", "C1"]);
  });

  it("moveMonstersIntoRoom puts a Large monster on a free 2 x 2 block, at the block's centre", async () => {
    // Den A1:B2 is scene cols 2..3, rows 1..2: one 2 x 2 block centred (300, 200).
    const { deps, repo } = setup({ rooms: [room("Den", "A1:B2")] });
    const result = await moveMonstersIntoRoom(deps, ["o1"], "Den", origin);
    expect(result.placements).toEqual([
      { id: "o1", name: "Ogre 1", room: "Den", cell: "A1:B2" },
    ]);
    expect(spawnOf(repo, "o1")).toEqual({ x: 300, y: 200 });
  });

  it("moveMonstersIntoRoom places the largest footprint first, ties in input order, and keeps the placements in input order", async () => {
    // Hall A1:B3 is scene cols 2..3, rows 1..3. Placing the bandits first
    // would take A2 and leave no free 2 x 2 block.
    const { deps, repo } = setup({ rooms: [room("Hall", "A1:B3")] });
    const result = await moveMonstersIntoRoom(
      deps,
      ["b1", "b2", "o1"],
      "Hall",
      origin,
    );
    expect(result.placements.map((p) => [p.name, p.room, p.cell])).toEqual([
      ["Bandit 1", "Hall", "A3"],
      ["Bandit 2", "Hall", "B3"],
      ["Ogre 1", "Hall", "A1:B2"],
    ]);
    expect(result.placements.map((p) => p.id)).toEqual(["b1", "b2", "o1"]);
    expect(["b1", "b2", "o1"].map((id) => spawnOf(repo, id))).toEqual([
      { x: 250, y: 350 },
      { x: 350, y: 350 },
      { x: 300, y: 200 },
    ]);

    // The same bandits named the other way round swap cells.
    const swapped = setup({ rooms: [room("Hall", "A1:B3")] });
    const again = await moveMonstersIntoRoom(
      swapped.deps,
      ["b2", "b1", "o1"],
      "Hall",
      origin,
    );
    expect(again.placements.map((p) => [p.name, p.cell])).toEqual([
      ["Bandit 2", "A3"],
      ["Bandit 1", "B3"],
      ["Ogre 1", "A1:B2"],
    ]);
  });

  it("moveMonstersIntoRoom stores the placed monsters' new spawn positions in one store write", async () => {
    const { deps, repo } = setup();
    const result = await moveMonstersIntoRoom(
      deps,
      ["g1", "g2", "g3"],
      "Taproom",
      origin,
    );
    expect(repo.writes).toHaveLength(1);
    expect(repo.writes[0]?.origin).toEqual(origin);
    const written = new Map(
      (repo.writes[0]?.positions ?? []).map((p) => [p.id, p.spawnPosition]),
    );
    expect([...written.keys()].sort()).toEqual(["g1", "g2", "g3"]);
    for (const p of result.placements) {
      expect(written.get(p.id)).toEqual(cellCentres[p.cell ?? ""]);
    }
  });

  it("moveMonstersIntoRoom gives each placed monster its display cell label and the saved room's name", async () => {
    const { deps } = setup();
    const result = await moveMonstersIntoRoom(deps, ["g1"], "taproom", origin);
    expect(result).toEqual({
      placements: [{ id: "g1", name: "Goblin 1", room: "Taproom", cell: "B1" }],
      moved: false,
    });
  });

  it("a monster that finds no free cell gets cell null and no new spawn position", async () => {
    // The attic holds one cell.
    const { deps, repo } = setup();
    const result = await moveMonstersIntoRoom(
      deps,
      ["g1", "g2", "g3"],
      "Attic",
      origin,
    );
    expect(result.placements.map((p) => [p.name, p.room, p.cell])).toEqual([
      ["Goblin 1", "Attic", "E5"],
      ["Goblin 2", "Attic", null],
      ["Goblin 3", "Attic", null],
    ]);
    expect(["g1", "g2", "g3"].map((id) => spawnOf(repo, id))).toEqual([
      cellCentres["E5"],
      start,
      start,
    ]);
    expect(repo.writes.map((w) => w.positions.map((p) => p.id))).toEqual([
      ["g1"],
    ]);

    // A Large monster in the 3 x 1 taproom fits nowhere: nothing is written.
    const strip = setup();
    const none = await moveMonstersIntoRoom(
      strip.deps,
      ["o1"],
      "Taproom",
      origin,
    );
    expect(none.placements).toEqual([
      { id: "o1", name: "Ogre 1", room: "Taproom", cell: null },
    ]);
    expect(strip.repo.writes).toEqual([]);
    expect(spawnOf(strip.repo, "o1")).toEqual(start);
  });

  it("moveMonstersIntoRoom keeps each moved instance's id, HP, initiative and name", async () => {
    const { deps, repo } = setup({ rooms: [room("Hall", "A1:B3")] });
    const before = repo.listInstances();
    await moveMonstersIntoRoom(deps, ["b1", "b2", "o1"], "Hall", origin);
    const after = repo.listInstances();
    const fields = (i: MonsterInstance) => [
      i.id,
      i.displayName,
      i.currentHp,
      i.maxHp,
      i.initiative,
    ];
    expect(after.map(fields)).toEqual(before.map(fields));
    expect(
      ["b1", "b2", "o1"].map((id) => spawnOf(repo, id)),
    ).not.toContainEqual(start);
  });

  it("an unknown id fails with UnknownInstanceError before the table is asked and moves nothing", async () => {
    const { deps, repo, table } = setup();
    const attempt = moveMonstersIntoRoom(
      deps,
      ["g1", "missing"],
      "Taproom",
      origin,
    );
    await expect(attempt).rejects.toBeInstanceOf(UnknownInstanceError);
    expect(table.sceneMapCalls).toBe(0);
    expect(table.sceneTokensCalls).toBe(0);
    expect(repo.writes).toEqual([]);
  });

  it("no map in use fails and moves nothing", async () => {
    const { deps, repo, table } = setup({ active: undefined });
    const attempt = moveMonstersIntoRoom(deps, ["g1"], "Taproom", origin);
    await expect(attempt).rejects.toBeInstanceOf(MapSelectionError);
    await expect(attempt).rejects.toThrow(
      "No map is in use: use the map first.",
    );
    expect(table.sceneMapCalls).toBe(0);
    expect(repo.writes).toEqual([]);
  });

  it("an unknown room fails listing the known rooms and moves nothing", async () => {
    const { deps, repo, table } = setup();
    const attempt = moveMonstersIntoRoom(deps, ["g1"], "Library", origin);
    await expect(attempt).rejects.toBeInstanceOf(UnknownRoomError);
    await expect(attempt).rejects.toThrow(
      'Unknown room "Library"; known rooms: Taproom, Attic.',
    );
    expect(table.sceneMapCalls).toBe(0);
    expect(repo.writes).toEqual([]);
  });

  it("a moved map places with the live transform and flags the move", async () => {
    // Moved three cells to the right: B1 is now scene cell (6, 1).
    const live: MapPlacement = { ...placement, position: { x: 500, y: 100 } };
    const { deps, repo } = setup({ scene: scene(mapItem(live)) });
    const result = await moveMonstersIntoRoom(deps, ["g1"], "Taproom", origin);
    expect(result.moved).toBe(true);
    expect(result.placements.map((p) => p.cell)).toEqual(["B1"]);
    expect(spawnOf(repo, "g1")).toEqual({ x: 650, y: 150 });
  });
});
