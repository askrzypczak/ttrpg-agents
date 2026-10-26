import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MapPlacement,
  MapRegistration,
  MapRepository,
  SavedRoom,
} from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
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
  readonly rooms = new Map<string, SavedRoom[]>();
  failReads = 0;
  reads = 0;

  constructor(active?: MapRegistration) {
    this.active = active;
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

const mapRooms = (
  itemId: string | null,
  rooms: SavedRoom[],
): BridgeMessage => ({
  v: 1,
  type: "map-rooms",
  payload: { itemId, rooms },
});

describe("mapRoomsMessage", () => {
  it("mapRoomsMessage carries the active map's item id and its rooms in saved order", () => {
    const maps = new MemoryMaps(trollskull);
    const rooms = [
      room("Taproom"),
      room("Kitchen", "proposed"),
      room("Cellar"),
    ];
    maps.replaceRooms("trollskull", rooms);
    maps.replaceRooms("cellar-map", [room("Vault")]);

    expect(mapRoomsMessage(maps)).toEqual(mapRooms("trollskull", rooms));
  });

  it("mapRoomsMessage with no active map carries a null item id and no rooms", () => {
    const maps = new MemoryMaps();
    maps.replaceRooms("trollskull", [room("Taproom")]);

    expect(mapRoomsMessage(maps)).toEqual(mapRooms(null, []));
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
    const maps = new MemoryMaps(trollskull);
    maps.replaceRooms("trollskull", [room("Taproom")]);
    stop = broadcastMapRooms(maps, target);

    vi.advanceTimersByTime(POLL_MS * 4);
    expect(sent).toEqual([]);

    const changed = [room("Taproom"), room("Kitchen", "proposed")];
    maps.replaceRooms("trollskull", changed);
    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([mapRooms("trollskull", changed)]);

    vi.advanceTimersByTime(POLL_MS * 4);
    expect(sent).toEqual([mapRooms("trollskull", changed)]);
  });

  it("broadcastMapRooms broadcasts when another map becomes active", () => {
    const maps = new MemoryMaps(trollskull);
    maps.replaceRooms("trollskull", [room("Taproom")]);
    maps.replaceRooms("cellar-map", [room("Vault")]);
    stop = broadcastMapRooms(maps, target);

    maps.registerMap(cellarMap);
    vi.advanceTimersByTime(POLL_MS);

    expect(sent).toEqual([mapRooms("cellar-map", [room("Vault")])]);
  });

  it("broadcastMapRooms retries a failing read on the next tick", () => {
    const maps = new MemoryMaps(trollskull);
    stop = broadcastMapRooms(maps, target);

    const changed = [room("Taproom")];
    maps.replaceRooms("trollskull", changed);
    maps.failReads = 1;
    expect(() => vi.advanceTimersByTime(POLL_MS)).not.toThrow();
    expect(sent).toEqual([]);

    vi.advanceTimersByTime(POLL_MS);
    expect(sent).toEqual([mapRooms("trollskull", changed)]);
  });

  it("broadcastMapRooms stops polling after stop() is called", () => {
    const maps = new MemoryMaps(trollskull);
    const stopPolling = broadcastMapRooms(maps, target);
    vi.advanceTimersByTime(POLL_MS);

    stopPolling();
    const readsAtStop = maps.reads;
    maps.replaceRooms("trollskull", [room("Taproom")]);
    vi.advanceTimersByTime(POLL_MS * 8);

    expect(sent).toEqual([]);
    expect(maps.reads).toBe(readsAtStop);
  });
});
