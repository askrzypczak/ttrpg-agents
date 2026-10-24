import type { InstanceEdit } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

export const INSTANCE_EDIT_ID_PREFIX = "instance-edit:";

/**
 * The `instance-edit` request for HP, max HP or armor class edited on the
 * table. Its envelope id is `instance-edit:<instanceId>`, so the bridge's
 * error reply can be matched back to it.
 */
export function instanceEditMessage(edit: InstanceEdit): BridgeMessage {
  return {
    v: 1,
    type: "instance-edit",
    id: `${INSTANCE_EDIT_ID_PREFIX}${edit.instanceId}`,
    payload: edit,
  };
}

/**
 * Panel text for a non-fatal bridge `error` that answers an `instance-edit`
 * request; `undefined` for any other message.
 */
export function instanceEditErrorText(
  message: BridgeMessage,
): string | undefined {
  if (
    message.type !== "error" ||
    message.payload.fatal ||
    !message.id?.startsWith(INSTANCE_EDIT_ID_PREFIX)
  )
    return undefined;
  const instanceId = message.id.slice(INSTANCE_EDIT_ID_PREFIX.length);
  return `Could not apply the edit to ${instanceId}: ${message.payload.message}`;
}
