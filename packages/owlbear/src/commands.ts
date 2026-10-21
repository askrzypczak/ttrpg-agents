import type {
  BridgeMessage,
  Command,
  CommandResult,
} from "@ttrpg-agents/protocol";
import type { EncounterSync } from "./encounter-sync.js";
import type { ObrAdapter } from "./obr-adapter.js";

/** Answers a bridge `command` from the scene and the encounter sync state. */
export function handleCommand(
  obr: ObrAdapter,
  sync: EncounterSync,
  command: Command,
): Promise<CommandResult> {
  void obr;
  void sync;
  void command;
  throw new Error("not implemented");
}

/** The `command-result` reply to the command with `id`. */
export function commandReply(id: string, result: CommandResult): BridgeMessage {
  void id;
  void result;
  throw new Error("not implemented");
}
