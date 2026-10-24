import { tokenArtSchema, type TokenArt } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { instanceEditMessage } from "./instance-edit.js";
import { tokenDeletedMessage } from "./token-deleted.js";
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
  type SyncPlan,
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
    case "instance-changed": {
      const { name, ...fields } = event.changes;
      return desired.map((i) =>
        i.id === event.id
          ? {
              ...i,
              ...fields,
              ...(name === undefined ? {} : { displayName: name }),
            }
          : i,
      );
    }
    case "hp-changed":
      return desired.map((i) =>
        i.id === event.id
          ? { ...i, currentHp: event.currentHp, maxHp: event.maxHp }
          : i,
      );
  }
}

/**
 * Holds the desired encounter (the latest snapshot folded with later `mcp`
 * events, in `seq` order) and reconciles the scene against it on every trigger: a message, the scene
 * becoming ready, an item change, or a retry. Reconciles run one at a time,
 * in arrival order. One on a scene that is not ready is skipped (the ready flip runs it). A
 * failing one on a ready scene is reported to `onError` and retried with
 * backoff until a later trigger or success; a scene that goes away mid-apply
 * is deferred silently. `onApplied` fires after each successful reconcile, except a quiet one (from an
 * item change) that was not recovering from a failure.
 * Events before the first snapshot are ignored (the bridge sends a snapshot
 * on connect). After it, an event whose `seq` is not past the last one seen is
 * a duplicate and ignored; one that skips ahead is a gap: nothing is applied,
 * `onGap` is called once, and events are ignored until the next snapshot. A
 * `table` event only advances the `seq` (the table already shows it).
 */
