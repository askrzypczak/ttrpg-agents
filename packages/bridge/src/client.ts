// Node-only client for the bridge's `POST /agent/command`, the one bridge
// module `@ttrpg-agents/mcp` may import (`@ttrpg-agents/bridge/client`). It
// imports only Node builtins, `@ttrpg-agents/protocol` and `./token-file.js`.
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  agentCommandResponseSchema,
  type AgentCommandResponse,
  type Command,
} from "@ttrpg-agents/protocol";
import { defaultAgentTokenPath } from "./token-file.js";

export interface BridgeClient {
  command(command: Command): Promise<AgentCommandResponse>;
}

const DEFAULT_PORT = 5199;

/** Reads the agent token file (trimmed). */
export async function readAgentToken(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

function unreachable(message: string): AgentCommandResponse {
  return { ok: false, error: { code: "bridge-unreachable", message } };
}

/**
 * Port defaults to `BRIDGE_PORT`, then 5199; the token path to
 * `BRIDGE_AGENT_TOKEN_FILE`, then `defaultAgentTokenPath()`. The token is read
 * on every call.
 */
export function createBridgeClient(options?: {
  port?: number;
  tokenPath?: string;
}): BridgeClient {
  return {
    async command(command) {
      const port =
        options?.port ??
        (process.env.BRIDGE_PORT
          ? Number(process.env.BRIDGE_PORT)
          : DEFAULT_PORT);
      const tokenPath =
        options?.tokenPath ??
        process.env.BRIDGE_AGENT_TOKEN_FILE ??
        defaultAgentTokenPath();
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
        res = await fetch(`http://127.0.0.1:${String(port)}/agent/command`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(command),
        });
      } catch {
        return unreachable(
          `cannot reach the bridge on port ${String(port)}; start it with npm run bridge`,
        );
      }
      try {
        const parsed = agentCommandResponseSchema.safeParse(await res.json());
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
