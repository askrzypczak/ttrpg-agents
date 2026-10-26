import { describe, expect, it } from "vitest";
import {
  agentQueryResponseSchema,
  queryResultSchema,
  querySchema,
  sceneMapSchema,
  sceneStatusSchema,
  sceneTokensSchema,
} from "./protocol.js";

const status = { sceneReady: true, tokenCount: 2, appliedInstanceCount: 2 };

const mapItem = {
  id: "map-1",
  name: "Trollskull Manor",
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  imageOffset: { x: 40, y: 60 },
  position: { x: 300, y: -150 },
  rotation: 270,
  scale: { x: 1.5, y: 1.5 },
};

const sceneMap = { grid: { dpi: 150, type: "SQUARE" }, maps: [mapItem] };

const sceneTokens = {
  tokens: [
    { bounds: { min: { x: 250, y: -200 }, max: { x: 350, y: -100 } } },
    { bounds: { min: { x: -50, y: -37.5 }, max: { x: 50, y: 62.5 } } },
  ],
};

function without<T extends object>(value: T, key: keyof T): Partial<T> {
  const copy: Partial<T> = { ...value };
  delete copy[key];
  return copy;
}

describe("query schemas", () => {
  it("accepts only the known queries", () => {
    expect(querySchema.safeParse({ name: "scene-status" }).success).toBe(true);
    expect(querySchema.safeParse({ name: "scene-map" }).success).toBe(true);
    expect(querySchema.safeParse({ name: "scene-tokens" }).success).toBe(true);
    for (const bad of [{ name: "nope" }, {}, [], null, "scene-status"]) {
      expect(querySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("scene status requires three well-formed fields", () => {
    expect(sceneStatusSchema.safeParse(status).success).toBe(true);
    expect(
      sceneStatusSchema.safeParse({ ...status, tokenCount: 0 }).success,
    ).toBe(true);
    for (const bad of [
      { ...status, tokenCount: -1 },
      { ...status, appliedInstanceCount: -1 },
      { ...status, tokenCount: 1.5 },
      { ...status, sceneReady: "yes" },
      { sceneReady: true, tokenCount: 1 },
      { sceneReady: true, appliedInstanceCount: 1 },
      { tokenCount: 1, appliedInstanceCount: 1 },
      {},
    ]) {
      expect(
        sceneStatusSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("a scene map needs a grid with a positive dpi and a type, and map items with every transform field", () => {
    expect(sceneMapSchema.safeParse(sceneMap).success).toBe(true);
    expect(sceneMapSchema.safeParse({ ...sceneMap, maps: [] }).success).toBe(
      true,
    );
    const itemMissing = (Object.keys(mapItem) as (keyof typeof mapItem)[]).map(
      (key) => ({ ...sceneMap, maps: [without(mapItem, key)] }),
    );
    for (const bad of [
      { ...sceneMap, grid: { dpi: 0, type: "SQUARE" } },
      { ...sceneMap, grid: { dpi: -150, type: "SQUARE" } },
      { ...sceneMap, grid: { dpi: 150, type: "" } },
      { ...sceneMap, grid: { dpi: 150 } },
      { maps: [mapItem] },
      { grid: sceneMap.grid },
      ...itemMissing,
      { ...sceneMap, maps: [{ ...mapItem, imageWidth: 0 }] },
      { ...sceneMap, maps: [{ ...mapItem, imageHeight: 0 }] },
      { ...sceneMap, maps: [{ ...mapItem, imageDpi: 0 }] },
      { ...sceneMap, maps: [{ ...mapItem, rotation: "270" }] },
      { ...sceneMap, maps: [{ ...mapItem, scale: { x: 1.5 } }] },
    ]) {
      expect(sceneMapSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("a query result carries `scene-map` with a valid scene map", () => {
    expect(
      queryResultSchema.safeParse({ name: "scene-map", result: sceneMap })
        .success,
    ).toBe(true);
    for (const bad of [
      {
        name: "scene-map",
        result: { ...sceneMap, grid: { dpi: 0, type: "SQUARE" } },
      },
      { name: "scene-map" },
      { name: "scene-status", result: sceneMap },
    ]) {
      expect(
        queryResultSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("a scene-tokens result needs numeric min and max corners for each token's bounds, and may be empty", () => {
    expect(sceneTokensSchema.safeParse(sceneTokens).success).toBe(true);
    expect(sceneTokensSchema.safeParse({ tokens: [] }).success).toBe(true);
    const min = { x: 0, y: 0 };
    const max = { x: 100, y: 100 };
    for (const bad of [
      {},
      { tokens: [{}] },
      { tokens: [{ position: { x: 1, y: 2 } }] },
      { tokens: [{ bounds: null }] },
      { tokens: [{ bounds: { min } }] },
      { tokens: [{ bounds: { max } }] },
      { tokens: [{ bounds: { min: { x: 1 }, max } }] },
      { tokens: [{ bounds: { min, max: { y: 1 } } }] },
      { tokens: [{ bounds: { min: { x: "1", y: 2 }, max } }] },
      { tokens: [{ bounds: { min, max: { x: 1, y: null } } }] },
      { tokens: { bounds: { min, max } } },
    ]) {
      expect(
        sceneTokensSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("a query result carries `scene-tokens` with valid tokens", () => {
    const result = { name: "scene-tokens", result: sceneTokens };
    expect(queryResultSchema.safeParse(result).success).toBe(true);
    expect(
      agentQueryResponseSchema.safeParse({ ok: true, result }).success,
    ).toBe(true);
    for (const bad of [
      {
        name: "scene-tokens",
        result: {
          tokens: [{ bounds: { min: { x: 1 }, max: { x: 2, y: 2 } } }],
        },
      },
      { name: "scene-tokens" },
      { name: "scene-map", result: sceneTokens },
      { name: "scene-status", result: sceneTokens },
    ]) {
      expect(
        queryResultSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("a query result carries its name and a valid result", () => {
    expect(
      queryResultSchema.safeParse({ name: "scene-status", result: status })
        .success,
    ).toBe(true);
    for (const bad of [
      { name: "scene-status" },
      { name: "scene-status", result: { ...status, tokenCount: -1 } },
      { name: "nope", result: status },
      { result: status },
    ]) {
      expect(
        queryResultSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("an ok response needs a result and an error response needs code and message", () => {
    const result = { name: "scene-status", result: status };
    expect(
      agentQueryResponseSchema.safeParse({ ok: true, result }).success,
    ).toBe(true);
    for (const bad of [
      { ok: true },
      { ok: true, result: { name: "scene-status" } },
      { ok: false },
      { ok: false, error: { code: "timeout" } },
      { ok: false, error: { message: "m" } },
      { ok: false, error: { code: "nope", message: "m" } },
      { error: { code: "timeout", message: "m" } },
    ]) {
      expect(
        agentQueryResponseSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});
