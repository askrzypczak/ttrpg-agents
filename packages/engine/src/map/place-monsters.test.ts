import { describe, expect, it } from "vitest";
import {
  AddMonstersError,
  MapSelectionError,
  UnknownRoomError,
  addMonsters,
  addMonstersInRooms,
  cellRangeToPolygon,
  parseCellRange,
  previewMonsters,
  previewMonstersInRooms,
  type AddMonstersDeps,
  type AddMonstersOptions,
  type ChangeOrigin,
  type EncounterRepository,
  type Encounter,
  type HpChange,
  type InstanceBuilder,
  type MapPlacement,
  type MapRegistration,
  type MapRepository,
  type Monster,
  type MonsterIndex,
  type MonsterInstance,
  type RemovedInstance,
  type RoomGroup,
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

const cellCentres: Record<string, { x: number; y: number }> = {
  A1: { x: 250, y: 150 },
  B1: { x: 350, y: 150 },
  C1: { x: 450, y: 150 },
  E5: { x: 650, y: 550 },
};

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

/** An in-memory encounter store: `addInstances` builds the items and keeps them. */
class MemoryEncounter implements EncounterRepository {
  readonly stored: MonsterInstance[] = [];
  addCalls = 0;

  getOrCreateActiveEncounter(): Encounter {
    return { id: "e1", createdAt: 0 };
  }

  addInstances(build: InstanceBuilder): MonsterInstance[] {
    this.addCalls += 1;
    const items = build(this.stored.map((i) => i.displayName));
    const added = items.map((item, n) =>
      makeTestInstance({
        id: `i${String(this.stored.length + n + 1)}`,
        monsterKey: item.monsterKey,
        displayName: item.displayName,
        maxHp: item.maxHp,
        currentHp: item.maxHp,
        initiative: item.initiative ?? null,
        armorClass: item.armorClass ?? null,
        groupId: item.groupId ?? null,
        footprint: item.footprint ?? 1,
        statsVisible: item.statsVisible ?? false,
        spawnPosition: item.spawnPosition ?? null,
      }),
    );
    this.stored.push(...added);
    return added;
  }

  listInstances(): MonsterInstance[] {
    return structuredClone(this.stored);
  }

  applyDamage(): HpChange {
    throw new Error("unused");
  }
  applyHealing(): HpChange {
    throw new Error("unused");
  }
  removeInstances(): MonsterInstance[] {
    throw new Error("unused");
  }
  listRemovedInstances(): RemovedInstance[] {
    throw new Error("unused");
  }
  restoreInstances(): MonsterInstance[] {
    throw new Error("unused");
  }
  renameInstance(): MonsterInstance {
    throw new Error("unused");
  }
  setInitiative(): MonsterInstance {
    throw new Error("unused");
  }
  setGroupId(): MonsterInstance {
    throw new Error("unused");
  }
  setHp(): HpChange {
    throw new Error("unused");
  }
  setMaxHp(): HpChange {
    throw new Error("unused");
  }
  setArmorClass(): MonsterInstance {
    throw new Error("unused");
  }
  setStatsVisible(): MonsterInstance {
    throw new Error("unused");
  }
  setSpawnPositions(): MonsterInstance[] {
    throw new Error("unused");
  }
  changeMonsters(): MonsterInstance[] {
    throw new Error("unused");
  }
  clearEncounter(): MonsterInstance[] {
    throw new Error("unused");
  }
}

function monster(key: string, name: string, size = "medium"): Monster {
  return {
    key,
    name,
    source: "private",
    size,
    type: "humanoid",
    alignment: "neutral",
    ac: 12,
    armorDetail: "",
    hp: { average: 7, dice: "2d6" },
    speeds: { walk: 30 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    initiativeModifier: 1,
    cr: 0.25,
    saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: {},
    senses: {},
    languages: "",
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    sections: {
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
    },
  };
}

const bestiary = [
  monster("goblin", "Goblin"),
  monster("bandit", "Bandit"),
  monster("ogre", "Ogre", "large"),
];
const monsters: MonsterIndex = {
  monsters: bestiary,
  byKey: new Map(bestiary.map((m) => [m.key, m] as const)),
};

function setup(
  options: {
    active?: MapRegistration | undefined;
    rooms?: SavedRoom[];
    scene?: TableSceneMap;
    tokens?: TableToken[];
  } = {},
) {
  const repo = new MemoryEncounter();
  const table = tableWith(
    options.scene ?? scene(mapItem(placement)),
    options.tokens ?? [],
  );
  const maps = mapsWith(
    "active" in options ? options.active : registered,
    options.rooms ?? [taproom, attic],
  );
  let group = 0;
  const deps: AddMonstersDeps = {
    repo,
    monsters,
    rng: { nextInt: () => 0 },
    now: () => new Date(0),
    newGroupId: () => `g${String(++group)}`,
  };
  return { repo, table, deps: { ...deps, table, maps } };
}

function spawnOf(repo: MemoryEncounter, id: string): unknown {
  return repo.listInstances().find((i) => i.id === id)?.spawnPosition;
}

describe("addMonstersInRooms", () => {
  it("places each monster of a group with a room on a free cell whose centre is inside the room", async () => {
    const { deps } = setup();
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 3, room: "Taproom" }],
      origin,
    );
    expect(result.instances).toHaveLength(3);
    expect(result.placements.map((p) => p.cell).sort()).toEqual([
      "A1",
      "B1",
      "C1",
    ]);
  });

  it("does not pick a cell whose centre lies inside a token's bounds on the table", async () => {
    // B1 (the middle of the room) is the cell the picker would choose first.
    const { deps } = setup({
      tokens: [
        { bounds: { min: { x: 300, y: 100 }, max: { x: 400, y: 200 } } },
      ],
    });
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 2, room: "Taproom" }],
      origin,
    );
    expect(result.placements.map((p) => p.cell).sort()).toEqual(["A1", "C1"]);
  });

  it("a 2 x 2 token centred on a grid intersection makes all four cells under it occupied", async () => {
    // Centred on (300, 200), the corner shared by A1, B1, A2 and B2.
    const { deps } = setup({
      rooms: [room("Bar", "A1:C2")],
      tokens: [
        { bounds: { min: { x: 200, y: 100 }, max: { x: 400, y: 300 } } },
      ],
    });
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 6, room: "Bar" }],
      origin,
    );
    expect(
      result.placements
        .map((p) => p.cell)
        .filter((c) => c !== null)
        .sort(),
    ).toEqual(["C1", "C2"]);
  });

  it("a cell whose centre lies on the edge of a token's bounds is occupied", async () => {
    // A one-cell token offset by half a cell: the centres of A1 (250, 150),
    // B1 (350, 150), A2 (250, 250) and B2 (350, 250) are its corners.
    const { deps } = setup({
      rooms: [room("Bar", "A1:C2")],
      tokens: [
        { bounds: { min: { x: 250, y: 150 }, max: { x: 350, y: 250 } } },
      ],
    });
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 6, room: "Bar" }],
      origin,
    );
    expect(
      result.placements
        .map((p) => p.cell)
        .filter((c) => c !== null)
        .sort(),
    ).toEqual(["C1", "C2"]);
  });

  it("a cell centre within float noise of a token's bounds edge is occupied", async () => {
    // The edge case above, with each bound nudged just inside the token.
    const { deps } = setup({
      rooms: [room("Bar", "A1:C2")],
      tokens: [
        {
          bounds: {
            min: { x: 250 + 1e-12, y: 150 + 1e-12 },
            max: { x: 350 - 1e-12, y: 250 - 1e-12 },
          },
        },
      ],
    });
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 6, room: "Bar" }],
      origin,
    );
    expect(
      result.placements
        .map((p) => p.cell)
        .filter((c) => c !== null)
        .sort(),
    ).toEqual(["C1", "C2"]);
  });

  it("a call with one Large and two Medium monsters in a room puts the Large one on a free 2 x 2 block, at the block's centre", async () => {
    // Room A1:D2 is scene cols 2..5, rows 1..2. Its 2 x 2 blocks are B1:C2
    // centred (400, 200), A1:B2 at (300, 200) and C1:D2 at (500, 200).
    const blocks: Record<
      string,
      { at: { x: number; y: number }; cells: string[] }
    > = {
      "A1:B2": { at: { x: 300, y: 200 }, cells: ["A1", "B1", "A2", "B2"] },
      "B1:C2": { at: { x: 400, y: 200 }, cells: ["B1", "C1", "B2", "C2"] },
      "C1:D2": { at: { x: 500, y: 200 }, cells: ["C1", "D1", "C2", "D2"] },
    };
    const { deps, repo } = setup({ rooms: [room("Hall", "A1:D2")] });
    const result = await addMonstersInRooms(
      deps,
      [
        { monster: "ogre", count: 1, room: "Hall" },
        { monster: "bandit", count: 2, room: "Hall" },
      ],
      origin,
    );
    const [ogre, ...bandits] = result.placements;
    const taken = blocks[ogre?.cell ?? ""];
    expect(taken).toBeDefined();
    expect(spawnOf(repo, ogre?.id ?? "")).toEqual(taken?.at);
    expect(bandits).toHaveLength(2);
    for (const bandit of bandits) {
      expect(bandit.cell).not.toBeNull();
      expect(taken?.cells).not.toContain(bandit.cell);
    }
    expect(new Set(bandits.map((b) => b.cell)).size).toBe(2);
  });

  it("a Large group listed after a Medium group, in a room with a single free 2 x 2 block, still gets that block", async () => {
    // Hall A1:B3 is scene cols 2..3, rows 1..3. Placing the bandits first
    // would take A2 and leave no free 2 x 2 block.
    const { deps, repo } = setup({ rooms: [room("Hall", "A1:B3")] });
    const result = await addMonstersInRooms(
      deps,
      [
        { monster: "bandit", count: 2, room: "Hall" },
        { monster: "ogre", count: 1, room: "Hall" },
      ],
      origin,
    );
    const ogre = result.placements.find((p) => p.name === "Ogre 1");
    expect(ogre?.cell).toBe("A1:B2");
    expect(spawnOf(repo, ogre?.id ?? "")).toEqual({ x: 300, y: 200 });
    expect(
      result.placements.filter((p) => p.name !== "Ogre 1").map((p) => p.cell),
    ).toEqual(["A3", "B3"]);
  });

  it("placements stay in input order when a later group is placed first", async () => {
    const { deps, repo } = setup({ rooms: [room("Hall", "A1:B3")] });
    const result = await addMonstersInRooms(
      deps,
      [
        { monster: "bandit", count: 2, room: "Hall" },
        { monster: "ogre", count: 1, room: "Hall" },
      ],
      origin,
    );
    expect(result.placements.map((p) => [p.name, p.room, p.cell])).toEqual([
      ["Bandit 1", "Hall", "A3"],
      ["Bandit 2", "Hall", "B3"],
      ["Ogre 1", "Hall", "A1:B2"],
    ]);
    expect(result.placements.map((p) => p.id)).toEqual(
      result.instances.map((i) => i.id),
    );
    expect(result.instances.map((i) => spawnOf(repo, i.id))).toEqual([
      { x: 250, y: 350 },
      { x: 350, y: 350 },
      { x: 300, y: 200 },
    ]);
  });

  it("a Large monster that finds no free 2 x 2 block is added without a spawn position and reported unplaced", async () => {
    // Taproom is a 3 x 1 strip.
    const { deps, repo } = setup();
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "ogre", count: 1, room: "Taproom" }],
      origin,
    );
    expect(result.instances).toHaveLength(1);
    expect(spawnOf(repo, result.instances[0]?.id ?? "")).toBeNull();
    expect(result.placements).toEqual([
      {
        id: result.instances[0]?.id,
        name: "Ogre 1",
        room: "Taproom",
        cell: null,
      },
    ]);
  });

  it('a Large monster\'s placement gives its block as a display range ("A1:B2")', async () => {
    const { deps } = setup({ rooms: [room("Den", "A1:B2")] });
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "ogre", count: 1, room: "Den" }],
      origin,
    );
    expect(result.placements).toEqual([
      {
        id: result.instances[0]?.id,
        name: "Ogre 1",
        room: "Den",
        cell: "A1:B2",
      },
    ]);
  });

  it("two groups in the same room get different cells", async () => {
    const { deps } = setup();
    const result = await addMonstersInRooms(
      deps,
      [
        { monster: "goblin", count: 1, room: "Taproom" },
        { monster: "bandit", count: 1, room: "Taproom" },
      ],
      origin,
    );
    const cells = result.placements.map((p) => p.cell);
    expect(cells).toHaveLength(2);
    expect(cells.every((c) => c !== null)).toBe(true);
    expect(new Set(cells).size).toBe(2);
  });

  it("each placed monster's spawn position is the centre of its cell, in scene units", async () => {
    const { deps, repo } = setup();
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 3, room: "Taproom" }],
      origin,
    );
    expect(result.placements).toHaveLength(3);
    for (const p of result.placements) {
      expect(spawnOf(repo, p.id)).toEqual(cellCentres[p.cell ?? ""]);
    }
  });

  it("gives each placed monster its display cell label and the saved room's name", async () => {
    const { deps } = setup();
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 1, room: "taproom" }],
      origin,
    );
    expect(result.placements).toEqual([
      {
        id: result.instances[0]?.id,
        name: "Goblin 1",
        room: "Taproom",
        cell: "B1",
      },
    ]);
  });

  it("an unknown room fails listing the known rooms and adds nothing", async () => {
    const { deps, repo, table } = setup();
    const attempt = addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 1, room: "Library" }],
      origin,
    );
    await expect(attempt).rejects.toBeInstanceOf(UnknownRoomError);
    await expect(attempt).rejects.toThrow(
      'Unknown room "Library"; known rooms: Taproom, Attic.',
    );
    expect(table.sceneMapCalls).toBe(0);
    expect(repo.addCalls).toBe(0);
  });

  it("no map in use fails and adds nothing", async () => {
    const { deps, repo, table } = setup({ active: undefined });
    const attempt = addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 1, room: "Taproom" }],
      origin,
    );
    await expect(attempt).rejects.toBeInstanceOf(MapSelectionError);
    await expect(attempt).rejects.toThrow(
      "No map is in use: use the map first.",
    );
    expect(table.sceneMapCalls).toBe(0);
    expect(repo.addCalls).toBe(0);
  });

  it("a map item no longer on the scene fails and adds nothing", async () => {
    const { deps, repo } = setup({ scene: scene() });
    const attempt = addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 1, room: "Taproom" }],
      origin,
    );
    await expect(attempt).rejects.toBeInstanceOf(MapSelectionError);
    await expect(attempt).rejects.toThrow(
      "Manor is no longer on the scene: use the map again.",
    );
    expect(repo.addCalls).toBe(0);
  });

  it("a room too small for the group adds every monster, reports the last ones as unplaced and gives them no spawn position", async () => {
    const { deps, repo } = setup();
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 3, room: "Attic" }],
      origin,
    );
    expect(result.instances).toHaveLength(3);
    expect(result.placements.map((p) => [p.name, p.room, p.cell])).toEqual([
      ["Goblin 1", "Attic", "E5"],
      ["Goblin 2", "Attic", null],
      ["Goblin 3", "Attic", null],
    ]);
    expect(result.instances.map((i) => spawnOf(repo, i.id))).toEqual([
      { x: 650, y: 550 },
      null,
      null,
    ]);
  });

  it("a moved map places with the live transform and flags the move", async () => {
    // Moved three cells to the right: B1 is now scene cell (6, 1).
    const live: MapPlacement = { ...placement, position: { x: 500, y: 100 } };
    const { deps, repo } = setup({ scene: scene(mapItem(live)) });
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 1, room: "Taproom" }],
      origin,
    );
    expect(result.moved).toBe(true);
    expect(result.placements.map((p) => p.cell)).toEqual(["B1"]);
    expect(spawnOf(repo, result.instances[0]?.id ?? "")).toEqual({
      x: 650,
      y: 150,
    });
  });

  it("an unknown monster with a room fails before the table is asked", async () => {
    const { deps, repo, table } = setup();
    const attempt = addMonstersInRooms(
      deps,
      [{ monster: "dragon", count: 1, room: "Taproom" }],
      origin,
    );
    await expect(attempt).rejects.toBeInstanceOf(AddMonstersError);
    expect(table.sceneMapCalls).toBe(0);
    expect(table.sceneTokensCalls).toBe(0);
    expect(repo.addCalls).toBe(0);
  });

  it("a joined group with a room is placed in that room and keeps the member's group and initiative", async () => {
    const { deps, repo } = setup();
    repo.addInstances(() => [
      {
        monsterKey: "goblin",
        displayName: "Goblin 1",
        maxHp: 7,
        initiative: 15,
        groupId: "pack",
      },
    ]);
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 2, room: "Attic", join: "Goblin 1" }],
      origin,
    );
    expect(
      result.instances.map((i) => [i.name, i.groupId, i.initiative]),
    ).toEqual([
      ["Goblin 2", "pack", 15],
      ["Goblin 3", "pack", 15],
    ]);
    expect(result.placements.map((p) => [p.name, p.room, p.cell])).toEqual([
      ["Goblin 2", "Attic", "E5"],
      ["Goblin 3", "Attic", null],
    ]);
    expect(spawnOf(repo, result.instances[0]?.id ?? "")).toEqual(
      cellCentres["E5"],
    );
  });

  it("a join naming no monster in the encounter, in a call with a room, fails before the table is asked", async () => {
    const { deps, repo, table } = setup();
    const attempt = addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 1, room: "Taproom", join: "Nobody" }],
      origin,
    );
    await expect(attempt).rejects.toBeInstanceOf(AddMonstersError);
    await expect(attempt).rejects.toMatchObject({ code: "unknown_group" });
    expect(table.sceneMapCalls).toBe(0);
    expect(table.sceneTokensCalls).toBe(0);
    expect(repo.addCalls).toBe(0);
  });

  it("a group without a room in a call with rooms gets no spawn position and no placement", async () => {
    const { deps, repo } = setup();
    const result = await addMonstersInRooms(
      deps,
      [
        { monster: "goblin", count: 1 },
        { monster: "bandit", count: 1, room: "Attic" },
      ],
      origin,
    );
    expect(result.placements).toEqual([
      {
        id: result.instances[1]?.id,
        name: "Bandit 1",
        room: "Attic",
        cell: "E5",
      },
    ]);
    expect(result.instances.map((i) => spawnOf(repo, i.id))).toEqual([
      null,
      cellCentres["E5"],
    ]);
  });

  it("without a room the monsters get no spawn position and the table is not asked", async () => {
    const groups: RoomGroup[] = [
      { monster: "goblin", count: 2 },
      { monster: "bandit", count: 1, hp: "average" },
    ];
    const { deps, repo, table } = setup({ active: undefined });
    const result = await addMonstersInRooms(deps, groups, origin);

    const plain = setup();
    const expected = addMonsters(plain.deps, groups, origin);
    expect(result).toEqual({ ...expected, placements: [], moved: false });
    expect(table.sceneMapCalls).toBe(0);
    expect(table.sceneTokensCalls).toBe(0);
    expect(repo.listInstances().map((i) => i.spawnPosition)).toEqual([
      null,
      null,
      null,
    ]);
  });
});

