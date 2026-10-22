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
});
