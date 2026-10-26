import { TableUnavailableError } from "@ttrpg-agents/engine";
import {
  agentErrorCodeSchema,
  type AgentQueryResponse,
  type Query,
} from "@ttrpg-agents/protocol";
import { describe, expect, it } from "vitest";
import { createBridgeTable, type BridgeClient } from "./client.js";

/** A stub client that records queries and answers each with `response`. */
function clientAnswering(response: AgentQueryResponse): {
  client: BridgeClient;
  queries: Query[];
} {
  const queries: Query[] = [];
  return {
    queries,
    client: {
      query: (query) => {
        queries.push(query);
        return Promise.resolve(response);
      },
    },
  };
}

describe("createBridgeTable", () => {
  it("returns the scene counts from an ok `scene-status` result", async () => {
    const { client, queries } = clientAnswering({
      ok: true,
      result: {
        name: "scene-status",
        result: { sceneReady: true, tokenCount: 4, appliedInstanceCount: 3 },
      },
    });
    const status = await createBridgeTable(client).sceneStatus();
    expect(status).toEqual({
      sceneReady: true,
      tokenCount: 4,
      appliedInstanceCount: 3,
    });
    expect(queries).toEqual([{ name: "scene-status" }]);
  });

  it("throws `TableUnavailableError` carrying the bridge's message for any `{ ok: false }` response, each error code", async () => {
    for (const code of agentErrorCodeSchema.options) {
      const message = `bridge says ${code}`;
      const { client } = clientAnswering({
        ok: false,
        error: { code, message },
      });
      let caught: unknown;
      try {
        await createBridgeTable(client).sceneStatus();
      } catch (e) {
        caught = e;
      }
      expect(caught, code).toBeInstanceOf(TableUnavailableError);
      expect((caught as Error).message, code).toBe(message);
    }
  });

  it("`sceneMap` returns the grid and map items from an ok `scene-map` result", async () => {
    const sceneMap = {
      grid: { dpi: 150, type: "SQUARE" },
      maps: [
        {
          id: "map-1",
          name: "Trollskull Manor",
          imageWidth: 3000,
          imageHeight: 4000,
          imageDpi: 125,
          imageOffset: { x: 40, y: 60 },
          position: { x: 300, y: -150 },
          rotation: 270,
          scale: { x: 1.5, y: 1.5 },
        },
      ],
    };
    const { client, queries } = clientAnswering({
      ok: true,
      result: { name: "scene-map", result: sceneMap },
    });
    expect(await createBridgeTable(client).sceneMap()).toEqual(sceneMap);
    expect(queries).toEqual([{ name: "scene-map" }]);
  });

  it("`sceneMap` throws `TableUnavailableError` carrying the bridge's message for any `{ ok: false }` response, each error code", async () => {
    for (const code of agentErrorCodeSchema.options) {
      const message = `bridge says ${code}`;
      const { client } = clientAnswering({
        ok: false,
        error: { code, message },
      });
      let caught: unknown;
      try {
        await createBridgeTable(client).sceneMap();
      } catch (e) {
        caught = e;
      }
      expect(caught, code).toBeInstanceOf(TableUnavailableError);
      expect((caught as Error).message, code).toBe(message);
    }
  });

  it("a result for another query throws `TableUnavailableError`, for either method", async () => {
    const { client: mapClient } = clientAnswering({
      ok: true,
      result: {
        name: "scene-map",
        result: { grid: { dpi: 150, type: "SQUARE" }, maps: [] },
      },
    });
    await expect(
      createBridgeTable(mapClient).sceneStatus(),
    ).rejects.toBeInstanceOf(TableUnavailableError);

    const { client: statusClient } = clientAnswering({
      ok: true,
      result: {
        name: "scene-status",
        result: { sceneReady: true, tokenCount: 1, appliedInstanceCount: 1 },
      },
    });
    let caught: unknown;
    try {
      await createBridgeTable(statusClient).sceneMap();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TableUnavailableError);
  });

  it("`sceneTokens` returns the tokens from an ok `scene-tokens` result", async () => {
    const sceneTokens = {
      tokens: [
        { bounds: { min: { x: 250, y: -200 }, max: { x: 350, y: -100 } } },
        { bounds: { min: { x: -37.5, y: -10 }, max: { x: 62.5, y: 90 } } },
      ],
    };
    const { client, queries } = clientAnswering({
      ok: true,
      result: { name: "scene-tokens", result: sceneTokens },
    });
    expect(await createBridgeTable(client).sceneTokens()).toEqual(sceneTokens);
    expect(queries).toEqual([{ name: "scene-tokens" }]);
  });

  it("`sceneTokens` throws `TableUnavailableError` carrying the bridge's message for any `{ ok: false }` response, each error code", async () => {
    for (const code of agentErrorCodeSchema.options) {
      const message = `bridge says ${code}`;
      const { client } = clientAnswering({
        ok: false,
        error: { code, message },
      });
      let caught: unknown;
      try {
        await createBridgeTable(client).sceneTokens();
      } catch (e) {
        caught = e;
      }
      expect(caught, code).toBeInstanceOf(TableUnavailableError);
      expect((caught as Error).message, code).toBe(message);
    }
  });

  it("a result for another query throws `TableUnavailableError` from `sceneTokens`", async () => {
    for (const result of [
      {
        name: "scene-status" as const,
        result: { sceneReady: true, tokenCount: 1, appliedInstanceCount: 1 },
      },
      {
        name: "scene-map" as const,
        result: { grid: { dpi: 150, type: "SQUARE" }, maps: [] },
      },
    ]) {
      const { client } = clientAnswering({ ok: true, result });
      let caught: unknown;
      try {
        await createBridgeTable(client).sceneTokens();
      } catch (e) {
        caught = e;
      }
      expect(caught, result.name).toBeInstanceOf(TableUnavailableError);
    }
  });
});
