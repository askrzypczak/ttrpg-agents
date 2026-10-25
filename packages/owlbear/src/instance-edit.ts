import type { InstanceEdit } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

export const INSTANCE_EDIT_ID_PREFIX = "instance-edit:";

/**
 * The `instance-edit` request for HP, max HP, armor class or initiative edited on the
 * table. Its envelope id is unique per call and names the instance, so the
 * bridge's error reply and the store's event can be matched back to it.
 */
export function instanceEditMessage(edit: InstanceEdit): BridgeMessage {
  return {
    v: 1,
    type: "instance-edit",
    id: `${INSTANCE_EDIT_ID_PREFIX}${edit.instanceId}:${crypto.randomUUID()}`,
    payload: edit,
  };
}

/**
 * An edit as single-field edits, one per field it sets, in the order the
 * store applies them: max HP, then HP, then armor class, then initiative.
 */
export function splitEdit(edit: InstanceEdit): InstanceEdit[] {
  const { instanceId } = edit;
  const parts: InstanceEdit[] = [];
  if (edit.maxHp !== undefined) parts.push({ instanceId, maxHp: edit.maxHp });
  if (edit.currentHp !== undefined)
    parts.push({ instanceId, currentHp: edit.currentHp });
  if (edit.armorClass !== undefined)
    parts.push({ instanceId, armorClass: edit.armorClass });
  if (edit.initiative !== undefined)
    parts.push({ instanceId, initiative: edit.initiative });
  return parts;
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
  // The id is `instance-edit:<instanceId>:<unique suffix>`.
  const rest = message.id.slice(INSTANCE_EDIT_ID_PREFIX.length);
  const instanceId = rest.slice(0, rest.lastIndexOf(":"));
  return `Could not apply the edit to ${instanceId}: ${message.payload.message}`;
}
