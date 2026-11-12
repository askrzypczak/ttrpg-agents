// Node-only client for the bridge's `POST /agent/query`, the one bridge
// module `@ttrpg-agents/mcp` may import (`@ttrpg-agents/bridge/client`, from
// its composition root only). It imports only Node builtins,
// `@ttrpg-agents/engine` and `@ttrpg-agents/protocol`.
import { readFile } from "node:fs/promises";
import {
  TableUnavailableError,
  type BridgeProbe,
  type TablePort,
} from "@ttrpg-agents/engine";
import {
  agentQueryResponseSchema,
  type AgentQueryResponse,
  type Query,
} from "@ttrpg-agents/protocol";

export interface BridgeClient {
  query(query: Query): Promise<AgentQueryResponse>;
}

/** Reads the agent token file (trimmed). */
export async function readAgentToken(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

function unreachable(message: string): AgentQueryResponse {
  return { ok: false, error: { code: "bridge-unreachable", message } };
}

/**
 * Talks to the bridge on `port` with the agent token at `tokenPath`; the
 * composition root takes both from the config. The token is read on every call.
 */
export function createBridgeClient(options: {
  port: number;
  tokenPath: string;
}): BridgeClient {
  const { port, tokenPath } = options;
  return {
    async query(query) {
      let token: string;
      try {
        token = await readAgentToken(tokenPath);
      } catch {
        return unreachable(
          `cannot read the agent token at ${tokenPath}; start the bridge (npm run bridge) so it creates it`,
        );
      }
      let res: Response;
      try {
        res = await fetch(`http://127.0.0.1:${String(port)}/agent/query`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(query),
        });
      } catch {
        return unreachable(
          `cannot reach the bridge on port ${String(port)}; start it with npm run bridge`,
        );
      }
      try {
        const parsed = agentQueryResponseSchema.safeParse(await res.json());
        if (parsed.success) return parsed.data;
      } catch {
        // fall through to the generic error
      }
      return unreachable(
        `the service on port ${String(port)} did not answer like the bridge (HTTP ${String(res.status)})`,
      );
    },
  };
}

/**
 * Driven adapter for the engine's `TablePort`, over `client`. `sceneStatus` sends `scene-status` and returns the
 * scene counts and the room id (when the tab reports one); `sceneMap` sends
 * `scene-map` and returns the scene grid and map items; `sceneTokens` sends
 * `scene-tokens` and returns each token's bounds; `mapImage` sends `map-image`
 * with the item id and returns the gridded map image. For any of them, a
 * `{ ok: false }` becomes a `TableUnavailableError` with the bridge's message,
 * and so does a result for another query.
 */
export function createBridgeTable(client: BridgeClient): TablePort {
  return {
    async sceneStatus() {
      const res = await client.query({ name: "scene-status" });
      if (!res.ok) throw new TableUnavailableError(res.error.message);
      if (res.result.name !== "scene-status")
        throw new TableUnavailableError(
          `the table answered "${res.result.name}" to a "scene-status" query`,
        );
      const { sceneReady, tokenCount, appliedInstanceCount, artWaits, roomId } =
        res.result.result;
      return {
        sceneReady,
        tokenCount,
        appliedInstanceCount,
        artWaits,
        ...(roomId !== undefined ? { roomId } : {}),
      };
    },
    async sceneMap() {
      const res = await client.query({ name: "scene-map" });
      if (!res.ok) throw new TableUnavailableError(res.error.message);
      if (res.result.name !== "scene-map")
        throw new TableUnavailableError(
          `the table answered "${res.result.name}" to a "scene-map" query`,
        );
      const { grid, maps } = res.result.result;
      return { grid, maps };
    },
    async sceneTokens() {
      const res = await client.query({ name: "scene-tokens" });
      if (!res.ok) throw new TableUnavailableError(res.error.message);
      if (res.result.name !== "scene-tokens")
        throw new TableUnavailableError(
          `the table answered "${res.result.name}" to a "scene-tokens" query`,
        );
      const { tokens } = res.result.result;
      return { tokens };
    },
    async mapImage(itemId) {
      const res = await client.query({ name: "map-image", itemId });
      if (!res.ok) throw new TableUnavailableError(res.error.message);
      if (res.result.name !== "map-image")
        throw new TableUnavailableError(
          `the table answered "${res.result.name}" to a "map-image" query`,
        );
      const { mimeType, data, width, height } = res.result.result;
      return { mimeType, data, width, height };
    },
  };
}

/** Asks the bridge on `port` for `scene-status` through `client`, after checking the token file at `tokenPath` exists; maps the answer to facts. */
export function createBridgeProbe(options: {
  client: BridgeClient;
  port: number;
  tokenPath: string;
}): BridgeProbe {
  void options;
  return {
    check() {
      return Promise.reject(new Error("not implemented"));
    },
  };
}
