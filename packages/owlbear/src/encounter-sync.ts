import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { nextDelay, type BackoffOptions } from "./backoff.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem } from "./scene-model.js";
import {
  PLACED_METADATA_KEY,
  defaultSyncConfig,
  instanceIdOf,
  planSync,
  type EncounterInstance,
} from "./sync-plan.js";

export type EncounterEventPayload = Extract<
  BridgeMessage,
  { type: "encounter-event" }
>["payload"];

/** Whether a scene item is one of our instance tokens. */
export const isOurs = (item: SceneItem): boolean =>
  instanceIdOf(item) !== undefined;

export interface EncounterSync {
  /** Resolves once the message is applied, or deferred until the scene is ready. */
  handleMessage(message: BridgeMessage): Promise<void>;
  /** How many instances the successfully applied messages account for (held or failed ones do not count). */
  appliedInstanceCount(): number;
}

// Stryker disable all: real timers are only used in the browser; tests inject Timers
const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
// Stryker restore all

function fold(
  desired: EncounterInstance[],
  event: EncounterEventPayload,
): EncounterInstance[] {
  switch (event.type) {
    case "added": {
      const have = new Set(desired.map((i) => i.id));
      return [...desired, ...event.instances.filter((i) => !have.has(i.id))];
    }
    case "removed":
      return desired.filter((i) => i.id !== event.id);
    case "cleared":
      return [];
    // Stryker disable all: no projector reads hp until #67
    case "hp-changed":
      return desired.map((i) =>
        i.id === event.id
          ? { ...i, currentHp: event.currentHp, maxHp: event.maxHp }
          : i,
      );
    // Stryker restore all
  }
}

/**
 * Holds the desired encounter (the latest snapshot folded with later events)
 * and reconciles the scene against it on every trigger: a message, the scene
 * becoming ready, or a retry. Reconciles run one at a time, in arrival order.
 * One on a scene that is not ready is skipped (the ready flip runs it). A
 * failing one on a ready scene is reported to `onError` and retried with
 * backoff until a later trigger or success; a scene that goes away mid-apply
 * is deferred silently. `onApplied` fires after each successful reconcile.
 * Events before the first snapshot are ignored (the bridge sends a snapshot
 * on connect).
 */
export function createEncounterSync(
  obr: ObrAdapter,
  onError: (error: unknown) => void = () => {},
  onApplied: () => void = () => {},
  options: { timers?: Timers; backoff?: BackoffOptions } = {},
): EncounterSync {
  const timers = options.timers ?? defaultTimers;
  let desired: EncounterInstance[] | null = null;
  let appliedCount = 0;
  let tail: Promise<void> = Promise.resolve();
  let retry: unknown = null;
  let attempt = 0;

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    // Never let the chain reject, or every later trigger would be skipped.
    tail = tail.then(task).catch(() => {});
    return tail;
  };

  async function apply(wanted: EncounterInstance[]): Promise<void> {
    const items = await obr.getItems();
    const stored = (await obr.getSceneMetadata())[PLACED_METADATA_KEY];
    const placed = new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [],
    );
    const plan = planSync(wanted, items, defaultSyncConfig, {
      viewportCenter: await obr.getViewportCenter(),
      placed,
    });
    if (plan.delete.length > 0) await obr.deleteItems(plan.delete);
    if (plan.add.length > 0) await obr.addItems(plan.add);
    if (plan.update.length > 0) await obr.setItemMetadata(plan.update);

    // Remember which instances now have a token, so a token the GM deletes
    // later stays deleted; forget instances that left the encounter.
    const doomed = new Set(plan.delete);
    const present = [
      // Stryker disable next-line all: equivalent, a deleted token's id is not wanted or is also on a kept token
      ...items.filter((item) => !doomed.has(item.id)),
      ...plan.add,
    ].map(instanceIdOf);
    const wantedIds = new Set(wanted.map((i) => i.id));
    const next = new Set(
      [...placed, ...present].filter(
        (id): id is string => id !== undefined && wantedIds.has(id),
      ),
    );
    if (next.size !== placed.size || [...next].some((id) => !placed.has(id)))
      await obr.setSceneMetadata({ [PLACED_METADATA_KEY]: [...next] });
  }

  async function reconcile(): Promise<void> {
    if (retry !== null) {
      timers.clearTimeout(retry);
      retry = null;
    }
    if (desired === null || !(await obr.isSceneReady())) return;
    const applying = desired;
    try {
      await apply(applying);
    } catch (error) {
      // The scene went away mid-apply: the ready flip reconciles again.
      if (!(await obr.isSceneReady())) return;
      try {
        onError(error);
      } catch {
        // A throwing handler must not stop later reconciles.
      }
      retry = timers.setTimeout(
        () => {
          retry = null;
          void enqueue(reconcile);
        },
        nextDelay(attempt++, options.backoff),
      );
      return;
    }
    attempt = 0;
    appliedCount = applying.length;
    onApplied();
  }

  obr.onSceneReadyChange((ready) => {
    if (ready) void enqueue(reconcile);
  });

  return {
    handleMessage(message) {
      if (message.type === "encounter-snapshot") {
        desired = message.payload.instances;
      } else if (message.type === "encounter-event") {
        if (desired === null) return Promise.resolve();
        desired = fold(desired, message.payload);
      } else {
        return Promise.resolve();
      }
      return enqueue(reconcile);
    },
    appliedInstanceCount() {
      return appliedCount;
    },
  };
}
