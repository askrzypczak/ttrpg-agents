import type {
  ChangeOrigin,
  EncounterEvent,
  MonsterInstance,
  TokenArt,
} from "@ttrpg-agents/engine";
import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";

/** Each `EncounterEvent` without its `origin`, which is optional here. */
export type TestEvent = EncounterEvent extends infer T
  ? T extends unknown
    ? Omit<T, "origin"> & { origin?: ChangeOrigin }
    : never
  : never;

/** The scene id test snapshots are for, and the one the fake adapter's scene has by default. */
export const TEST_SCENE_ID = "s1";

/**
 * Builds `encounter-snapshot` and `encounter-event` messages with the `seq`
 * filled in, so tests do not number the change log by hand. A snapshot's
 * `art` and `restoreSeqs` are put in its payload only when given. Every payload
 * names the encounter `e1`, the id `makeTestInstance` uses, unless an option
 * names another (or null); a snapshot is for the scene `TEST_SCENE_ID` and the
 * encounter "Encounter 1" unless its options say otherwise.
 */
export interface MessageFeed {
  snapshot(
    instances: MonsterInstance[],
    options?: {
      art?: Record<string, TokenArt>;
      seq?: number;
      restoreSeqs?: Record<string, number>;
      sceneId?: string | null;
      encounterId?: string | null;
      encounterName?: string | null;
    },
  ): Extract<BridgeMessage, { type: "encounter-snapshot" }>;
  event(
    event: TestEvent,
    options?: { seq?: number; encounterId?: string | null },
  ): Extract<BridgeMessage, { type: "encounter-event" }>;
}

const DEFAULT_ORIGIN: ChangeOrigin = { source: "mcp", commandId: "test" };
const ENCOUNTER_ID = "e1";
const ENCOUNTER_NAME = "Encounter 1";

export function createMessageFeed(): MessageFeed {
  let position = 0;
  return {
    snapshot(instances, options = {}) {
      const {
        art,
        restoreSeqs,
        seq = position,
        sceneId = TEST_SCENE_ID,
        encounterId = ENCOUNTER_ID,
        encounterName = ENCOUNTER_NAME,
      } = options;
      position = seq;
      return {
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: {
          instances,
          ...(art === undefined ? {} : { art }),
          ...(restoreSeqs === undefined ? {} : { restoreSeqs }),
          seq,
          encounterId,
          sceneId,
          encounterName,
        },
      };
    },
    event(event, options = {}) {
      const seq = options.seq ?? position + 1;
      position = seq;
      const encounterId =
        options.encounterId === undefined ? ENCOUNTER_ID : options.encounterId;
      const payload = {
        ...event,
        origin: event.origin ?? DEFAULT_ORIGIN,
        seq,
        encounterId,
      } as Extract<BridgeMessage, { type: "encounter-event" }>["payload"];
      return { v: PROTOCOL_VERSION, type: "encounter-event", payload };
    },
  };
}
