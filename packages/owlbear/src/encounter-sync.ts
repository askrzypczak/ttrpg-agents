import type { BridgeMessage } from "@ttrpg-agents/protocol";
import type { BackoffOptions } from "./backoff.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";

export type EncounterEventPayload = Extract<
  BridgeMessage,
  { type: "encounter-event" }
>["payload"];

export interface EncounterSync {
  /** Resolves once the message is applied, or deferred until the scene is ready. */
  handleMessage(message: BridgeMessage): Promise<void>;
}

/**
 * Holds the desired encounter (latest snapshot folded with later events) and
 * reconciles the scene against it on every trigger (message, scene ready,
 * retry). See the plan in sync-plan.ts.
 */
export function createEncounterSync(
  obr: ObrAdapter,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onError: (error: unknown) => void = () => {},
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onApplied: () => void = () => {},
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: { timers?: Timers; backoff?: BackoffOptions },
): EncounterSync {
  throw new Error("not implemented");
}
