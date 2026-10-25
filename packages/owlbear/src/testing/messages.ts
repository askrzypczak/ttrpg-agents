import type {
  ChangeOrigin,
  EncounterEvent,
  MonsterInstance,
  TokenArt,
} from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";

/** Each `EncounterEvent` without its `origin`, which is optional here. */
export type TestEvent = EncounterEvent extends infer T
  ? T extends unknown
    ? Omit<T, "origin"> & { origin?: ChangeOrigin }
    : never
  : never;

/**
 * Builds `encounter-snapshot` and `encounter-event` messages with the `seq`
 * filled in, so tests do not number the change log by hand.
 */
export interface MessageFeed {
  snapshot(
    instances: MonsterInstance[],
    options?: { art?: Record<string, TokenArt>; seq?: number },
  ): Extract<BridgeMessage, { type: "encounter-snapshot" }>;
  event(
    event: TestEvent,
    options?: { seq?: number },
  ): Extract<BridgeMessage, { type: "encounter-event" }>;
}

export function createMessageFeed(): MessageFeed {
  throw new Error("not implemented");
}
