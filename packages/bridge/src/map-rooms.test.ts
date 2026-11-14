import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Encounter,
  EncounterDirectory,
  MapPlacement,
  MapRegistration,
  MapRepository,
  SavedRoom,
} from "@ttrpg-agents/engine";
import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";
import { broadcastMapRooms, mapRoomsMessage } from "./map-rooms.js";

const POLL_MS = 250;

const placement: MapPlacement = {
  position: { x: 0, y: 0 },
  rotation: 270,
  scale: { x: 1, y: 1 },
  imageOffset: { x: 0, y: 0 },
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  sceneDpi: 150,
};

const trollskull: MapRegistration = {
  itemId: "trollskull",
  name: "Trollskull Manor",
  placement,
};
const cellarMap: MapRegistration = {
  itemId: "cellar-map",
  name: "Cellar",
  placement,
};

const room = (
  name: string,
  status: SavedRoom["status"] = "confirmed",
): SavedRoom => ({
  name,
  status,
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  ],
});

/** In-memory map store; `failReads` makes that many next reads throw; `reads` counts reads. */
class MemoryMaps implements MapRepository {
  active: MapRegistration | undefined;
  readonly rooms: Map<string, SavedRoom[]>;
  failReads = 0;
  reads = 0;

  constructor(
    active?: MapRegistration,
    rooms: Map<string, SavedRoom[]> = new Map(),
  ) {
    this.active = active;
    this.rooms = rooms;
  }

  registerMap(registration: MapRegistration): void {
    this.active = registration;
  }

  getActiveMap(): MapRegistration | undefined {
    this.reads++;
    if (this.failReads > 0) {
      this.failReads--;
      throw new Error("database is locked");
    }
    return this.active && structuredClone(this.active);
  }

  getRooms(itemId: string): SavedRoom[] {
    this.reads++;
    return structuredClone(this.rooms.get(itemId) ?? []);
  }

  replaceRooms(itemId: string, rooms: readonly SavedRoom[]): void {
    this.rooms.set(itemId, structuredClone([...rooms]));
  }
}

/** In-memory encounters, each with its own map; rooms are kept per map item and shared by every encounter. */
class MemoryEncounters implements Pick<
  EncounterDirectory,
  "getCurrentEncounter" | "mapRepositoryFor"
> {
  current: string | undefined;
  readonly rooms = new Map<string, SavedRoom[]>();
  private readonly maps = new Map<string, MemoryMaps>();

  /** Gives the encounter this map (none when undefined). */
  use(encounterId: string, map?: MapRegistration): MemoryMaps {
    const maps = new MemoryMaps(map, this.rooms);
    this.maps.set(encounterId, maps);
    return maps;
  }

  getCurrentEncounter(): Encounter | undefined {
    return this.current === undefined
      ? undefined
      : { id: this.current, name: this.current, createdAt: 0 };
  }

  mapRepositoryFor(encounterId: string): MapRepository {
    return this.maps.get(encounterId) ?? this.use(encounterId);
  }
}

const mapRooms = (
  itemId: string | null,
  rooms: SavedRoom[],
): BridgeMessage => ({
  v: PROTOCOL_VERSION,
  type: "map-rooms",
  payload: { itemId, rooms },
});

describe("mapRoomsMessage", () => {
  it("mapRoomsMessage carries the current encounter's map item id and its rooms in saved order, not another encounter's", () => {
    const encounters = new MemoryEncounters();
    const tavern = encounters.use("tavern", trollskull);
    encounters.use("cellar-fight", cellarMap);
    const rooms = [
      room("Taproom"),
      room("Kitchen", "proposed"),
      room("Cellar"),
    ];
    tavern.replaceRooms("trollskull", rooms);
    tavern.replaceRooms("cellar-map", [room("Vault")]);
    encounters.current = "tavern";

    expect(mapRoomsMessage(encounters)).toEqual(mapRooms("trollskull", rooms));
  });

  it("mapRoomsMessage with no current encounter carries a null item id and no rooms", () => {
    const encounters = new MemoryEncounters();
    encounters
      .use("tavern", trollskull)
      .replaceRooms("trollskull", [room("Taproom")]);

    expect(mapRoomsMessage(encounters)).toEqual(mapRooms(null, []));
  });

  it("mapRoomsMessage for a current encounter with no map carries a null item id and no rooms while another encounter has a map", () => {
    const encounters = new MemoryEncounters();
    encounters
      .use("tavern", trollskull)
      .replaceRooms("trollskull", [room("Taproom")]);
    encounters.use("crypt");
    encounters.current = "crypt";

    expect(mapRoomsMessage(encounters)).toEqual(mapRooms(null, []));
  });
});

