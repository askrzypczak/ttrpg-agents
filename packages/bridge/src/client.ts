// Node-only client for the bridge's `POST /agent/command`, the one bridge
// module `@ttrpg-agents/mcp` may import (`@ttrpg-agents/bridge/client`). It
// imports only Node builtins, `@ttrpg-agents/protocol` and `./token-file.js`.
import type { AgentCommandResponse, Command } from "@ttrpg-agents/protocol";

export interface BridgeClient {
  command(command: Command): Promise<AgentCommandResponse>;
}

/** Reads the agent token file (trimmed). */
export function readAgentToken(path: string): Promise<string> {
  void path;
  throw new Error("not implemented");
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
  void options;
  // TODO(#98) contract stub: building the client is harmless (stdio.ts does it
  // at startup); every command throws until implemented.
  return {
    command() {
      throw new Error("not implemented");
    },
  };
}
