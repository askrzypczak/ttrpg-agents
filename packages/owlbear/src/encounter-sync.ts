import {
  publishedTokenArtSchema,
  type InstanceEdit,
  type PublishedTokenArt,
  type TokenArt,
} from "@ttrpg-agents/engine";
import type {
  BridgeMessage,
  TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
import { instanceEditMessage, splitEdit } from "./instance-edit.js";
import { tokenDeletedMessage } from "./token-deleted.js";
import {
  republishName,
  tokenArtMessage,
  type StoredTokenImage,
} from "./token-art.js";
import { nextDelay, type BackoffOptions } from "./backoff.js";
import type { ObrAdapter } from "./obr-adapter.js";
import { createOutbox } from "./outbox.js";
import { describeError } from "./panel-state.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem } from "./scene-model.js";
import {
  EDIT_FIELD_NAMES,
  PLACED_METADATA_KEY,
  defaultSyncConfig,
  instanceIdOf,
  moveOverrideNote,
  planSync,
  restyleOverrideNote,
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

/** How long a table edit must stay unchanged before it is written back to the store. */
export const EDIT_SETTLE_MS = 1500;

export interface EncounterSync {
  /** Resolves once the message is applied, or deferred until the scene is ready. */
  handleMessage(message: BridgeMessage): Promise<void>;
  /** How many instances the successfully applied messages account for (held or failed ones do not count). */
  appliedInstanceCount(): number;
}

// Real timers are only used in the browser; tests inject Timers.
const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

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
    case "position-changed":
      return desired.map((i) =>
        i.id === event.id
          ? {
              ...i,
              spawnPosition: {
                x: event.spawnPosition.x,
                y: event.spawnPosition.y,
              },
            }
          : i,
      );
    case "monster-changed":
      return desired.map((i) =>
        i.id === event.id
          ? {
              ...i,
              monsterKey: event.monsterKey,
              displayName: event.displayName,
              maxHp: event.maxHp,
              currentHp: event.currentHp,
              armorClass: event.armorClass,
              initiative: event.initiative,
              footprint: event.footprint,
            }
          : i,
      );
  }
}

/**
 * Which token write an override is the note of: a move or a redraw of its
 * instance's token; undefined for any other note.
 */
function writeNoteKind(
  wanted: readonly EncounterInstance[],
  override: SyncPlan["overrides"][number],
): "move" | "restyle" | undefined {
  const name = wanted.find((i) => i.id === override.instanceId)?.displayName;
  if (name === undefined) return undefined;
  if (
    override.message === moveOverrideNote(name, true) ||
    override.message === moveOverrideNote(name, false)
  )
    return "move";
  if (
    override.message === restyleOverrideNote(name, true) ||
    override.message === restyleOverrideNote(name, false)
  )
    return "restyle";
  return undefined;
}

/** What the GM is told to do while a token image uploaded again waits for them. */
function republishPrompt(monsterKey: string, assetName: string): string {
  return `Confirm the folder for the ${monsterKey} token art in Owlbear's upload dialog, then press "Pick the uploaded image" and pick ${assetName}.`;
}

/**
 * Whether token art shows the same image as a pick, whatever their stored
 * hash; never for art without a url.
 */
function samePicture(a: TokenArt, b: PublishedTokenArt): boolean {
  return (
    a.url === b.url &&
    a.mime === b.mime &&
    a.width === b.width &&
    a.height === b.height
  );
}

const EDIT_FIELDS: readonly EditField[] = [
  "currentHp",
  "maxHp",
  "armorClass",
  "initiative",
];

/** The edit field a single-field edit sets, with its value. */
function fieldOf(part: InstanceEdit): [EditField, number | null] {
  const field = EDIT_FIELDS.find((f) => part[f] !== undefined)!;
  return [field, part[field] as number | null];
}

/**
 * The instance and the edit fields an event carries, with the store's values;
 * `undefined` for an event that carries none.
 */
