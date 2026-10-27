import {
  monsterTypeName,
  publishedTokenArtSchema,
  type InstanceEdit,
  type PublishedTokenArt,
  type TableArtWait,
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
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  instanceIdOf,
  moveOverrideNote,
  planSync,
  replaceOverrideNote,
  reskinOverrideNote,
  reskinReplaceNote,
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

/** A fresh image picker about to open: its monster type and its place among the reconcile's picks (1-based). */
export type ArtStep = { monsterName: string; index: number; total: number };

/** A monster type whose stored art needs re-uploading, as the panel lists it. */
export type Reupload = {
  monsterKey: string;
  monsterName: string;
  /** The Owlbear asset name its stored bytes are uploaded under. */
  assetName: string;
  /** Whether its stored bytes were uploaded to Owlbear this session. */
  uploaded: boolean;
};

export interface EncounterSync {
  /** Resolves once the message is applied, or deferred until the scene is ready. */
  handleMessage(message: BridgeMessage): Promise<void>;
  /** How many instances the successfully applied messages account for (held or failed ones do not count). */
  appliedInstanceCount(): number;
  /**
   * The monster types whose art waits on the GM: those whose fresh picker is
   * open or still to open in the current reconcile (`pick`), then those
   * listed for re-upload (`reupload`).
   */
  artWaits(): TableArtWait[];
  /** Uploads the stored bytes of a listed type's art to the GM's Owlbear library; opens no picker. */
  reuploadArt(monsterKey: string): Promise<void>;
  /** Opens the picker on a listed type's uploaded image; a valid pick becomes its art. */
  pickUploadedArt(monsterKey: string): Promise<void>;
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
    case "position-changed": {
      const spawnPosition = event.spawnPosition;
      if (spawnPosition === null) throw new Error("not implemented");
      return desired.map((i) =>
        i.id === event.id
          ? {
              ...i,
              spawnPosition: {
                x: spawnPosition.x,
                y: spawnPosition.y,
              },
            }
          : i,
      );
    }
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
 * Which token write an override is the note of: a move, a redraw or a
 * replacement of its instance's token (for a new monster type or with art
 * re-uploaded for its type); undefined for any other note.
 */
function writeNoteKind(
  wanted: readonly EncounterInstance[],
  override: SyncPlan["overrides"][number],
): "move" | "restyle" | "replace" | undefined {
  const name = wanted.find((i) => i.id === override.instanceId)?.displayName;
  if (name === undefined) return undefined;
  const { message } = override;
  if (
    message === replaceOverrideNote(name) ||
    message === reskinReplaceNote(name)
  )
    return "replace";
  if (
    message === moveOverrideNote(name, true) ||
    message === moveOverrideNote(name, false)
  )
    return "move";
  if (
    message === restyleOverrideNote(name, true) ||
    message === restyleOverrideNote(name, false) ||
    message === reskinOverrideNote(name, true) ||
    message === reskinOverrideNote(name, false)
  )
    return "restyle";
  return undefined;
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
 * The picker opens afresh only for a type with no stored art, once per
 * session, before its tokens are created: `onArtStep` announces each picker
 * of a reconcile (its monster name and place among the reconcile's picks) and
 * hears `undefined` once it resolves. A cancel, an error or an unusable pick
 * leaves the type's tokens circles for the session.
 *
 * With `options.loadImage`, each snapshot's art that has a hash and a url is
 * checked once per session, whether or not its type gets tokens, outside the
 * reconcile chain, unless the GM picked it this session. A url that no longer
 * answers lists the type for re-upload; a check that cannot tell leaves the
 * art as stored. A reconcile about to create or redraw tokens of a type whose
 * check is still pending waits for it. Art without a url (stored bytes never
 * published) lists its type while the encounter has an instance of it. A
 * listed type's tokens are circles, and nothing opens by itself for it:
 * `reuploadArt` uploads its stored bytes to the GM's Owlbear library, then
 * `pickUploadedArt` opens the picker on the upload. A valid pick becomes the
 * type's art with the stored hash, is sent once, wins over a snapshot's art
 * for the type for the rest of the session, takes the type off the list and
 * redraws the type's tokens with it in the next reconcile, which it triggers
 * (see planSync's `reskins`). Bytes that cannot be loaded or uploaded
 * (reported through `onArtRepublishFailed`), or a cancelled, failed or
 * unusable pick, leave the type listed; the GM can try again.
 * A call for a type whose re-upload or pick is still running is ignored.
 * `onReuploadsChange` hears the whole list whenever it changes, and
 * `artWaits` names the pickers open or still to open in the current
 * reconcile, then the listed types. Without `options.loadImage` stored art is
 * used as it is, and art without a url never draws.
 *
 * After an art step (a picker, or a wait for a pending check) the scene items
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
 * monster type in the next reconcile, once, after the renames and moves, as a
 * new token of that type would be drawn (the picker opens for a type with no
 * art, as for a new token), at the new footprint and scale 1; a reconcile that
 * fails keeps the redraw for the retry. A token whose kind stays (image to
 * image, circle to circle) is redrawn in place. One whose kind must change (a
 * circle whose type has art, an image token whose type has none) is replaced:
 * its synced record is marked with the replacement's id, the replacement
 * (carrying its name, position, visibility, rotation, layer, lock and
 * metadata) is added, then the old token is deleted with its attachments. A
 * retry after a failure between the add and the delete finishes the
 * replacement and reports no deletion. A snapshot whose monster type differs
 * from the one a token was last drawn for redraws it the same way (see
 * planSync). A redraw over a token whose art or size had been changed on the
 * table, or that has no recorded look, is reported through `onOverride` once
 * its write succeeds; a replacement always is, once the old token is deleted.
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
     * had moved (or one with no recorded position), once per redraw (for a
     * new monster type, or with the art picked after a re-upload) of a token
     * whose art or size the table had changed (or one with no recorded look),
     * and once per token replaced for either, with the record to show.
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
     * that has a hash and whose url is dead, or that has no url, is listed
     * for re-upload to Owlbear.
     */
    loadImage?: (sha256: string) => Promise<StoredTokenImage>;
    /** Called once per re-upload whose stored bytes could not be loaded or uploaded, with the text to show. */
    onArtRepublishFailed?: (text: string) => void;
    /** Called before each fresh picker opens, and with `undefined` once it resolves. */
    onArtStep?: (step: ArtStep | undefined) => void;
    /** Called with the whole re-upload list whenever it changes. */
    onReuploadsChange?: (reuploads: Reupload[]) => void;
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
  // Monster types whose fresh pick the GM cancelled (or that was unusable)
  // this session. They have no art, so their tokens are circles.
  const declined = new Set<string>();
  // Monster types whose stored art was checked for liveness (or, without a
  // hash, checked to store its bytes) this session, or whose art the GM
  // picked this session.
  const checked = new Set<string>();
  // Monster key -> the liveness check of its stored art, while pending.
  const pendingChecks = new Map<string, Promise<void>>();
  // Monster types whose stored art's url no longer answers: listed for
  // re-upload, and left out of the plan's art.
  const gone = new Set<string>();
  // Listed monster types whose stored bytes were uploaded to Owlbear this
  // session.
  const uploaded = new Set<string>();
  // Listed types whose re-upload or pick of the uploaded image is running: a
  // second press for the same type is ignored until it ends, so a double click
  // opens one Owlbear dialog and uploads one copy.
  const inflight = new Set<string>();
  // The re-upload list as last reported to onReuploadsChange.
  let reportedReuploads = "[]";
  // The fresh pickers of the current reconcile still open or to open, in order.
  let picking: { monsterKey: string; monsterName: string }[] = [];
  // Whether the current reconcile ran an art step (a fresh pick or a wait for
  // a pending liveness check), after which it reads the scene again before
  // planning writes.
  let artStepRan = false;
  // Monster key -> art the GM picked after re-uploading its stored bytes this
  // session. It wins over a snapshot's art for the type: a snapshot built
  // before its token-art-set reached the store still carries the dead art, or
  // the art without a url.
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
  // Instances of a type whose re-uploaded art the GM picked since the last
  // successful reconcile: their tokens are redrawn with it.
  let reskins = new Set<string>();
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
    takenReskins: ReadonlySet<string>,
    takenLeft: ReadonlySet<string>,
    snapshot: boolean,
  ): void {
    for (const [id, earlier] of taken)
      facts.set(id, new Map([...earlier, ...(facts.get(id) ?? [])]));
    for (const id of takenMoves) moves.add(id);
    for (const id of takenRestyles) restyles.add(id);
    for (const id of takenReskins) reskins.add(id);
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
   * The art the plan draws with: none for the types declined this session,
   * whose art has no url (Owlbear cannot draw it) or whose url is gone, and
   * the art picked after a re-upload this session for its type.
   */
  function usableArt(): Record<string, PublishedTokenArt> {
    const kept: Record<string, PublishedTokenArt> = {};
    for (const [monsterKey, value] of Object.entries(art))
      if (
        value.url !== undefined &&
        !declined.has(monsterKey) &&
        !gone.has(monsterKey)
      )
        kept[monsterKey] = value;
    return { ...kept, ...republished };
  }

  /**
   * The monster types whose stored art needs re-uploading, in the order of
   * the art: those whose url is gone, and those whose art has no url while
   * the encounter has an instance of them; none picked after a re-upload
   * this session, and none without `options.loadImage`.
   */
  function reuploadList(): Reupload[] {
    if (options.loadImage === undefined) return [];
    const instances = desired ?? [];
    const list: Reupload[] = [];
    for (const [monsterKey, value] of Object.entries(art)) {
      const { sha256 } = value;
      if (sha256 === undefined || Object.hasOwn(republished, monsterKey))
        continue;
      const unpublished =
        value.url === undefined &&
        instances.some((i) => i.monsterKey === monsterKey);
      if (!gone.has(monsterKey) && !unpublished) continue;
      list.push({
        monsterKey,
        monsterName: monsterTypeName(instances, monsterKey),
        assetName: republishName(sha256),
        uploaded: uploaded.has(monsterKey),
      });
    }
    return list;
  }

  /** Tells onReuploadsChange the re-upload list when it changed. */
  function reportReuploads(): void {
    const list = reuploadList();
    const text = JSON.stringify(list);
    if (text === reportedReuploads) return;
    reportedReuploads = text;
    try {
      options.onReuploadsChange?.(list);
    } catch {
      // A throwing handler must not break the sync.
    }
  }

  /** Tells onArtStep about the picker opening now, or `undefined` once it resolves. */
  function announceStep(step: ArtStep | undefined): void {
    try {
      options.onArtStep?.(step);
    } catch {
      // A throwing handler must not break the reconcile.
    }
  }

  /** Reports a re-upload whose stored bytes could not be loaded or uploaded. */
  function reportRepublishFailed(monsterKey: string, error: unknown): void {
    try {
      options.onArtRepublishFailed?.(
        `Could not republish the token art for ${monsterKey}: ${describeError(error)}`,
      );
    } catch {
      // A throwing handler must not leave an unhandled rejection.
    }
  }

  /**
   * Checks whether the url of a type's stored art still answers; a dead one
   * lists the type for re-upload, unless the GM picked its re-upload
   * meanwhile. A check that cannot tell keeps the art as stored. Never
   * rejects.
   */
  async function checkLiveness(monsterKey: string, url: string): Promise<void> {
    try {
      const alive = await obr.isImageAlive(url);
      if (!alive && !Object.hasOwn(republished, monsterKey)) {
        gone.add(monsterKey);
        reportReuploads();
      }
    } catch {
      // A check that cannot tell: the stored art is used.
    }
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
    takenReskins: ReadonlySet<string>,
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
      reskins: takenReskins,
    });
    // Ask once per new monster type, before anything is written, so its
    // tokens are created (or redrawn) once with the right look. A type that
    // needs art yet has stored art (gone or without a url) is listed for
    // re-upload instead: a fresh pick would drop the link to its stored bytes.
    const queue = first.needsArt
      .filter(
        (monsterKey) =>
          !declined.has(monsterKey) && art[monsterKey] === undefined,
      )
      .map((monsterKey) => ({
        monsterKey,
        monsterName: monsterTypeName(wanted, monsterKey),
      }));
    picking = queue;
    try {
      for (const [i, { monsterKey, monsterName }] of queue.entries()) {
        artStepRan = true;
        announceStep({ monsterName, index: i + 1, total: queue.length });
        const chosen = await pickArt();
        picking = queue.slice(i + 1);
        announceStep(undefined);
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
    } finally {
      picking = [];
    }
    // A type about to get tokens, or have them redrawn, whose stored art's
    // liveness check is still pending: wait for it, so its tokens are drawn
    // once with the right look.
    const monsterKeyOf = new Map(wanted.map((i) => [i.id, i.monsterKey]));
    const drawing = new Set(first.needsArt);
    const redrawn = new Set(first.restyle.map(({ id }) => id));
    const drawn = [
      ...first.add,
      ...items.filter((item) => redrawn.has(item.id)),
      ...first.replace.map(({ item }) => item),
    ];
    for (const item of drawn) {
      const monsterKey = monsterKeyOf.get(instanceIdOf(item) ?? "");
      if (monsterKey !== undefined) drawing.add(monsterKey);
    }
    for (const monsterKey of drawing) {
      const check = pendingChecks.get(monsterKey);
      if (check === undefined) continue;
      artStepRan = true;
      await check;
    }
    if (artStepRan) {
      // An art step waits on the GM or the network, so the table and the
      // scene may have changed meanwhile: plan from what is there now.
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
      reskins: takenReskins,
    });
    // Each note is reported at most once.
    const reportedNotes = new Set<SyncPlan["overrides"][number]>();
    /** Reports the notes of a token write of this kind once it is written. */
    const reportWriteNotes = (
      tokenId: string,
      kind: "move" | "restyle" | "replace",
    ): void => {
      const token = items.find((item) => item.id === tokenId);
      const instanceId = token === undefined ? undefined : instanceIdOf(token);
      for (const override of plan.overrides)
        if (
          override.instanceId === instanceId &&
          writeNoteKind(wanted, override) === kind &&
          !reportedNotes.has(override)
        ) {
          reportedNotes.add(override);
          options.onOverride?.(override.message);
        }
    };
    if (plan.delete.length > 0) {
      await write(() => obr.deleteItems(plan.delete));
      // The old token of a half-done replacement is among them.
      for (const id of plan.delete) reportWriteNotes(id, "replace");
    }
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
    // A token whose kind must change is replaced: its synced record is first
    // marked with the replacement's id, then the replacement is added, then
    // the old token is deleted (Owlbear deletes its attachments with it). A
    // reconcile that fails in between leaves the instance a linked token, and
    // the retry plans the replacement again or finishes it (see planSync).
    if (plan.replace.length > 0) {
      await write(() =>
        obr.setItemMetadata(
          plan.replace.map((r) => ({
            id: r.id,
            key: SYNCED_METADATA_KEY,
            value: r.marker,
          })),
        ),
      );
      await write(() => obr.addItems(plan.replace.map((r) => r.item)));
      for (const r of plan.replace) reportWriteNotes(r.id, "move");
      await write(() => obr.deleteItems(plan.replace.map((r) => r.id)));
      for (const r of plan.replace) reportWriteNotes(r.id, "replace");
    }
    if (plan.update.length > 0)
      await write(() => obr.setItemMetadata(plan.update));

    // Remember which instances now have a token, so a token the GM deletes
    // later stays deleted; forget instances that left the encounter.
    const doomed = new Set([...plan.delete, ...plan.replace.map((r) => r.id)]);
    const present = [
      ...items.filter((item) => !doomed.has(item.id)),
      ...plan.add,
      ...plan.replace.map((r) => r.item),
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
    const takenReskins = reskins;
    const takenLeft = left;
    const snapshot = afterSnapshot;
    facts = new Map();
    moves = new Set();
    restyles = new Set();
    reskins = new Set();
    left = new Set();
    afterSnapshot = false;
    let plan: SyncPlan;
    try {
      plan = await apply(
        applying,
        taken,
        takenMoves,
        takenRestyles,
        takenReskins,
        takenLeft,
        snapshot,
      );
    } catch (error) {
      restore(
        taken,
        takenMoves,
        takenRestyles,
        takenReskins,
        takenLeft,
        snapshot,
      );
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
    // Move, redraw and replacement notes were reported as their writes were
    // made (see apply).
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
        if (options.loadImage !== undefined)
          for (const [monsterKey, value] of Object.entries(
            message.payload.art ?? {},
          ))
            if (
              value.url !== undefined &&
              value.sha256 !== undefined &&
              !checked.has(monsterKey)
            ) {
              checked.add(monsterKey);
              // Not part of the reconcile chain either: only a reconcile
              // about to draw tokens of the type waits for it.
              pendingChecks.set(
                monsterKey,
                checkLiveness(monsterKey, value.url).then(() => {
                  pendingChecks.delete(monsterKey);
                }),
              );
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
      // A snapshot, an event or a refused edit. The re-upload list follows the
      // art and the encounter's types.
      reportReuploads();
      return enqueue(reconcile);
    },
    appliedInstanceCount() {
      return appliedCount;
    },
    artWaits() {
      return [
        ...picking.map(({ monsterKey, monsterName }) => ({
          monsterKey,
          monsterName,
          step: "pick" as const,
        })),
        ...reuploadList().map(({ monsterKey, monsterName }) => ({
          monsterKey,
          monsterName,
          step: "reupload" as const,
        })),
      ];
    },
    async reuploadArt(monsterKey) {
      const row = reuploadList().find((r) => r.monsterKey === monsterKey);
      const sha256 = art[monsterKey]?.sha256;
      const { loadImage } = options;
      if (
        row === undefined ||
        sha256 === undefined ||
        loadImage === undefined ||
        inflight.has(monsterKey)
      )
        return;
      inflight.add(monsterKey);
      try {
        let image: StoredTokenImage;
        try {
          image = await loadImage(sha256);
        } catch (error) {
          reportRepublishFailed(monsterKey, error);
          return;
        }
        try {
          // Resolves once handed to Owlbear, before the GM confirms the folder.
          await obr.uploadImage({
            bytes: image.bytes,
            mime: image.mime,
            name: row.assetName,
          });
        } catch (error) {
          reportRepublishFailed(monsterKey, error);
          return;
        }
      } finally {
        inflight.delete(monsterKey);
      }
      uploaded.add(monsterKey);
      reportReuploads();
    },
    async pickUploadedArt(monsterKey) {
      const row = reuploadList().find((r) => r.monsterKey === monsterKey);
      const sha256 = art[monsterKey]?.sha256;
      if (
        row?.uploaded !== true ||
        sha256 === undefined ||
        inflight.has(monsterKey)
      )
        return;
      inflight.add(monsterKey);
      let picked: PublishedTokenArt | undefined;
      try {
        picked = await pickArt(row.assetName);
      } finally {
        inflight.delete(monsterKey);
      }
      // A cancel, an error or an unusable pick leaves the type listed; so
      // does a pick made after another one took it off the list.
      if (
        picked === undefined ||
        !reuploadList().some((r) => r.monsterKey === monsterKey)
      )
        return;
      // The same bytes as stored: the hash stays, nothing is stored again.
      const restored = { ...picked, sha256 };
      art = { ...art, [monsterKey]: restored };
      republished[monsterKey] = restored;
      outbox?.submit(tokenArtMessage(monsterKey, restored));
      for (const instance of desired ?? [])
        if (instance.monsterKey === monsterKey) reskins.add(instance.id);
      reportReuploads();
      await enqueue(reconcile);
    },
  };
}
