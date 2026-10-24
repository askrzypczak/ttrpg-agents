import type { InstanceEdit } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

export const INSTANCE_EDIT_ID_PREFIX = "instance-edit:";

/**
 * The `instance-edit` request for HP, max HP or armor class edited on the
 * table. Its envelope id is unique per call and names the instance, so the
 * bridge's error reply and the store's event can be matched back to it.
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
 * An edit as single-field edits, one per field it sets, in the order the
 * store applies them: max HP, then HP, then armor class.
 */
export function splitEdit(edit: InstanceEdit): InstanceEdit[] {
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
  if (
    message.type !== "error" ||
    message.payload.fatal ||
    !message.id?.startsWith(INSTANCE_EDIT_ID_PREFIX)
  )
    return undefined;
  const instanceId = message.id.slice(INSTANCE_EDIT_ID_PREFIX.length);
  return `Could not apply the edit to ${instanceId}: ${message.payload.message}`;
}
