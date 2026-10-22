import type { BridgeMessage } from "@ttrpg-agents/protocol";

/**
 * The `token-deleted` request for an instance whose token the GM deleted.
 * Its envelope id is `token-deleted:<instanceId>`, so the bridge's error
 * reply can be matched back to it.
 */
export function tokenDeletedMessage(instanceId: string): BridgeMessage {
  void instanceId;
  throw new Error("not implemented");
}

/**
 * Panel text for a non-fatal bridge `error` that answers a `token-deleted`
 * request; `undefined` for any other message.
 */
export function tokenDeletedErrorText(
  message: BridgeMessage,
): string | undefined {
  void message;
  throw new Error("not implemented");
}
