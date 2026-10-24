import type { InstanceEdit } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

/**
 * The `instance-edit` request for HP, max HP or armor class edited on the
 * table. Its envelope id is `instance-edit:<instanceId>`, so the bridge's
 * error reply can be matched back to it.
 */
export function instanceEditMessage(edit: InstanceEdit): BridgeMessage {
  void edit;
  throw new Error("not implemented");
}

/**
 * Panel text for a non-fatal bridge `error` that answers an `instance-edit`
 * request; `undefined` for any other message.
 */
export function instanceEditErrorText(
  message: BridgeMessage,
): string | undefined {
  void message;
  throw new Error("not implemented");
}
