import { describe, expect, it } from "vitest";
import {
  bridgeMessageSchema,
  mapImageSchema,
  queryResultSchema,
  querySchema,
} from "./protocol.js";

const image = {
  mimeType: "image/webp",
  data: "UklGRg==",
  width: 1598,
  height: 1222,
};

describe("map-image schemas", () => {
  it("a `map-image` query decodes with a non-empty item id and is rejected without one or with an empty one", () => {
    expect(
      querySchema.safeParse({ name: "map-image", itemId: "map-1" }),
    ).toEqual({ success: true, data: { name: "map-image", itemId: "map-1" } });
    for (const bad of [
      { name: "map-image" },
      { name: "map-image", itemId: "" },
      { name: "map-image", itemId: 7 },
      { name: "map-image", itemId: null },
    ]) {
      expect(querySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("a `map-image` result with a webp or jpeg mime type, base64 data and a positive integer width and height decodes inside a `query-result` envelope", () => {
    for (const mimeType of ["image/webp", "image/jpeg"]) {
      const result = { ...image, mimeType };
      expect(mapImageSchema.safeParse(result).success, mimeType).toBe(true);
      const envelope = {
        v: 1,
        type: "query-result",
        id: "q-1",
        payload: { name: "map-image", result },
      };
      const parsed = bridgeMessageSchema.safeParse(envelope);
      expect(parsed.success, mimeType).toBe(true);
      expect(parsed.data, mimeType).toEqual(envelope);
    }
    expect(
      mapImageSchema.safeParse({ ...image, width: 1, height: 1 }).success,
    ).toBe(true);
  });

  it("a `map-image` result with another mime type, data that is not base64, empty data, or a width or height that is not a positive integer is rejected", () => {
    // The good result passes, so each rejection below is for its one change.
    expect(mapImageSchema.safeParse(image).success).toBe(true);
    for (const bad of [
      { ...image, mimeType: "image/png" },
      { ...image, mimeType: "image/svg+xml" },
      { ...image, data: "not base64!" },
      { ...image, data: "" },
      { ...image, width: 0 },
      { ...image, width: -1 },
      { ...image, width: 1.5 },
      { ...image, height: 0 },
      { ...image, height: 2.5 },
      { ...image, height: "1222" },
    ]) {
      expect(mapImageSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
      expect(
        queryResultSchema.safeParse({ name: "map-image", result: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});
