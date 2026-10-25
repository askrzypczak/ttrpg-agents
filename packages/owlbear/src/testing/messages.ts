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

const DEFAULT_ORIGIN: ChangeOrigin = { source: "mcp", commandId: "test" };

export function createMessageFeed(): MessageFeed {
  let position = 0;
  return {
    snapshot(instances, options = {}) {
      const { art, seq = position } = options;
      position = seq;
      return {
        v: 1,
        type: "encounter-snapshot",
        payload: { instances, ...(art === undefined ? {} : { art }), seq },
      };
    },
    event(event, options = {}) {
      const seq = options.seq ?? position + 1;
      position = seq;
      const payload = {
        ...event,
        origin: event.origin ?? DEFAULT_ORIGIN,
        seq,
      } as Extract<BridgeMessage, { type: "encounter-event" }>["payload"];
      return { v: 1, type: "encounter-event", payload };
    },
  };
}
