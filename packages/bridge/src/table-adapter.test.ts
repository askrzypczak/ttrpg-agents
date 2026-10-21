import { TableUnavailableError } from "@ttrpg-agents/engine";
import {
  agentErrorCodeSchema,
  type AgentCommandResponse,
  type Command,
} from "@ttrpg-agents/protocol";
import { describe, expect, it } from "vitest";
import { createBridgeTable, type BridgeClient } from "./client.js";

/** A stub client that records commands and answers each with `response`. */
function clientAnswering(response: AgentCommandResponse): {
  client: BridgeClient;
  commands: Command[];
} {
  const commands: Command[] = [];
  return {
    commands,
    client: {
      command: (command) => {
        commands.push(command);
        return Promise.resolve(response);
      },
    },
  };
}

describe("createBridgeTable", () => {
  it("returns the scene counts from an ok `scene-status` result (A11, AC4)", async () => {
    const { client, commands } = clientAnswering({
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
    expect(commands).toEqual([{ name: "scene-status" }]);
  });

  it("throws `TableUnavailableError` carrying the bridge's message for any `{ ok: false }` response, each error code (A11, AC3)", async () => {
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