/** A monster store holding Goblin 1 (initiative 15, group "pack") and Bandit 1 (no initiative, group "band"). */
function seedMembers(repo: MemoryEncounter): void {
  repo.addInstances(() => [
    {
      monsterKey: "goblin",
      displayName: "Goblin 1",
      maxHp: 7,
      initiative: 15,
      groupId: "pack",
    },
    {
      monsterKey: "bandit",
      displayName: "Bandit 1",
      maxHp: 7,
      initiative: null,
      groupId: "band",
    },
  ]);
}

/** The preview's deps from a setup: the store, the bestiary, the table and the maps, and nothing to roll with. */
function previewDeps(s: ReturnType<typeof setup>) {
  return {
    repo: s.repo,
    monsters,
    table: s.table,
    maps: s.deps.maps,
  };
}

/** The error a call fails with; fails the test when the call succeeds. */
async function failureOf(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to fail");
}

function describeError(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  return {
    class: e.constructor,
    code: (e as { code?: unknown }).code,
    message: e.message,
  };
}

describe("previewMonsters", () => {
  it("previewMonsters returns each would-be monster's name, AC, average HP, HP dice, initiative modifier and footprint, in input order", () => {
    const troll: Monster = {
      ...monster("troll", "Troll", "large"),
      ac: 15,
      hp: { average: 94, dice: "9d10 + 45" },
      initiativeModifier: 1,
    };
    const shadow: Monster = {
      ...monster("shadow", "Shadow"),
      ac: 12,
      hp: { average: 27, dice: "5d8 + 5" },
      initiativeModifier: 2,
    };
    const index: MonsterIndex = {
      monsters: [troll, shadow],
      byKey: new Map([
        [troll.key, troll],
        [shadow.key, shadow],
      ]),
    };
    const { repo } = setup();
    const preview = previewMonsters({ repo, monsters: index }, [
      { monster: "shadow", count: 2 },
      { monster: "troll", count: 1 },
    ]);
    expect(preview.instances).toEqual([
      {
        name: "Shadow 1",
        group: 0,
        ac: 12,
        averageHp: 27,
        hpDice: "5d8 + 5",
        initiativeModifier: 2,
        joins: null,
        footprint: 1,
      },
      {
        name: "Shadow 2",
        group: 0,
        ac: 12,
        averageHp: 27,
        hpDice: "5d8 + 5",
        initiativeModifier: 2,
        joins: null,
        footprint: 1,
      },
      {
        name: "Troll 1",
        group: 1,
        ac: 15,
        averageHp: 94,
        hpDice: "9d10 + 45",
        initiativeModifier: 1,
        joins: null,
        footprint: 2,
      },
    ]);
  });

  it("previewMonsters gives the names the next addMonsters of the same groups gives, continuing the numbers in use", () => {
    const { repo, deps } = setup();
    seedMembers(repo);
    const groups: RoomGroup[] = [
      { monster: "goblin", count: 2 },
      { monster: "bandit", count: 1, join: "Goblin 1" },
      { monster: "ogre", count: 1 },
    ];
    const preview = previewMonsters({ repo, monsters }, groups);
    const added = addMonsters(deps, groups, origin);
    expect(preview.instances.map((i) => i.name)).toEqual(
      added.instances.map((i) => i.name),
    );
    expect(preview.instances.map((i) => i.name)).toEqual([
      "Goblin 2",
      "Goblin 3",
      "Bandit 2",
      "Ogre 1",
    ]);
  });

  it("previewMonsters makes no store write and leaves the stored instances unchanged", () => {
    const { repo } = setup();
    seedMembers(repo);
    const before = repo.listInstances();
    const addCalls = repo.addCalls;
    previewMonsters({ repo, monsters }, [
      { monster: "goblin", count: 2, join: "Goblin 1" },
      { monster: "ogre", count: 1, hp: "average" },
    ]);
    expect(repo.addCalls).toBe(addCalls);
    expect(repo.listInstances()).toEqual(before);
  });

  it("a joined group's preview gives the member's name and current initiative, null included", () => {
    const { repo } = setup();
    seedMembers(repo);
    const banditId = repo
      .listInstances()
      .find((i) => i.displayName === "Bandit 1")?.id;
    const preview = previewMonsters({ repo, monsters }, [
      { monster: "goblin", count: 1, join: "Goblin 1" },
      { monster: "bandit", count: 1, join: banditId ?? "" },
      { monster: "ogre", count: 1 },
    ]);
    expect(preview.instances.map((i) => [i.name, i.joins])).toEqual([
      ["Goblin 2", { name: "Goblin 1", initiative: 15 }],
      ["Bandit 2", { name: "Bandit 1", initiative: null }],
      ["Ogre 1", null],
    ]);
  });
});

