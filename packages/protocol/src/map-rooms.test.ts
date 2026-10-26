import { describe, expect, it } from "vitest";
import type { SavedRoom } from "@ttrpg-agents/engine";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "./protocol.js";

const taproom: SavedRoom = {
  name: "Taproom",
  status: "confirmed",
  polygons: [
    [
      { x: 1625, y: 2375 },
      { x: 2500, y: 2375 },
      { x: 2500, y: 3500 },
      { x: 1625, y: 3500 },
    ],
  ],
};

const cellar: SavedRoom = {
  name: "Cellar",
  status: "proposed",
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    [
      { x: 200, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 300 },
    ],
  ],
};

describe("map-rooms message", () => {
  it("a map-rooms message round-trips the active map's item id and its rooms", () => {
    const message: BridgeMessage = {
      v: 1,
      type: "map-rooms",
      payload: { itemId: "trollskull", rooms: [taproom, cellar] },
    };

    expect(decodeMessage(encodeMessage(message))).toEqual({
      ok: true,
      message,
    });
  });

  it("a map-rooms message with no map in use round-trips a null item id and no rooms", () => {
    const message: BridgeMessage = {
      v: 1,
      type: "map-rooms",
      payload: { itemId: null, rooms: [] },
    };

    expect(decodeMessage(encodeMessage(message))).toEqual({
      ok: true,
      message,
    });
  });

  it("a map-rooms room with an unknown status is invalid-payload", () => {
    const raw = JSON.stringify({
      v: 1,
      type: "map-rooms",
      payload: {
        itemId: "trollskull",
        rooms: [{ ...taproom, status: "rumoured" }],
      },
    });

    const result = decodeMessage(raw);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("invalid-payload");
  });
});
