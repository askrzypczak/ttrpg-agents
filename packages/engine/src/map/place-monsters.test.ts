import { describe, expect, it } from "vitest";
import {
  AddMonstersError,
  MapSelectionError,
  UnknownRoomError,
  addMonsters,
  addMonstersInRooms,
  cellRangeToPolygon,
  parseCellRange,
  type AddMonstersDeps,
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
  renameInstance(): MonsterInstance {
    throw new Error("unused");
  }
  setInitiative(): MonsterInstance {
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
  clearEncounter(): void {
    throw new Error("unused");
  }
}

function monster(key: string, name: string): Monster {
  return {
    key,
    name,
    source: "private",
    size: "medium",
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

const bestiary = [monster("goblin", "Goblin"), monster("bandit", "Bandit")];
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

  it("does not pick a cell that holds the centre of a token on the table", async () => {
    // B1 (the middle of the room) is the cell the picker would choose first.
    const { deps } = setup({ tokens: [{ position: { x: 340, y: 160 } }] });
    const result = await addMonstersInRooms(
      deps,
      [{ monster: "goblin", count: 2, room: "Taproom" }],
      origin,
    );
    expect(result.placements.map((p) => p.cell).sort()).toEqual(["A1", "C1"]);
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
