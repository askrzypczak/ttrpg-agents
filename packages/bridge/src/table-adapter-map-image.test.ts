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

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  return undefined;
}

const image = {
  mimeType: "image/jpeg" as const,
  data: "/9j/4AAQ",
  width: 1598,
  height: 1222,
};

describe("createBridgeTable mapImage", () => {
  it("`mapImage` sends `map-image` with the item id and returns the image from an ok result", async () => {
    const { client, queries } = clientAnswering({
      ok: true,
      result: { name: "map-image", result: image },
    });
    expect(await createBridgeTable(client).mapImage("map-1")).toEqual(image);
    expect(queries).toEqual([{ name: "map-image", itemId: "map-1" }]);
  });

  it("`mapImage` throws `TableUnavailableError` carrying the bridge's message for an `{ ok: false }` response", async () => {
    for (const code of agentErrorCodeSchema.options) {
      const message = `bridge says ${code}`;
      const { client } = clientAnswering({
        ok: false,
        error: { code, message },
      });
      const caught = await rejection(createBridgeTable(client).mapImage("m"));
      expect(caught, code).toBeInstanceOf(TableUnavailableError);
      expect((caught as Error).message, code).toBe(message);
    }
  });

  it("a result for another query throws `TableUnavailableError` from `mapImage`", async () => {
    const { client } = clientAnswering({
      ok: true,
      result: {
        name: "scene-status",
        result: {
          sceneReady: true,
          tokenCount: 1,
          appliedInstanceCount: 1,
          artWaits: [],
        },
      },
    });
    const caught = await rejection(createBridgeTable(client).mapImage("m"));
    expect(caught).toBeInstanceOf(TableUnavailableError);
  });
});