function editFieldsOf(
  event: EncounterEventPayload,
): { id: string; fields: [EditField, number | null][] } | undefined {
  if (event.type === "hp-changed")
    return {
      id: event.id,
      fields: [
        ["currentHp", event.currentHp],
        ["maxHp", event.maxHp],
      ],
    };
  if (event.type === "monster-changed")
    return {
      id: event.id,
      fields: [
        ["currentHp", event.currentHp],
        ["maxHp", event.maxHp],
        ["armorClass", event.armorClass],
        ["initiative", event.initiative],
      ],
    };
  if (event.type !== "instance-changed") return undefined;
  const { armorClass, initiative } = event.changes;
  const fields: [EditField, number | null][] = [];
  if (armorClass !== undefined) fields.push(["armorClass", armorClass]);
  if (initiative !== undefined) fields.push(["initiative", initiative]);
  return fields.length === 0 ? undefined : { id: event.id, fields };
}

/**
 * Per instance id, per edit field, what the events and refusals since the
 * last successful reconcile say: the store `moved` it, or it settled at a
 * value. A later fact replaces an earlier one.
 */
type Facts = Map<string, Map<EditField, "moved" | number | null>>;

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
 * A planned table edit is held for `EDIT_SETTLE_MS` before it is sent: a
 * different planned value restarts the delay, the same value planned again
 * keeps it, and an edit the plan no longer contains is dropped. An unreadable
 * table value is reported through `onEditRejected` only if still planned when
 * the delay ends, and `onEditRejectedCleared` hears when a reported one stops
 * being planned.
 *
 * Commands (table edits, one field each, token deletions and token art picks)
 * go through an outbox over `options.send`: one that cannot go out waits for
 * the next `hello-ack`, and each is remembered until the store settles it. An
 * art pick gets no answer, so it is remembered until the snapshot after the
 * next `hello-ack` and is never sent again.
 *
 * A picked image is sent as a link at once and its tokens are created without
 * waiting for its bytes. With `options.storeImage`, the bytes are then fetched
 * and stored on the bridge, outside the reconcile chain; once stored, the art
 * of that type takes the returned hash (if it is still the picked image) and
 * is sent again with it. One attempt per pick: a failed fetch or a refused or
 * failed upload is reported once through `onArtStoreFailed`, and the art
 * stays a link.
 *
 * With `options.storeImage`, each snapshot's art that has a url and no hash
 * (picked before its bytes were stored, or whose upload failed) is also
 * checked once per session, whether or not its type gets tokens, outside the
 * reconcile chain: when its url still answers, its bytes are fetched and
 * stored as after a pick, with the same failure report; a dead url, or a
 * check that cannot tell, leaves it as it is, silently. A type picked this
 * session is not checked: its pick was its attempt.
 *
 * With `options.loadImage`, the stored art of a type about to get tokens is
 * checked once per session, before they are created, when it has a hash and
 * the GM did not pick it this session. A url that no longer answers gets the
 * stored bytes uploaded to the GM's Owlbear library again; once the GM
 * confirms (`awaitUploadConfirmed`) they pick the upload, which replaces the
 * art with the same hash, is sent once, and wins over a snapshot's art for
 * the type for the rest of the session. A url the check cannot tell about
 * is used as stored. Bytes that cannot be loaded (reported once through
 * `onArtRepublishFailed`), a failed upload, or a cancelled, failed or unusable
 * pick leave the stored art unchanged, and the type's tokens are circles for
 * the session.
 *
 * Art without a url (stored bytes never published) is never drawn, and the
 * picker never opens afresh for its type. With `options.loadImage` it is
 * published like art whose url is dead, with no check, when its type first
 * gets tokens; the same once-per-session rule applies. Until then, or without
 * `options.loadImage`, the type's tokens are circles. After an art step (the
 * picker, or a stored art check, republish or first publish) the scene items
 * and the placed record are read again before the writes are planned, so a
 * table change made meanwhile is kept; a reconcile with no art step reads them
 * once.
 *
 * A `table` event with the id of a sent edit acknowledges it: the token keeps
 * the typed value (a clamp shows a note through `onEditDiffers`), and a field the edit
 * did not set that the store changed is pushed. A `table` event with an id the
 * extension does not know settles its fields at the store's value. A refused
 * edit is settled at its sent value, so it is not sent again. An `mcp` event
 * pushes the fields it changes, unless an edit of the field is in flight. A
 * snapshot with no `hello-ack` since the last one (sent on the same
 * connection, in place of an unreadable change-log row) forgets the sent
 * edits, whose answers its `seq` may cover.
 *
 * An `mcp` `position-changed` event moves its instance's token to the new
 * spawn position in the next reconcile, once (a token not created yet is
 * created there); a reconcile that fails keeps the move for the retry. A
 * snapshot whose spawn position differs from the position a token was last
 * placed at moves it the same way (see planSync). A move over a token that
 * was not where it was last placed, or has no recorded position, is reported
 * through `onOverride`, as is a snapshot that pushes a Stat Bubbles field over
 * a different token value.
 *
 * An `mcp` `monster-changed` event redraws its instance's token for the new
 * monster type in the next reconcile, once, after the renames and moves: an
 * image token takes the type's art (the picker opens for a type with no art,
 * as for a new token; without a pick it keeps its own picture), a circle stays
 * a circle, both at the new footprint and scale 1, in place and with their
 * visibility; a reconcile that fails keeps the redraw for the retry. A
 * snapshot whose monster type differs from the one a token was last drawn for
 * redraws it the same way (see planSync). A redraw over a token whose art or
 * size had been changed on the table, or that has no recorded look, is
 * reported through `onOverride` once its write succeeds.
 *
 * An instance that leaves the encounter (a `removed` or `cleared` event) is
 * dropped from the placed record before the next reconcile plans, so one that
 * comes back before then (a restore) gets a new token instead of being reported
 * deleted; a reconcile that fails keeps it for the retry.
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
    /**
     * Called once per Stat Bubbles field a snapshot pushed over a different
     * token value, once per agent move, in any reconcile, of a token the GM
     * had moved (or one with no recorded position), and once per redraw for a
     * new monster type of a token whose art or size the table had changed (or
     * one with no recorded look), with the record to show.
     */
    onOverride?: (text: string) => void;
    /** Called once per store change (a snapshot or an applied `mcp` event) for each table value that could not be read back. */
    onEditRejected?: (text: string) => void;
    /** Called once per acknowledged edit whose store value differs from the sent one, with the note to show. */
    onEditDiffers?: (text: string) => void;
    /** Called when a reported unreadable table value is no longer planned as unreadable, with the text it was reported with. */
    onEditRejectedCleared?: (text: string) => void;
    /** Called when a snapshot or an applied `mcp` event changes what the store says. */
    onStoreChange?: () => void;
    /** Called once when an event arrives with a gap in `seq`: the caller should reconnect for a snapshot. */
    onGap?: () => void;
    /** Stores image bytes on the bridge (a picked image, or art without a hash whose url still answers); answers its hash or a refusal. */
    storeImage?: (bytes: Uint8Array) => Promise<TokenImageUploadResponse>;
    /** Called once per pick, or per art without a hash, whose image bytes could not be fetched or stored, with the text to show. */
    onArtStoreFailed?: (text: string) => void;
    /**
     * Loads the stored bytes of a token image from the bridge. With it, art
     * that has a hash and whose url is dead, or that has no url, is uploaded
     * to Owlbear.
     */
    loadImage?: (sha256: string) => Promise<StoredTokenImage>;
    /** Shows the GM `prompt` and resolves when they confirm the upload. Default: resolves at once. */
    awaitUploadConfirmed?: (prompt: string) => Promise<void>;
    /** Called once per type whose stored bytes could not be loaded, with the text to show. */
    onArtRepublishFailed?: (text: string) => void;
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
  // Monster types the GM declined (or whose pick was unusable, or whose
  // stored art could not be republished) this session. Their art is left out
  // of the plan, so their tokens are circles.
  const declined = new Set<string>();
  // Monster types whose stored art was checked for liveness (or, without a
  // url, published; or, without a hash, checked to store its bytes) this
  // session, or whose art the GM picked this session.
  const checked = new Set<string>();
  // Whether the current reconcile ran an art step (a fresh pick or a stored
  // art check), after which it reads the scene again before planning writes.
  let artStepRan = false;
  // Monster key -> art the GM re-picked after a republish this session. It
  // wins over a snapshot's art for the type: a snapshot built before its
  // token-art-set reached the store still carries the dead art, or the art
  // without a url.
  const republished: Record<string, PublishedTokenArt> = {};
  // Deleted tokens already reported since the last store change.
  const reported = new Set<string>();
  // Unreadable table values already reported since the last store change.
  const rejectedReported = new Set<string>();
  // Unreadable table values the panel shows now, until they read again.
  const rejectedShown = new Set<string>();
  // Table edits waiting out the settle delay, per instance and field.
  const heldEdits = new Map<
    string,
    { part: InstanceEdit; value: number | null; handle: unknown }
  >();
  // Unreadable table values waiting out the settle delay.
  const heldRejections = new Map<string, unknown>();
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
  // Instances whose spawn position an `mcp` event set since the last
  // successful reconcile: their tokens are moved there.
  let moves = new Set<string>();
  // Instances an `mcp` event changed to another monster type since the last
  // successful reconcile: their tokens are redrawn for it.
  let restyles = new Set<string>();
  // Instances that left the encounter (a `removed` or `cleared` event, either
  // origin) since the last successful reconcile: they are dropped from the
  // placed record before planning, so one that came back gets a new token
  // instead of being reported deleted.
  let left = new Set<string>();
  let afterSnapshot = false;
  // Whether a hello-ack came since the last snapshot. A snapshot without one
  // came on the same connection (in place of an unreadable change-log row).
  let ackedSinceSnapshot = false;

  /**
   * A snapshot on the same connection is current as of a `seq` that may cover
   * the answers of edits already sent, and those answers never arrive. Forget
   * those edits so that they block nothing: one the store has not applied yet
   * is planned and sent again, which is harmless (edits are absolute).
   */
  function forgetSentEdits(): void {
    for (const { id, message, queued } of outbox?.pending() ?? [])
      if (!queued && message.type === "instance-edit") outbox?.settle(id);
  }

  function record(
    instanceId: string,
    field: EditField,
    fact: "moved" | number | null,
  ): void {
    let fields = facts.get(instanceId);
    if (fields === undefined) facts.set(instanceId, (fields = new Map()));
    fields.set(field, fact);
  }

  /**
   * The facts, moves, redraws and departures of a reconcile that did not go
   * through, under the newer ones.
   */
  function restore(
    taken: Facts,
    takenMoves: ReadonlySet<string>,
    takenRestyles: ReadonlySet<string>,
    takenLeft: ReadonlySet<string>,
    snapshot: boolean,
  ): void {
    for (const [id, earlier] of taken)
      facts.set(id, new Map([...earlier, ...(facts.get(id) ?? [])]));
    for (const id of takenMoves) moves.add(id);
    for (const id of takenRestyles) restyles.add(id);
    for (const id of takenLeft) left.add(id);
    afterSnapshot ||= snapshot;
  }

  /** The planner's per-instance field context: `taken` plus the edits in flight. */
  function fieldContexts(taken: Facts): Map<string, FieldContext> {
    const contexts = new Map<
      string,
      {
        moved: Set<EditField>;
        settled: Partial<Record<EditField, number | null>>;
        inflight: Partial<Record<EditField, number | null>>;
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
      // Deletions and art picks set no edit field; this narrows the type.
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
    // Only an edit's events carry edit fields; this narrows the type.
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

  /**
   * Holds the planned edits for the settle delay, one command per field so
   * each has exactly one acknowledging event. A held value that the plan
   * replaces restarts the delay, one it plans again keeps it, and one it no
   * longer contains is dropped.
   */
  function holdEdits(edits: InstanceEdit[]): void {
    const planned = new Map<
      string,
      { part: InstanceEdit; value: number | null }
    >();
    for (const edit of edits)
      for (const part of splitEdit(edit)) {
        const [field, value] = fieldOf(part);
        planned.set(`${part.instanceId}\n${field}`, { part, value });
      }
    for (const [key, held] of heldEdits)
      if (!planned.has(key)) {
        timers.clearTimeout(held.handle);
        heldEdits.delete(key);
      }
    for (const [key, { part, value }] of planned) {
      const held = heldEdits.get(key);
      if (held?.value === value) continue;
      if (held !== undefined) timers.clearTimeout(held.handle);
      const entry = { part, value, handle: undefined as unknown };
      entry.handle = timers.setTimeout(() => {
        void enqueue(() => {
          if (heldEdits.get(key) === entry) {
            heldEdits.delete(key);
            outbox?.submit(instanceEditMessage(part));
          }
          return Promise.resolve();
        });
      }, EDIT_SETTLE_MS);
      heldEdits.set(key, entry);
    }
  }

  /**
   * Reports an unreadable table value only if the plan still holds it when the
   * settle delay ends, and tells the caller when a reported one reads again.
   */
  function holdRejections(rejected: SyncPlan["rejected"]): void {
    const planned = new Set(rejected.map(({ message }) => message));
    for (const [message, handle] of heldRejections)
      if (!planned.has(message)) {
        timers.clearTimeout(handle);
        heldRejections.delete(message);
      }
    for (const message of rejectedShown)
      if (!planned.has(message)) {
        rejectedShown.delete(message);
        rejectedReported.delete(message);
        options.onEditRejectedCleared?.(message);
      }
    for (const message of planned) {
      if (rejectedReported.has(message) || heldRejections.has(message))
        continue;
      const handle = timers.setTimeout(() => {
        void enqueue(() => {
          if (heldRejections.get(message) === handle) {
            heldRejections.delete(message);
            rejectedReported.add(message);
            rejectedShown.add(message);
            options.onEditRejected?.(message);
          }
          return Promise.resolve();
        });
      }, EDIT_SETTLE_MS);
      heldRejections.set(message, handle);
    }
  }

  async function write(call: () => Promise<void>): Promise<void> {
    writing = true;
    try {
      await call();
    } finally {
      writing = false;
    }
  }

  /**
   * The art the plan draws with: none for the types declined this session or
   * whose art has no url (Owlbear cannot draw it), and the re-picked art for
   * the types republished this session.
   */
  function usableArt(): Record<string, PublishedTokenArt> {
    const kept: Record<string, PublishedTokenArt> = {};
    for (const [monsterKey, value] of Object.entries(art))
      if (value.url !== undefined && !declined.has(monsterKey))
        kept[monsterKey] = value;
    return { ...kept, ...republished };
  }

  /**
   * The GM's pick, with `defaultSearch` in the picker's search box when
   * given, or `undefined` for a cancel, an error or an unusable image.
   */
  async function pickArt(
    defaultSearch?: string,
  ): Promise<PublishedTokenArt | undefined> {
    try {
      const parsed = publishedTokenArtSchema.safeParse(
        await obr.pickImage(defaultSearch),
      );
      if (parsed.success) return parsed.data;
    } catch {
      // A picker error is the same as no pick.
    }
    return undefined;
  }

  /**
   * Fetches the image of picked art (a fresh pick, or art without a hash whose
   * url still answers: all such art was picked by the GM at some point) and
   * stores its bytes through `storeImage`, once. Stored: the art of that type
   * takes the hash and is sent again with it. Otherwise the failure is reported
   * and the art stays a link. Never rejects.
   */
  async function storePicked(
    monsterKey: string,
    picked: PublishedTokenArt,
    storeImage: (bytes: Uint8Array) => Promise<TokenImageUploadResponse>,
  ): Promise<void> {
    let reason: string;
    try {
      const answer = await storeImage(await obr.fetchImage(picked.url));
      if (answer.ok) {
        const { sha256 } = answer.image;
        void enqueue(() => {
          const current = art[monsterKey];
          // A snapshot may have brought the same art as a new object since.
          if (current !== undefined && samePicture(current, picked)) {
            const stored = { ...picked, sha256 };
            art = { ...art, [monsterKey]: stored };
            outbox?.submit(tokenArtMessage(monsterKey, stored));
          }
          return Promise.resolve();
        });
        return;
      }
      reason = answer.error.message;
    } catch (error) {
      reason = describeError(error);
    }
    try {
      options.onArtStoreFailed?.(
        `Could not store the image of the token art for ${monsterKey}; it is kept as a link: ${reason}`,
      );
    } catch {
      // A throwing handler must not leave an unhandled rejection.
    }
  }

  /**
   * Stores the bytes of art that has a url and no hash, as after a pick, when
   * its url still answers. A dead url, or a check that cannot tell, leaves the
   * art as it is with nothing reported. Never rejects.
   */
  async function backfillImage(
    monsterKey: string,
    linked: PublishedTokenArt,
    storeImage: (bytes: Uint8Array) => Promise<TokenImageUploadResponse>,
  ): Promise<void> {
    let alive: boolean;
    try {
      alive = await obr.isImageAlive(linked.url);
    } catch {
      return;
    }
    if (alive) await storePicked(monsterKey, linked, storeImage);
  }

  /**
   * Uploads the stored bytes of a type's art to the GM's Owlbear library
   * again, waits for the GM to confirm the upload, and asks them to pick it.
   * A valid pick becomes the type's art with the stored hash and is sent
   * once. Anything else declines the type for the session, leaving the
   * stored art unchanged; bytes that cannot be loaded are also reported.
   * A step of its own because it is not tied to the liveness check: art
   * without a url is published through it with no check.
   */
  async function republish(
    monsterKey: string,
    sha256: string,
    loadImage: (sha256: string) => Promise<StoredTokenImage>,
  ): Promise<void> {
    let image: StoredTokenImage;
    try {
      image = await loadImage(sha256);
    } catch (error) {
      declined.add(monsterKey);
      try {
        options.onArtRepublishFailed?.(
          `Could not republish the token art for ${monsterKey}: ${describeError(error)}`,
        );
      } catch {
        // A throwing handler must not break the reconcile.
      }
      return;
    }
    const name = republishName(sha256);
    try {
      await obr.uploadImage({ bytes: image.bytes, mime: image.mime, name });
      await (options.awaitUploadConfirmed ?? (() => Promise.resolve()))(
        republishPrompt(monsterKey, name),
      );
    } catch {
      // A failed upload (or a confirmation that failed) is the same as no pick.
      declined.add(monsterKey);
      return;
    }
    const picked = await pickArt(name);
    if (picked === undefined) {
      declined.add(monsterKey);
      return;
    }
    const restored = { ...picked, sha256 };
    art = { ...art, [monsterKey]: restored };
    republished[monsterKey] = restored;
    outbox?.submit(tokenArtMessage(monsterKey, restored));
  }

  /**
   * Checks, once per session, whether the stored art of each type about to
   * get tokens still answers, and republishes the art whose url is dead.
   * Art without a url has nothing to check and is published at once. Art
   * without a hash, or picked this session, is not checked; a check that
   * cannot tell uses the stored art.
   */
  async function checkStoredArt(
    monsterKeys: Iterable<string>,
    loadImage: (sha256: string) => Promise<StoredTokenImage>,
  ): Promise<void> {
    for (const monsterKey of monsterKeys) {
      const current = art[monsterKey];
      const sha256 = current?.sha256;
      if (
        current === undefined ||
        sha256 === undefined ||
        checked.has(monsterKey) ||
        declined.has(monsterKey)
      )
        continue;
      checked.add(monsterKey);
      artStepRan = true;
      if (current.url === undefined) {
        await republish(monsterKey, sha256, loadImage);
        continue;
      }
      let alive: boolean;
      try {
        alive = await obr.isImageAlive(current.url);
      } catch {
        continue;
      }
      if (!alive) await republish(monsterKey, sha256, loadImage);
    }
  }

  /** The scene's items and the ids in its placed record, read together. */
  async function readScene(): Promise<{
    items: SceneItem[];
    placed: Set<string>;
  }> {
    const items = await obr.getItems();
    const stored = (await obr.getSceneMetadata())[PLACED_METADATA_KEY];
    const placed = new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [],
    );
    return { items, placed };
  }

  async function apply(
    wanted: EncounterInstance[],
    taken: Facts,
    takenMoves: ReadonlySet<string>,
    takenRestyles: ReadonlySet<string>,
    takenLeft: ReadonlySet<string>,
    snapshot: boolean,
  ): Promise<SyncPlan> {
    artStepRan = false;
    // The record without the instances that left: they are planned as new.
    const withoutLeft = (record: ReadonlySet<string>): Set<string> =>
      new Set([...record].filter((id) => !takenLeft.has(id)));
    let { items, placed: stored } = await readScene();
    let placed = withoutLeft(stored);
    const context = {
      viewportCenter: await obr.getViewportCenter(),
      snapshot,
    };
    const first = planSync(wanted, items, defaultSyncConfig, {
      ...context,
      placed,
      art: usableArt(),
      fields: fieldContexts(taken),
      moves: takenMoves,
      restyles: takenRestyles,
    });
    // Ask once per new monster type, before anything is written, so its
    // tokens are created (or redrawn) once with the right look.
    for (const monsterKey of first.needsArt) {
      // A type that needs art yet has stored art has art without a url (art
      // with one is usable unless declined). It is published below from its
      // stored bytes; a fresh pick would drop the link to them.
      if (declined.has(monsterKey) || art[monsterKey] !== undefined) continue;
      artStepRan = true;
      const chosen = await pickArt();
      if (chosen === undefined) {
        declined.add(monsterKey);
        continue;
      }
      checked.add(monsterKey);
      art = { ...art, [monsterKey]: chosen };
      outbox?.submit(tokenArtMessage(monsterKey, chosen));
      // Not awaited: the tokens do not wait for the bytes.
      if (options.storeImage !== undefined)
        void storePicked(monsterKey, chosen, options.storeImage);
    }
    // Likewise, stored art whose Owlbear asset is gone, or that has no url,
    // is published before its tokens are created or its image tokens redrawn.
    if (options.loadImage !== undefined) {
      const monsterKeyOf = new Map(wanted.map((i) => [i.id, i.monsterKey]));
      const gettingTokens = new Set<string>();
      for (const item of first.add) {
        const monsterKey = monsterKeyOf.get(instanceIdOf(item) ?? "");
        if (monsterKey !== undefined) gettingTokens.add(monsterKey);
      }
      for (const { id } of first.restyle) {
        const token = items.find((item) => item.id === id);
        if (token?.type !== "IMAGE") continue;
        const monsterKey = monsterKeyOf.get(instanceIdOf(token) ?? "");
        if (monsterKey !== undefined) gettingTokens.add(monsterKey);
      }
      // A redrawn image token whose type has no drawable art keeps its own
      // picture, so it may need no write; its type's stored art is still
      // published.
      for (const monsterKey of first.needsArt) gettingTokens.add(monsterKey);
      await checkStoredArt(gettingTokens, options.loadImage);
    }
    if (artStepRan) {
      // An art step waits on the GM, so the table and the scene may have
      // changed meanwhile: plan from what is there now.
      const fresh = await readScene();
      items = fresh.items;
      stored = fresh.placed;
      placed = withoutLeft(stored);
    }
    const plan = planSync(wanted, items, defaultSyncConfig, {
      ...context,
      placed,
      art: usableArt(),
      fields: fieldContexts(taken),
      moves: takenMoves,
      restyles: takenRestyles,
    });
    /** Reports the notes of a token write of this kind once it is written. */
    const reportWriteNotes = (
      tokenId: string,
      kind: "move" | "restyle",
    ): void => {
      const token = items.find((item) => item.id === tokenId);
      const instanceId = token === undefined ? undefined : instanceIdOf(token);
      for (const override of plan.overrides)
        if (
          override.instanceId === instanceId &&
          writeNoteKind(wanted, override) === kind
        )
          options.onOverride?.(override.message);
    };
    if (plan.delete.length > 0) await write(() => obr.deleteItems(plan.delete));
    if (plan.add.length > 0) await write(() => obr.addItems(plan.add));
    // Before the metadata write, so a failed rename leaves the baseline
    // unwritten and the retry renames.
    for (const r of plan.rename)
      await write(() => obr.updateItems([r.id], { name: r.name }));
    // Likewise, a failed move leaves the position baseline unwritten. A
    // move's override note is reported once its write succeeds: the retry of
    // a reconcile that fails later finds the token moved and plans no note.
    for (const m of plan.move) {
      await write(() => obr.updateItems([m.id], { position: m.position }));
      reportWriteNotes(m.id, "move");
    }
    // Likewise for a redraw: a failed one leaves the look record unwritten,
    // and its note is reported once its write succeeds.
    for (const r of plan.restyle) {
      await write(() => obr.updateItems([r.id], r.patch));
      reportWriteNotes(r.id, "restyle");
    }
    if (plan.update.length > 0)
      await write(() => obr.setItemMetadata(plan.update));

    // Remember which instances now have a token, so a token the GM deletes
    // later stays deleted; forget instances that left the encounter.
    const doomed = new Set(plan.delete);
    const present = [
      ...items.filter((item) => !doomed.has(item.id)),
      ...plan.add,
    ].map(instanceIdOf);
    const wantedIds = new Set(wanted.map((i) => i.id));
    const next = new Set(
      [...placed, ...present].filter(
        (id): id is string => id !== undefined && wantedIds.has(id),
      ),
    );
    if (next.size !== stored.size || [...next].some((id) => !stored.has(id)))
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
    const takenMoves = moves;
    const takenRestyles = restyles;
    const takenLeft = left;
    const snapshot = afterSnapshot;
    facts = new Map();
    moves = new Set();
    restyles = new Set();
    left = new Set();
    afterSnapshot = false;
    let plan: SyncPlan;
    try {
      plan = await apply(
        applying,
        taken,
        takenMoves,
        takenRestyles,
        takenLeft,
        snapshot,
      );
    } catch (error) {
      restore(taken, takenMoves, takenRestyles, takenLeft, snapshot);
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
    if (outbox !== undefined) holdEdits(plan.edits);
    // Move and redraw notes were reported as their writes were made (see
    // apply).
    for (const override of plan.overrides)
      if (writeNoteKind(applying, override) === undefined)
        options.onOverride?.(override.message);
    holdRejections(plan.rejected);
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
        if (options.storeImage !== undefined)
          for (const [monsterKey, value] of Object.entries(
            message.payload.art ?? {},
          ))
            if (
              value.url !== undefined &&
              value.sha256 === undefined &&
              !checked.has(monsterKey)
            ) {
              checked.add(monsterKey);
              // Not part of the reconcile chain, as a pick's upload is: tokens
              // never wait for the bytes.
              void backfillImage(monsterKey, value, options.storeImage);
            }
        seq = message.payload.seq;
        afterSnapshot = true;
        reported.clear();
        rejectedReported.clear();
        options.onStoreChange?.();
      } else if (message.type === "encounter-event") {
        // Narrows the type: desired is null only before the first snapshot,
        // when seq is null too.
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
        if (event.type === "removed") left.add(event.id);
        if (event.type === "cleared") for (const i of desired) left.add(i.id);
        if (event.origin.source === "table") {
          // The table already shows its own change: no store change to
          // report, so a clamp note it brings stays.
          acknowledge(event);
          desired = fold(desired, event);
        } else {
          noteMoved(event);
          if (event.type === "position-changed") moves.add(event.id);
          if (event.type === "monster-changed") restyles.add(event.id);
          desired = fold(desired, event);
          reported.clear();
          rejectedReported.clear();
          options.onStoreChange?.();
        }
      } else if (
        message.type === "error" &&
        !message.payload.fatal &&
        // A pending command's id is never undefined (an art pick's is ""),
        // so an error without one settles nothing.
        message.id !== undefined
      ) {
        // A refused edit: the token keeps the typed value (main.ts shows the
        // error), and it is agreed so that it is not sent again.
        const command = outbox?.settle(message.id);
        if (command?.message.type !== "instance-edit") return Promise.resolve();
        const { instanceId, ...edit } = command.message.payload;
        for (const [field, value] of Object.entries(edit) as [
          EditField,
          number | null | undefined,
        ][])
          // Narrows the type: a sent edit carries only the fields it sets
          // (splitEdit).
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