export function createEncounterSync(
  obr: ObrAdapter,
  onError: (error: unknown) => void = () => {},
  onApplied: () => void = () => {},
  options: {
    timers?: Timers;
    backoff?: BackoffOptions;
    /**
     * Sends a command (a token deletion or a table edit) to the bridge;
     * returns false when it did not go out. Without it commands are neither
     * sent nor remembered.
     */
    send?: (message: BridgeMessage) => boolean;
    /** Called when the number of commands waiting for the bridge changes. */
    onWaitingChange?: (waiting: number) => void;
    /** Called once per Stat Bubbles field a snapshot pushed over a different token value, with the record to show. */
    onSnapshotOverride?: (text: string) => void;
    /** Called with the art the GM picked for a monster type, to store it. */
    onTokenArt?: (monsterKey: string, art: TokenArt) => void;
    /** Called once per store change (a snapshot or an applied `mcp` event) for each table value that could not be read back. */
    onEditRejected?: (text: string) => void;
    /** Called once per answered edit whose table value differs from the store's, with the note to show. */
    onEditDiffers?: (text: string) => void;
    /** Called when a snapshot or an applied `mcp` event changes what the store says. */
    onStoreChange?: () => void;
    /** Called once when an event arrives with a gap in `seq`: the caller should reconnect for a snapshot. */
    onGap?: () => void;
  } = {},
): EncounterSync {
  const timers = options.timers ?? defaultTimers;
  let desired: EncounterInstance[] | null = null;
  // Log position of the last snapshot or applied event. Null before the first
  // snapshot and after a gap, when events are ignored until the next snapshot.
  let seq: number | null = null;
  let appliedCount = 0;
  let tail: Promise<void> = Promise.resolve();
  let retry: unknown = null;
  let attempt = 0;
  // Monster key -> art, from the snapshots and the GM's picks this session.
  let art: Record<string, TokenArt> = {};
  // Monster types the GM declined (or whose pick was unusable) this session.
  const declined = new Set<string>();
  // Deleted tokens already reported since the last store change.
  const reported = new Set<string>();
  // Unreadable table values already reported since the last store change.
  const rejectedReported = new Set<string>();
  // Item changes coalesce: at most one quiet reconcile is `queued`. Changes
  // raised synchronously by our own write calls (`writing`) are ignored.
  let writing = false;
  let queued = false;

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    // Never let the chain reject, or every later trigger would be skipped.
    tail = tail.then(task).catch(() => {});
    return tail;
  };

  async function write(call: () => Promise<void>): Promise<void> {
    writing = true;
    try {
      await call();
    } finally {
      writing = false;
    }
  }

  /** The GM's pick, or `undefined` for a cancel, an error or an unusable image. */
  async function pickArt(): Promise<TokenArt | undefined> {
    try {
      const parsed = tokenArtSchema.safeParse(await obr.pickImage());
      if (parsed.success) return parsed.data;
    } catch {
      // A picker error is the same as no pick.
    }
    return undefined;
  }

  async function apply(wanted: EncounterInstance[]): Promise<SyncPlan> {
    const items = await obr.getItems();
    const stored = (await obr.getSceneMetadata())[PLACED_METADATA_KEY];
    const placed = new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [],
    );
    const context = {
      viewportCenter: await obr.getViewportCenter(),
      placed,
    };
    const first = planSync(wanted, items, defaultSyncConfig, {
      ...context,
      art,
    });
    // Ask once per new monster type, before anything is written, so its
    // tokens are created once with the right look.
    for (const monsterKey of first.needsArt) {
      if (declined.has(monsterKey)) continue;
      const chosen = await pickArt();
      if (chosen === undefined) {
        declined.add(monsterKey);
        continue;
      }
      art = { ...art, [monsterKey]: chosen };
      options.onTokenArt?.(monsterKey, chosen);
    }
    const plan = planSync(wanted, items, defaultSyncConfig, {
      ...context,
      art,
    });
    if (plan.delete.length > 0) await write(() => obr.deleteItems(plan.delete));
    if (plan.add.length > 0) await write(() => obr.addItems(plan.add));
    // Before the metadata write, so a failed rename leaves the baseline
    // unwritten and the retry renames.
    for (const r of plan.rename)
      await write(() => obr.updateItems([r.id], { name: r.name }));
    if (plan.update.length > 0)
      await write(() => obr.setItemMetadata(plan.update));

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
    return plan;
  }

  async function reconcile(quiet = false): Promise<void> {
    if (retry !== null) {
      timers.clearTimeout(retry);
      retry = null;
    }
    if (desired === null || !(await obr.isSceneReady())) return;
    const applying = desired;
    let plan: SyncPlan;
    try {
      plan = await apply(applying);
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
    const recovered = attempt > 0;
    attempt = 0;
    appliedCount = applying.length;
    if (!quiet || recovered) onApplied();
    for (const edit of plan.edits) options.send?.(instanceEditMessage(edit));
    for (const { message } of plan.rejected) {
      if (rejectedReported.has(message)) continue;
      rejectedReported.add(message);
      options.onEditRejected?.(message);
    }
    for (const id of plan.deleted) {
      if (reported.has(id)) continue;
      reported.add(id);
      options.send?.(tokenDeletedMessage(id));
    }
  }

  // A table change (including our own writes) reconciles quietly: it reports
  // deleted tokens but is not an apply the panel should hear about.
  function queueQuiet(): void {
    if (queued) return;
    queued = true;
    // Yield a macrotask (real timer, not the injectable retry timers) so a
    // burst coalesces and two syncs on one scene cannot starve the event loop.
    defaultTimers.setTimeout(() => {
      void enqueue(() => {
        queued = false;
        return reconcile(true);
      });
    }, 0);
  }
  obr.onItemsChange(() => {
    if (writing) return;
    queueQuiet();
  });
  obr.onSceneReadyChange((ready) => {
    if (ready) void enqueue(reconcile);
  });

  return {
    handleMessage(message) {
      if (message.type === "encounter-snapshot") {
        desired = message.payload.instances;
        art = { ...art, ...message.payload.art };
        seq = message.payload.seq;
        reported.clear();
        rejectedReported.clear();
        options.onStoreChange?.();
      } else if (message.type === "encounter-event") {
        // Stryker disable next-line ConditionalExpression: equivalent, desired is null only before the first snapshot, when seq is null too
        if (desired === null) return Promise.resolve();
        if (seq === null) return Promise.resolve();
        const { seq: eventSeq } = message.payload;
        if (eventSeq <= seq) return Promise.resolve();
        if (eventSeq > seq + 1) {
          seq = null;
          options.onGap?.();
          return Promise.resolve();
        }
        seq = eventSeq;
        // The table already shows its own change, and the answer snapshot
        // carried the store's value: nothing to apply or reset.
        if (message.payload.origin.source === "table") return Promise.resolve();
        desired = fold(desired, message.payload);
        reported.clear();
        rejectedReported.clear();
        options.onStoreChange?.();
      } else {
        // A refused edit needs no reconcile: the token keeps the typed value
        // and main.ts shows the error.
        return Promise.resolve();
      }
      // A snapshot or an event.
      return enqueue(reconcile);
    },
    appliedInstanceCount() {
      return appliedCount;
    },
  };
}