describe("previewMonstersInRooms", () => {
  it("previewMonstersInRooms gives each monster of a group with a room the cell addMonstersInRooms then gives it, a Large monster's block first", async () => {
    // Hall A1:B3 has a single free 2 x 2 block; placing the bandits first
    // would take A2 and leave the ogre none.
    const groups: RoomGroup[] = [
      { monster: "bandit", count: 2, room: "Hall" },
      { monster: "ogre", count: 1, room: "Hall" },
    ];
    const s = setup({ rooms: [room("Hall", "A1:B3")] });
    const preview = await previewMonstersInRooms(previewDeps(s), groups);
    const added = await addMonstersInRooms(s.deps, groups, origin);

    expect(preview.placements).toEqual(
      added.placements.map((p) => ({
        name: p.name,
        room: p.room,
        cell: p.cell,
      })),
    );
    expect(preview.placements).toEqual([
      { name: "Bandit 1", room: "Hall", cell: "A3" },
      { name: "Bandit 2", room: "Hall", cell: "B3" },
      { name: "Ogre 1", room: "Hall", cell: "A1:B2" },
    ]);
    expect(preview.instances.map((i) => i.name)).toEqual(
      added.instances.map((i) => i.name),
    );
    expect(preview.moved).toBe(false);
  });

  it("previewMonstersInRooms reports the monsters of a group that does not fit with no cell", async () => {
    const s = setup();
    const preview = await previewMonstersInRooms(previewDeps(s), [
      { monster: "goblin", count: 3, room: "Attic" },
      { monster: "ogre", count: 1, room: "Taproom" },
    ]);
    expect(preview.placements).toEqual([
      { name: "Goblin 1", room: "Attic", cell: "E5" },
      { name: "Goblin 2", room: "Attic", cell: null },
      { name: "Goblin 3", room: "Attic", cell: null },
      { name: "Ogre 1", room: "Taproom", cell: null },
    ]);
    expect(preview.instances).toHaveLength(4);
  });

  it("previewMonstersInRooms with a room only reads the table and makes no store write", async () => {
    const groups: RoomGroup[] = [
      { monster: "goblin", count: 1 },
      { monster: "bandit", count: 2, room: "Taproom", join: "Goblin 1" },
    ];
    const s = setup();
    seedMembers(s.repo);
    const before = s.repo.listInstances();
    const addCalls = s.repo.addCalls;
    await previewMonstersInRooms(previewDeps(s), groups);
    expect(s.repo.addCalls).toBe(addCalls);
    expect(s.repo.listInstances()).toEqual(before);

    const reference = setup();
    seedMembers(reference.repo);
    await addMonstersInRooms(reference.deps, groups, origin);
    expect(s.table.sceneMapCalls).toBeGreaterThan(0);
    expect(s.table.sceneTokensCalls).toBeGreaterThan(0);
    expect([s.table.sceneMapCalls, s.table.sceneTokensCalls]).toEqual([
      reference.table.sceneMapCalls,
      reference.table.sceneTokensCalls,
    ]);
  });

  it("previewMonstersInRooms without a room does not ask the table", async () => {
    const groups: RoomGroup[] = [
      { monster: "goblin", count: 2 },
      { monster: "bandit", count: 1, hp: "average" },
    ];
    const s = setup({ active: undefined });
    const preview = await previewMonstersInRooms(previewDeps(s), groups);

    const plain = setup();
    const expected = previewMonsters({ repo: plain.repo, monsters }, groups);
    expect(preview).toEqual({ ...expected, placements: [], moved: false });
    expect(s.table.sceneMapCalls).toBe(0);
    expect(s.table.sceneTokensCalls).toBe(0);
    expect(s.repo.addCalls).toBe(0);
  });

  it("previewMonstersInRooms throws the same error as addMonstersInRooms for each invalid input", async () => {
    const cases: {
      label: string;
      groups: RoomGroup[];
      options?: AddMonstersOptions;
      setup?: Parameters<typeof setup>[0];
    }[] = [
      { label: "no groups", groups: [] },
      {
        label: "unknown monster",
        groups: [{ monster: "dragon", count: 1, room: "Taproom" }],
      },
      {
        label: "count 0",
        groups: [{ monster: "goblin", count: 0, room: "Taproom" }],
      },
      {
        label: "hp not rolled or average",
        groups: [
          { monster: "goblin", count: 1, room: "Taproom", hp: "max" },
        ] as unknown as RoomGroup[],
      },
      {
        label: "initiative not group or each",
        groups: [{ monster: "goblin", count: 1, room: "Taproom" }],
        options: { initiative: "random" } as unknown as AddMonstersOptions,
      },
      {
        label: "unknown join",
        groups: [
          { monster: "goblin", count: 1, room: "Taproom", join: "Nobody" },
        ],
      },
      {
        label: "no map in use",
        groups: [{ monster: "goblin", count: 1, room: "Taproom" }],
        setup: { active: undefined },
      },
      {
        label: "unknown room",
        groups: [{ monster: "goblin", count: 1, room: "Library" }],
      },
      {
        label: "map item gone from the scene",
        groups: [{ monster: "goblin", count: 1, room: "Taproom" }],
        setup: { scene: scene() },
      },
    ];
    for (const c of cases) {
      const added = setup(c.setup);
      const expected = await failureOf(() =>
        addMonstersInRooms(added.deps, c.groups, origin, c.options),
      );
      const previewed = setup(c.setup);
      const actual = await failureOf(() =>
        previewMonstersInRooms(previewDeps(previewed), c.groups, c.options),
      );
      expect(describeError(actual), c.label).toEqual(describeError(expected));
      expect(previewed.repo.addCalls, c.label).toBe(0);
    }
  });

  it("previewMonstersInRooms with a moved map places with the live transform and flags the move", async () => {
    // Moved three cells to the right: B1 is now scene cell (6, 1).
    const live: MapPlacement = { ...placement, position: { x: 500, y: 100 } };
    const groups: RoomGroup[] = [
      { monster: "goblin", count: 1, room: "Taproom" },
    ];
    const s = setup({ scene: scene(mapItem(live)) });
    const preview = await previewMonstersInRooms(previewDeps(s), groups);
    const added = await addMonstersInRooms(s.deps, groups, origin);

    expect(preview.moved).toBe(true);
    expect(preview.placements.map((p) => p.cell)).toEqual(
      added.placements.map((p) => p.cell),
    );
    expect(preview.placements.map((p) => p.cell)).toEqual(["B1"]);
  });
});
