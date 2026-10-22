import type { BridgeMessage } from "@ttrpg-agents/protocol";

const ID_PREFIX = "token-deleted:";

/**
 * The `token-deleted` request for an instance whose token the GM deleted.
 * Its envelope id is `token-deleted:<instanceId>`, so the bridge's error
 * reply can be matched back to it.
 */
export function tokenDeletedMessage(instanceId: string): BridgeMessage {
  return {
    v: 1,
    type: "token-deleted",
    id: `${ID_PREFIX}${instanceId}`,
    payload: { instanceId },
  };
}

/**
 * Panel text for a non-fatal bridge `error` that answers a `token-deleted`
 * request; `undefined` for any other message.
 */
export function tokenDeletedErrorText(
  message: BridgeMessage,
): string | undefined {
  if (
    message.type !== "error" ||
    message.payload.fatal ||
    !message.id?.startsWith(ID_PREFIX)
  )
    return undefined;
  const instanceId = message.id.slice(ID_PREFIX.length);
  return `Could not remove ${instanceId} from the encounter: ${message.payload.message}`;
}