describe("broadcastMapRooms", () => {
  let sent: BridgeMessage[];
  const target = { broadcast: (m: BridgeMessage) => sent.push(m) };
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    stop = undefined;
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  it("broadcastMapRooms broadcasts map-rooms when the active map's rooms change, and nothing while they stay the same", () => {
    const encounters = new MemoryEncounters();
    const maps = encounters.use("tavern", trollskull);
    encounters.current = "tavern";
    maps.replaceRooms("trollskull", [room("Taproom")]);
    stop = broadcastMapRooms(encounters, target);

    vi.advanceTimersByTime(POLL_MS * 4);
    expect(sent).toEqual([]);

    const changed = [room("Taproom"), room("Kitchen", "proposed")];
    maps.replaceRooms("trollskull", changed);
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([mapRooms("trollskull", changed)]);

    vi.advanceTimersByTime(POLL_MS * 4);
    expect(sent).toEqual([mapRooms("trollskull", changed)]);
  });

  it("broadcastMapRooms broadcasts when the current encounter uses another map", () => {
    const encounters = new MemoryEncounters();
    const maps = encounters.use("tavern", trollskull);
    encounters.current = "tavern";
    maps.replaceRooms("trollskull", [room("Taproom")]);
    maps.replaceRooms("cellar-map", [room("Vault")]);
    stop = broadcastMapRooms(encounters, target);

    maps.registerMap(cellarMap);
    vi.advanceTimersByTime(POLL_MS);

    expect(sent).toEqual([mapRooms("cellar-map", [room("Vault")])]);
  });

  it("broadcastMapRooms broadcasts the new current encounter's map and rooms within one poll when the current encounter changes", () => {
    const encounters = new MemoryEncounters();
    encounters
      .use("tavern", trollskull)
      .replaceRooms("trollskull", [room("Taproom")]);
    encounters
      .use("cellar-fight", cellarMap)
      .replaceRooms("cellar-map", [room("Vault")]);
    encounters.use("crypt");
    encounters.current = "tavern";
    stop = broadcastMapRooms(encounters, target);

    vi.advanceTimersByTime(POLL_MS * 4);
    expect(sent).toEqual([]);

    encounters.current = "cellar-fight";
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([mapRooms("cellar-map", [room("Vault")])]);

    encounters.current = "crypt";
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([
      mapRooms("cellar-map", [room("Vault")]),
      mapRooms(null, []),
    ]);
  });

  it("broadcastMapRooms retries a failing read on the next tick", () => {
    const encounters = new MemoryEncounters();
    const maps = encounters.use("tavern", trollskull);
    encounters.current = "tavern";
    stop = broadcastMapRooms(encounters, target);

    const changed = [room("Taproom")];
    maps.replaceRooms("trollskull", changed);
    maps.failReads = 1;
    expect(() => vi.advanceTimersByTime(POLL_MS)).not.toThrow();
    expect(sent).toEqual([]);

    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([mapRooms("trollskull", changed)]);
  });

  it("broadcastMapRooms stops polling after stop() is called", () => {
    const encounters = new MemoryEncounters();
    const maps = encounters.use("tavern", trollskull);
    encounters.current = "tavern";
    const stopPolling = broadcastMapRooms(encounters, target);
    vi.advanceTimersByTime(POLL_MS);

    stopPolling();
    const readsAtStop = maps.reads;
    maps.replaceRooms("trollskull", [room("Taproom")]);
    vi.advanceTimersByTime(POLL_MS * 8);

    expect(sent).toEqual([]);
    expect(maps.reads).toBe(readsAtStop);
  });
});
