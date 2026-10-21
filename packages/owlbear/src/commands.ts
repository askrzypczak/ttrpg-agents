import {
  PROTOCOL_VERSION,
  type BridgeMessage,
  type Command,
  type CommandResult,
} from "@ttrpg-agents/protocol";
import { isOurs, type EncounterSync } from "./encounter-sync.js";
import { describeError } from "./panel-state.js";
import type { ObrAdapter } from "./obr-adapter.js";

/** Answers a bridge `command` from the scene and the encounter sync state. */
export async function handleCommand(
  obr: ObrAdapter,
  sync: EncounterSync,
  command: Command,
): Promise<CommandResult> {
  switch (command.name) {
    case "scene-status": {
      const sceneReady = await obr.isSceneReady();
      const tokenCount = sceneReady ? (await obr.getItems(isOurs)).length : 0;
      return {
        name: "scene-status",
        result: {
          sceneReady,
          tokenCount,
          appliedInstanceCount: sync.appliedInstanceCount(),
        },
      };
    }
  }
}

/** The `command-result` reply to the command with `id`. */
export function commandReply(id: string, result: CommandResult): BridgeMessage {
  return { v: PROTOCOL_VERSION, type: "command-result", id, payload: result };
}

/**
 * The message to send back for command `id`: its `command-result`, or a
 * non-fatal `command-failed` error with the same id if handling throws.
 */
export async function replyToCommand(
  obr: ObrAdapter,
  sync: EncounterSync,
  id: string,
  command: Command,
): Promise<BridgeMessage> {
  try {
    return commandReply(id, await handleCommand(obr, sync, command));
  } catch (e) {
    return {
      v: PROTOCOL_VERSION,
      type: "error",
      id,
      payload: {
        code: "command-failed",
        message: describeError(e),
        fatal: false,
      },
    };
  }
}
