import type { BridgeMessage } from "@ttrpg-agents/protocol";

const ID_PREFIX = "token-deleted:";

/**
 * The `token-deleted` request for an instance whose token the GM deleted.
 * Its envelope id is unique per call and names the instance, so the bridge's
 * error reply and the store's event can be matched back to it.
 */
export function tokenDeletedMessage(instanceId: string): BridgeMessage {
  return {
    v: 1,
    type: "token-deleted",
    id: `${ID_PREFIX}${instanceId}:${crypto.randomUUID()}`,
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
  // The id is `token-deleted:<instanceId>:<unique suffix>`.
  const rest = message.id.slice(ID_PREFIX.length);
  const instanceId = rest.slice(0, rest.lastIndexOf(":"));
  return `Could not remove ${instanceId} from the encounter: ${message.payload.message}`;
}
