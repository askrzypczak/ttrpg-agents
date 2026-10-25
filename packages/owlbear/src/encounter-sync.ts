import { tokenArtSchema, type TokenArt } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { instanceEditMessage, splitEdit } from "./instance-edit.js";
import { tokenDeletedMessage } from "./token-deleted.js";
import { tokenArtMessage } from "./token-art.js";
import { nextDelay, type BackoffOptions } from "./backoff.js";
import type { ObrAdapter } from "./obr-adapter.js";
import { createOutbox } from "./outbox.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem } from "./scene-model.js";
import {
  EDIT_FIELD_NAMES,
  PLACED_METADATA_KEY,
  defaultSyncConfig,
  instanceIdOf,
  planSync,
  type EditField,
  type EncounterInstance,
  type FieldContext,
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
 * The instance and the edit fields an event carries, with the store's values;
 * `undefined` for an event that carries none.
 */
function editFieldsOf(
  event: EncounterEventPayload,
): { id: string; fields: [EditField, number][] } | undefined {
  if (event.type === "hp-changed")
    return {
      id: event.id,
      fields: [
        ["currentHp", event.currentHp],
        ["maxHp", event.maxHp],
      ],
    };
  if (
    event.type === "instance-changed" &&
    event.changes.armorClass !== undefined
  )
    return { id: event.id, fields: [["armorClass", event.changes.armorClass]] };
  return undefined;
}

/**
 * Per instance id, per edit field, what the events and refusals since the
 * last successful reconcile say: the store `moved` it, or it settled at a
 * value. A later fact replaces an earlier one.
 */
type Facts = Map<string, Map<EditField, "moved" | number>>;

/**
 * Holds the desired encounter (the latest snapshot folded with later events,
 * in `seq` order) and reconciles the scene against it on every trigger: a message, the scene
 * becoming ready, an item change, or a retry. Reconciles run one at a time,
 * in arrival order. One on a scene that is not ready is skipped (the ready flip runs it). A
 * failing one on a ready scene is reported to `onError` and retried with
 * backoff until a later trigger or success; a scene that goes away mid-apply
 * is deferred silently. `onApplied` fires after each successful reconcile, except a quiet one (from an
 * item change) that was not recovering from a failure.
 * Events before the first snapshot are ignored (the bridge sends a snapshot
 * on connect). After it, an event whose `seq` is not past the last one seen is
 * a duplicate and ignored; one that skips ahead is a gap: nothing is applied,
 * `onGap` is called once, and events are ignored until the next snapshot.
 *
 * Commands (table edits, one field each, token deletions and token art picks)
 * go through an outbox over `options.send`: one that cannot go out waits for
 * the next `hello-ack`, and each is remembered until the store settles it. An
 * art pick gets no answer, so it is remembered until the snapshot after the
 * next `hello-ack` and is never sent again. A `table`
 * event with the id of a sent edit acknowledges it: the token keeps the typed
 * value (a clamp shows a note through `onEditDiffers`), and a field the edit
 * did not set that the store changed is pushed. A `table` event with an id the
 * extension does not know settles its fields at the store's value. A refused
 * edit is settled at its sent value, so it is not sent again. An `mcp` event
 * pushes the fields it changes, unless an edit of the field is in flight. A
 * snapshot with no `hello-ack` since the last one (sent on the same
 * connection, in place of an unreadable change-log row) forgets the sent
 * edits, whose answers its `seq` may cover.
 */
export function createEncounterSync(
  obr: ObrAdapter,
  onError: (error: unknown) => void = () => {},
  onApplied: () => void = () => {},
  options: {
    timers?: Timers;
    backoff?: BackoffOptions;
    /**
     * Sends a command (a token deletion, a table edit or a token art pick) to
     * the bridge; returns false when it did not go out. Without it commands
     * are neither sent nor remembered.
     */
    send?: (message: BridgeMessage) => boolean;
    /** Called when the number of commands waiting for the bridge changes. */
    onWaitingChange?: (waiting: number) => void;
    /** Called once per Stat Bubbles field a snapshot pushed over a different token value, with the record to show. */
    onSnapshotOverride?: (text: string) => void;
    /** Called once per store change (a snapshot or an applied `mcp` event) for each table value that could not be read back. */
    onEditRejected?: (text: string) => void;
    /** Called once per acknowledged edit whose store value differs from the sent one, with the note to show. */
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
  const outbox =
    options.send === undefined
      ? undefined
      : createOutbox(options.send, options.onWaitingChange);
  // What the next reconcile is told: the facts since the last successful one,
  // and whether a snapshot arrived since.
  let facts: Facts = new Map();
  // Stryker disable next-line BooleanLiteral: equivalent, nothing reconciles before the first snapshot, which sets it
  let afterSnapshot = false;
  // Whether a hello-ack came since the last snapshot. A snapshot without one
  // came on the same connection (in place of an unreadable change-log row).
  // Stryker disable next-line BooleanLiteral: equivalent, no edit is sent before the first snapshot
  let ackedSinceSnapshot = false;

  /**
   * A snapshot on the same connection is current as of a `seq` that may cover
   * the answers of edits already sent, and those answers never arrive. Forget
   * those edits so that they block nothing: one the store has not applied yet
   * is planned and sent again, which is harmless (edits are absolute).
   */
  function forgetSentEdits(): void {
    for (const { id, message, queued } of outbox?.pending() ?? [])
      // Stryker disable next-line ConditionalExpression: equivalent, a queued edit forgotten here is planned and queued again
      if (!queued && message.type === "instance-edit") outbox?.settle(id);
  }

  function record(
    instanceId: string,
    field: EditField,
    fact: "moved" | number,
  ): void {
    let fields = facts.get(instanceId);
    if (fields === undefined) facts.set(instanceId, (fields = new Map()));
    fields.set(field, fact);
  }

  /** The facts of a reconcile that did not go through, under the newer ones. */
  function restore(taken: Facts, snapshot: boolean): void {
    for (const [id, earlier] of taken)
      facts.set(id, new Map([...earlier, ...(facts.get(id) ?? [])]));
    afterSnapshot ||= snapshot;
  }

  /** The planner's per-instance field context: `taken` plus the edits in flight. */
  function fieldContexts(taken: Facts): Map<string, FieldContext> {
    const contexts = new Map<
      string,
      {
        moved: Set<EditField>;
        settled: Partial<Record<EditField, number>>;
        inflight: Partial<Record<EditField, number>>;
      }
    >();
    const of = (id: string) => {
      let context = contexts.get(id);
      if (context === undefined)
        contexts.set(
          id,
          (context = { moved: new Set(), settled: {}, inflight: {} }),
        );
      return context;
    };
    for (const [id, fields] of taken)
      for (const [field, fact] of fields) {
        if (fact === "moved") of(id).moved.add(field);
        else of(id).settled[field] = fact;
      }
    // Later commands for a field replace earlier ones.
    for (const { message } of outbox?.pending() ?? []) {
      // Stryker disable next-line ConditionalExpression: equivalent, a token deletion or art pick sets no edit field; this narrows the type
      if (message.type !== "instance-edit") continue;
      const { instanceId, ...edit } = message.payload;
      Object.assign(of(instanceId).inflight, edit);
    }
    return contexts;
  }

  const deletionPending = (instanceId: string): boolean =>
    outbox
      ?.pending()
      .some(
        ({ message }) =>
          message.type === "token-deleted" &&
          message.payload.instanceId === instanceId,
      ) === true;

  /**
   * A `table` event: settles the command it acknowledges and records what it
   * says about the edit fields, before it is folded into `desired`.
   */
  function acknowledge(event: EncounterEventPayload): void {
    const command = outbox?.settle(event.origin.commandId);
    const carried = editFieldsOf(event);
    if (carried === undefined) return;
    const { id, fields } = carried;
    if (command === undefined) {
      // Not ours (or sent before a reload): the store's values are agreed.
      for (const [field, value] of fields) record(id, field, value);
      return;
    }
    // Stryker disable next-line ConditionalExpression: equivalent, only an edit's events carry edit fields; this narrows the type
    if (command.message.type !== "instance-edit") return;
    const sent = command.message.payload;
    const before = desired?.find((i) => i.id === id);
    const clauses: string[] = [];
    for (const [field, value] of fields) {
      const typed = sent[field];
      if (typed === undefined) {
        // A side effect of the edit (HP lowered by a max HP edit).
        if (before?.[field] !== value) record(id, field, "moved");
        continue;
      }
      record(id, field, typed);
      if (value !== typed)
        clauses.push(
          `${EDIT_FIELD_NAMES[field]} ${String(value)} for ${before?.displayName ?? id}, not the ${String(typed)} on the table`,
        );
    }
    if (clauses.length > 0)
      options.onEditDiffers?.(
        `The store holds ${clauses.join("; ")}; the token keeps your value.`,
      );
  }

  /** An `mcp` event: the edit fields whose value it changes have moved. */
  function noteMoved(event: EncounterEventPayload): void {
    const carried = editFieldsOf(event);
    if (carried === undefined) return;
    const before = desired?.find((i) => i.id === carried.id);
    for (const [field, value] of carried.fields)
      if (before?.[field] !== value) record(carried.id, field, "moved");
  }

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

  async function apply(
    wanted: EncounterInstance[],
    taken: Facts,
    snapshot: boolean,
  ): Promise<SyncPlan> {
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
      snapshot,
    };
    const first = planSync(wanted, items, defaultSyncConfig, {
      ...context,
      art,
      fields: fieldContexts(taken),
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
      outbox?.submit(tokenArtMessage(monsterKey, chosen));
    }
    const plan = planSync(wanted, items, defaultSyncConfig, {
      ...context,
      art,
      fields: fieldContexts(taken),
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
    // Facts that arrive while this reconcile applies are for the next one.
    const taken = facts;
    const snapshot = afterSnapshot;
    facts = new Map();
    afterSnapshot = false;
    let plan: SyncPlan;
    try {
      plan = await apply(applying, taken, snapshot);
    } catch (error) {
      restore(taken, snapshot);
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
    // One command per field, so each has exactly one acknowledging event.
    for (const edit of plan.edits)
      for (const part of splitEdit(edit))
        outbox?.submit(instanceEditMessage(part));
    for (const { message } of plan.overrides)
      options.onSnapshotOverride?.(message);
    for (const { message } of plan.rejected) {
      if (rejectedReported.has(message)) continue;
      rejectedReported.add(message);
      options.onEditRejected?.(message);
    }
    for (const id of plan.deleted) {
      if (reported.has(id) || deletionPending(id)) continue;
      reported.add(id);
      outbox?.submit(tokenDeletedMessage(id));
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
      if (message.type === "hello-ack") {
        ackedSinceSnapshot = true;
        // Before the snapshot that follows is applied.
        outbox?.helloAck();
        return Promise.resolve();
      }
      if (message.type === "encounter-snapshot") {
        if (!ackedSinceSnapshot) forgetSentEdits();
        ackedSinceSnapshot = false;
        outbox?.snapshot();
        desired = message.payload.instances;
        art = { ...art, ...message.payload.art };
        seq = message.payload.seq;
        afterSnapshot = true;
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
        const event = message.payload;
        if (event.origin.source === "table") {
          // The table already shows its own change: no store change to
          // report, so a clamp note it brings stays.
          acknowledge(event);
          desired = fold(desired, event);
        } else {
          noteMoved(event);
          desired = fold(desired, event);
          reported.clear();
          rejectedReported.clear();
          options.onStoreChange?.();
        }
      } else if (
        message.type === "error" &&
        !message.payload.fatal &&
        // Stryker disable next-line ConditionalExpression: equivalent, a pending command's id is never undefined (an art pick's is ""), so none is settled for an error without one
        message.id !== undefined
      ) {
        // A refused edit: the token keeps the typed value (main.ts shows the
        // error), and it is agreed so that it is not sent again.
        const command = outbox?.settle(message.id);
        if (command?.message.type !== "instance-edit") return Promise.resolve();
        const { instanceId, ...edit } = command.message.payload;
        for (const [field, value] of Object.entries(edit) as [
          EditField,
          number | undefined,
        ][])
          // Stryker disable next-line ConditionalExpression: equivalent, a sent edit carries only the fields it sets (splitEdit), and an undefined settled value counts as unsettled
          if (value !== undefined) record(instanceId, field, value);
      } else {
        return Promise.resolve();
      }
      // A snapshot, an event or a refused edit.
      return enqueue(reconcile);
    },
    appliedInstanceCount() {
      return appliedCount;
    },
  };
}
