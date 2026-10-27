import type { InstanceEdit, PublishedTokenArt } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { initiativeProjector } from "./initiative.js";
import type { GridSpec, ItemPatch, SceneItem, Vec2 } from "./scene-model.js";
import { statBubblesProjector } from "./stat-bubbles.js";

export type EncounterInstance = Extract<
  BridgeMessage,
  { type: "encounter-snapshot" }
>["payload"]["instances"][number];

/** Our own item metadata namespace; value is `{ instanceId }`. */
export const INSTANCE_METADATA_KEY = "com.ttrpg-agents/instance";
/** Item metadata: the values we last wrote, `{ [projectorKey]: value }`. */
export const SYNCED_METADATA_KEY = "com.ttrpg-agents/synced";
/** Reserved key in the synced record: the token name we last wrote. */
export const NAME_BASELINE_KEY = "name";
/** Reserved key in the synced record: the token position we last placed it at. */
export const POSITION_BASELINE_KEY = "position";
/**
 * Reserved key in the synced record: where the token stood before the
 * extension first moved it to a spawn position (`{ x, y }`), or null when its
 * instance had no spawn position when the token was last placed.
 */
export const PREVIOUS_POSITION_KEY = "previousPosition";
/**
 * Reserved key in the synced record: the look the token was last drawn with,
 * `{ monsterKey, image }` (the picture's url, null for a circle).
 */
export const LOOK_BASELINE_KEY = "look";
/**
 * Reserved key in the synced record of an old token being replaced (for a
 * new monster type that needs another kind of token): its replacement's item
 * id.
 */
export const REPLACED_BY_KEY = "replacedBy";
/** Scene metadata: the instance ids already placed on this scene. */
export const PLACED_METADATA_KEY = "com.ttrpg-agents/placed";

/** One grid cell at Owlbear's default 150 dpi. */
const TOKEN_SIZE = 150;

/**
 * The longer side of the image spans `cells` grid cells, its centre at the
 * item position.
 */
function cellsGrid(
  art: Pick<PublishedTokenArt, "width" | "height">,
  cells: number,
): GridSpec {
  return {
    dpi: Math.max(art.width, art.height) / cells,
    offset: { x: art.width / 2, y: art.height / 2 },
  };
}

/**
 * One position per token, side by side: each token is centred in a slot as
 * wide as its footprint in cells, and the whole row is centred on `center`.
 * Only new tokens without a spawn position go in the row.
 */
function rowPositions(footprints: readonly number[], center: Vec2): Vec2[] {
  const total = footprints.reduce((sum, cells) => sum + cells * TOKEN_SIZE, 0);
  let left = center.x - total / 2;
  return footprints.map((cells) => {
    const width = cells * TOKEN_SIZE;
    const position = { x: left + width / 2, y: center.y };
    left += width;
    return position;
  });
}

/**
 * One piece of token metadata derived from an instance. `owned` keys are
 * kept in step with the encounter (table-wins rule, see planSync);
 * `create-only` keys are written when the token is created and never again.
 */
export type Projector = {
  key: string;
  mode: "owned" | "create-only";
  /**
   * `current` is the token's value for the key; `baseline` is the raw value
   * last written for it (see planSync).
   */
  project(
    instance: EncounterInstance,
    current?: unknown,
    baseline?: unknown,
  ): unknown;
  /**
   * Reads a value edited on the table back into the instance fields it
   * changed; `invalid` names the fields whose value could not be read.
   */
  readBack?(
    value: unknown,
    instance: EncounterInstance,
  ): { edit: Omit<InstanceEdit, "instanceId">; invalid: string[] };
  /**
   * With `readBack`: the name each edit field has inside the value, so the
   * planner decides each field on its own (see planSync).
   */
  editFields?: Readonly<Partial<Record<EditField, string>>>;
  /**
   * With `editFields`: how a stored number appears inside the value (default:
   * the number itself), so the planner compares the store and the table in
   * value space.
   */
  encodeField?(field: EditField, value: number): unknown;
};

export type TokenKind = Pick<
  SceneItem,
  "type" | "layer" | "shape" | "image" | "grid"
>;

export type SyncConfig = {
  projectors: Projector[];
  /** The look of a new token; `art` is the stored art of its monster type, if any. */
  tokenKind(
    instance: EncounterInstance,
    art: PublishedTokenArt | undefined,
  ): TokenKind;
};

/**
 * Link, Initiative Tracker and Stat Bubbles projectors plus, on the CHARACTER
 * layer, an IMAGE token from the monster type's art, or a SHAPE circle when it
 * has none.
 */
export const defaultSyncConfig: SyncConfig = {
  projectors: [
    {
      key: INSTANCE_METADATA_KEY,
      mode: "owned",
      project: (instance) => ({ instanceId: instance.id }),
    },
    initiativeProjector,
    statBubblesProjector,
  ],
  tokenKind: (instance, art) => {
    const cells = instance.footprint;
    return art
      ? {
          type: "IMAGE",
          layer: "CHARACTER",
          image: {
            url: art.url,
            mime: art.mime,
            width: art.width,
            height: art.height,
          },
          grid: cellsGrid(art, cells),
        }
      : {
          type: "SHAPE",
          layer: "CHARACTER",
          shape: {
            shapeType: "CIRCLE",
            width: cells * TOKEN_SIZE,
            height: cells * TOKEN_SIZE,
          },
        };
  },
};

/** The instance fields the table can edit and write back. */
export type EditField = "currentHp" | "maxHp" | "armorClass" | "initiative";

/** How the panel names each edit field. */
export const EDIT_FIELD_NAMES: Readonly<Record<EditField, string>> = {
  currentHp: "HP",
  maxHp: "max HP",
  armorClass: "armor class",
  initiative: "initiative",
};

/**
 * What the sync knows about one instance's edit fields, from the events and
 * the commands since the last reconcile that succeeded:
 * - `moved`: fields the store changed (an `mcp` change, or a field a command
 *   did not set whose value changed);
 * - `settled`: fields whose command the store acknowledged, at the sent value
 *   (or, for a command the extension does not know, at the store's value);
 * - `inflight`: fields with a sent command not yet settled, at the sent value.
 */
export type FieldContext = {
  moved?: ReadonlySet<EditField>;
  settled?: Partial<Record<EditField, number | null>>;
  inflight?: Partial<Record<EditField, number | null>>;
};

export type SyncPlan = {
  add: SceneItem[];
  /** Key-level item metadata writes; `value: undefined` clears the key. */
  update: { id: string; key: string; value: unknown }[];
  /**
   * Tokens of instances no longer wanted, and the old token of a half-done
   * replacement (see `replace`).
   */
  delete: string[];
  /** Token renames (a top-level item field, not metadata). */
  rename: { id: string; name: string }[];
  /**
   * Existing tokens moved to their instance's new spawn position (a top-level
   * item field); only tokens not already there.
   */
  move: { id: string; position: Vec2 }[];
  /**
   * Existing tokens redrawn for their instance's new monster type (top-level
   * item fields); only the fields of the target look, only tokens that differ.
   */
  restyle: {
    id: string;
    patch: Pick<ItemPatch, "image" | "grid" | "shape" | "scale">;
  }[];
  /**
   * Existing tokens replaced with a new item for their instance's new monster
   * type, when the token's kind (Owlbear's read-only item type) must change:
   * `id` is the old token, `marker` its synced record marked with the
   * replacement's id under REPLACED_BY_KEY (written before the replacement is
   * added), and `item` the replacement.
   */
  replace: { id: string; marker: Record<string, unknown>; item: SceneItem }[];
  /** Wanted instances placed on this scene whose token is gone (the GM deleted it). */
  deleted: string[];
  /** Monster keys, once each, of instances getting a token, or a token redrawn or replaced, that have no art. */
  needsArt: string[];
  /** Table edits of owned keys to write back to the store. */
  edits: InstanceEdit[];
  /** Table values that could not be read back, left on the table. */
  rejected: { instanceId: string; message: string }[];
  /**
   * Writes over table values for the DM to audit: Stat Bubbles fields a
   * snapshot pushed over a different token value, moves of a token that
   * was not where it was last placed (or has no recorded position),
   * redraws (for a new monster type, or with the art re-uploaded for its
   * type) of a token whose art or size the table had changed (or that has
   * no recorded look), and every replacement (once per instance, also when a
   * half-done one is finished).
   */
  overrides: { instanceId: string; message: string }[];
};

/** The instance id a scene item is linked to, if it is one of our tokens. */
export function instanceIdOf(item: SceneItem): string | undefined {
  const value = item.metadata[INSTANCE_METADATA_KEY];
  if (typeof value !== "object" || value === null) return undefined;
  const id = (value as { instanceId?: unknown }).instanceId;
  return typeof id === "string" ? id : undefined;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.hasOwn(b, k) &&
        deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The override note for a move over a token that was not where it was last
 * placed (`recorded`), or that has no recorded position.
 */
export function moveOverrideNote(name: string, recorded: boolean): string {
  return recorded
    ? `${name} was moved at the agent's request; its token had been moved on the table, and that position was overwritten.`
    : `${name} was moved at the agent's request; its token may have been moved on the table, and that position was overwritten.`;
}

/**
 * The override note for a redraw over a token whose art or size had been
 * changed on the table (`recorded`), or that has no recorded look.
 */
export function restyleOverrideNote(name: string, recorded: boolean): string {
  return recorded
    ? `${name}'s token was redrawn for its new monster type at the agent's request; its art or size had been changed on the table, and was overwritten.`
    : `${name}'s token was redrawn for its new monster type at the agent's request; its art or size may have been changed on the table, and was overwritten.`;
}

/**
 * The override note for a token replaced with a new one for its new monster
 * type (a redraw that needs another kind of token).
 */
export function replaceOverrideNote(name: string): string {
  return `${name}'s token was replaced with a new one for its new monster type at the agent's request; any attachments on the old token were deleted with it.`;
}

/**
 * The override note for a redraw with the art re-uploaded for its monster
 * type, over a token whose art or size had been changed on the table
 * (`recorded`), or that has no recorded look.
 */
export function reskinOverrideNote(name: string, recorded: boolean): string {
  return recorded
    ? `${name}'s token was redrawn with the art uploaded for its monster type; its art or size had been changed on the table, and was overwritten.`
    : `${name}'s token was redrawn with the art uploaded for its monster type; its art or size may have been changed on the table, and was overwritten.`;
}

/**
 * The override note for a token replaced with a new one drawn with the art
 * re-uploaded for its monster type.
 */
export function reskinReplaceNote(name: string): string {
  return `${name}'s token was replaced with a new one drawn with the art uploaded for its monster type; any attachments on the old token were deleted with it.`;
}

/** A token's look as recorded under LOOK_BASELINE_KEY. */
type Look = { monsterKey: string; image: string | null };

/** A recorded look, if the value is one. */
function asLook(value: unknown): Look | undefined {
  const { monsterKey, image } = asRecord(value);
  return typeof monsterKey === "string" &&
    (typeof image === "string" || image === null)
    ? { monsterKey, image }
    : undefined;
}

type Restyle = SyncPlan["restyle"][number]["patch"];

const UNIT_SCALE: Vec2 = { x: 1, y: 1 };

/**
 * How an existing token is redrawn for its instance's monster type: as a new
 * token of that type would be drawn (`config.tokenKind`, given the type's
 * usable art). Only IMAGE and SHAPE tokens are redrawn; undefined for any
 * other item. `typeArt` is the art drawn from, undefined when the type has
 * none (the type then goes to `needsArt`). When the target look has the
 * token's kind, `patch` holds its fields at scale 1 (an IMAGE's image and
 * grid, a SHAPE's shape; undefined when the target lacks them, and the token
 * is left alone); when the kind differs, `patch` is undefined and the token is
 * replaced. `image` is the target picture's url (null for a SHAPE).
 */
function redrawnLook(
  token: SceneItem,
  instance: EncounterInstance,
  art: Readonly<Record<string, PublishedTokenArt>>,
  config: SyncConfig,
):
  | {
      target: TokenKind;
      typeArt: PublishedTokenArt | undefined;
      patch: Restyle | undefined;
      image: string | null;
    }
  | undefined {
  if (token.type !== "IMAGE" && token.type !== "SHAPE") return undefined;
  const typeArt = Object.hasOwn(art, instance.monsterKey)
    ? art[instance.monsterKey]
    : undefined;
  const target = config.tokenKind(instance, typeArt);
  const image = target.type === "IMAGE" ? (target.image?.url ?? null) : null;
  let patch: Restyle | undefined;
  if (
    target.type === "IMAGE" &&
    token.type === "IMAGE" &&
    target.image !== undefined &&
    target.grid !== undefined
  )
    patch = {
      image: { ...target.image },
      grid: target.grid,
      scale: { ...UNIT_SCALE },
    };
  if (
    target.type === "SHAPE" &&
    token.type === "SHAPE" &&
    target.shape !== undefined
  )
    patch = { shape: { ...target.shape }, scale: { ...UNIT_SCALE } };
  return { target, typeArt, patch, image };
}

/**
 * The id of the item replacing the item `id`: the next generation suffix
 * (`X` -> `X-r2`, `X-r<n>` -> `X-r<n+1>`), counting up past the ids in `taken`.
 */
function replacementId(id: string, taken: ReadonlySet<string>): string {
  const match = /^(.*)-r(\d+)$/.exec(id);
  const base = match?.[1] ?? id;
  let generation = match?.[2] === undefined ? 2 : Number(match[2]) + 1;
  while (taken.has(`${base}-r${generation}`)) generation++;
  return `${base}-r${generation}`;
}

/** The item id a token's synced record names as its replacement, if any. */
function replacedBy(item: SceneItem): string | undefined {
  const value = asRecord(item.metadata[SYNCED_METADATA_KEY])[REPLACED_BY_KEY];
  return typeof value === "string" ? value : undefined;
}

/** Whether the token already shows every field of the patch (no scale counts as 1). */
function drawnAs(token: SceneItem, patch: Restyle): boolean {
  return (
    (patch.image === undefined || deepEqual(token.image, patch.image)) &&
    (patch.grid === undefined || deepEqual(token.grid, patch.grid)) &&
    (patch.shape === undefined || deepEqual(token.shape, patch.shape)) &&
    (patch.scale === undefined ||
      deepEqual(token.scale ?? UNIT_SCALE, patch.scale))
  );
}

/** A recorded position, if the value is one. */
function asPosition(value: unknown): Vec2 | undefined {
  const record = asRecord(value);
  const { x, y } = record;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

const samePosition = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

const omitKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));

/**
 * The per-field rule for a key whose projector reads edits back, on a token
 * that has a baseline for it (see planSync).
 */
function planEditFields(
  projector: Projector & { readBack: NonNullable<Projector["readBack"]> },
  instance: EncounterInstance,
  current: unknown,
  baseline: unknown,
  snapshot: boolean,
  fields: FieldContext,
): {
  /** The value to write, when the key is pushed. */
  push?: Record<string, unknown>;
  baseline: Record<string, unknown>;
  edit: Omit<InstanceEdit, "instanceId">;
  invalid: string[];
  overrides: string[];
} {
  const table = asRecord(current);
  const agreed = asRecord(baseline);
  const raw = asRecord(projector.project(instance));
  const value = asRecord(projector.project(instance, current, baseline));
  const nextBaseline = { ...raw };
  const read = projector.readBack(current, instance);
  const edit: Omit<InstanceEdit, "instanceId"> = {};
  const replaced: string[] = [];
  const overrides: string[] = [];
  let storeMoved = false;
  const names = Object.entries(projector.editFields ?? {}) as [
    EditField,
    string,
  ][];
  // How a number appears in the value, so the store, the table and the sent
  // edits are compared in one space. `null` (a clear) stays `null`.
  const encode = (field: EditField, n: number | null): unknown =>
    n === null || projector.encodeField === undefined
      ? n
      : projector.encodeField(field, n);
  for (const [field, name] of names) {
    const stored = instance[field];
    // No stored value (an instance without armor class): carried over.
    if (typeof stored !== "number") continue;
    const storedValue = encode(field, stored);
    // A null (a clear) sent or settled is distinct from none.
    const hasInflight = Object.hasOwn(fields.inflight ?? {}, field);
    const hasSettled = Object.hasOwn(fields.settled ?? {}, field);
    const inflight = encode(field, fields.inflight?.[field] ?? null);
    const settled = encode(field, fields.settled?.[field] ?? null);
    const moved = fields.moved?.has(field) === true;
    const storeWins =
      !hasInflight &&
      (moved || (snapshot && !hasSettled && storedValue !== agreed[name]));
    if (storeWins) {
      value[name] = storedValue;
      nextBaseline[name] = storedValue;
      replaced.push(name);
      if (table[name] !== storedValue) {
        storeMoved = true;
        // Only a snapshot cannot tell an MCP change from an overridden clamp.
        if (!moved)
          overrides.push(
            `After a snapshot, the store set ${instance.displayName} ${EDIT_FIELD_NAMES[field]} to ${String(stored)}; the table showed ${String(table[name])}.`,
          );
      }
      continue;
    }
    // The table's value stays.
    if (Object.hasOwn(table, name)) value[name] = table[name];
    else delete value[name];
    const agreedValue = hasSettled ? settled : agreed[name];
    if (table[name] === storedValue) nextBaseline[name] = storedValue;
    else if (agreedValue === undefined || agreedValue === null)
      delete nextBaseline[name];
    else nextBaseline[name] = agreedValue;
    const typed = read.edit[field];
    if (typed !== undefined) {
      const typedValue = encode(field, typed);
      if (
        typedValue !== agreedValue &&
        !(hasInflight && typedValue === inflight)
      )
        (edit as Record<EditField, number | null>)[field] = typed;
    }
  }
  // Outside the edit fields (Stat Bubbles `hide`) the key-level rule holds:
  // the projector applies it, and the value is pushed when the encounter
  // changed there.
  const labels = names.map(([, name]) => name);
  const otherChanged = !deepEqual(
    omitKeys(raw, labels),
    omitKeys(agreed, labels),
  );
  return {
    ...((storeMoved || otherChanged) && !deepEqual(value, current)
      ? { push: value }
      : {}),
    baseline: nextBaseline,
    edit,
    invalid: read.invalid.filter((name) => !replaced.includes(name)),
    overrides,
  };
}

/** Whether the store moved one of the fields the projector reads back. */
function movesEditField(
  projector: Projector,
  fields: FieldContext | undefined,
): boolean {
  return Object.keys(projector.editFields ?? {}).some(
    (field) => fields?.moved?.has(field as EditField) === true,
  );
}

/**
 * Pure diff of the desired instances against the scene's items; only items
 * carrying our instance link are ever touched.
 *
 * Table-wins rule, per `owned` key of an existing token. The projector sees the
 * token's current value, so table-owned fields inside an owned value (the
 * tracker's `active`) are carried over. The baseline is the raw projection
 * (projected without the current value), which is what the encounter says.
 * r = raw projection, o = value on the token, d = projection given o (what we
 * push), b = baseline (the raw projection we last wrote):
 * - d == o: nothing, but re-baseline when b != r.
 * - d != o, b present, r != b (the encounter changed): push d, b := r.
 * - d != o, b present, r == b (the table was edited): leave it.
 * - d != o, no b: push d if o is absent, else keep o; either way b := r.
 * A projector may use the baseline to apply this rule per field inside its
 * value: a table edit wins until the encounter changes that field.
 *
 * A key whose projector can `readBack` table edits (Stat Bubbles, the tracker's
 * count) and that has a baseline is decided per edit field instead; stored,
 * settled, in-flight and typed values are compared in the value's space
 * (`encodeField`), and a null (a clear) in flight or settled is distinct from
 * none; its other fields keep the
 * rule above. The agreed value is the settled one, else the baseline's:
 * - in flight (`fields.inflight`): the table's value stays;
 * - else the store's value wins if the field `moved`, or if the reconcile
 *   follows a `snapshot`, the store differs from the agreed value and the
 *   field is not settled; a snapshot that so writes over a different token
 *   value is reported in `overrides`;
 * - else the table's value stays, and is planned as an edit to write back when
 *   it differs from the agreed value and from the one in flight. Values that
 *   cannot be read are planned as rejected and left on the table.
 * The key is pushed only when the result differs from the token, and b
 * records the agreed values (settled ones at their settled value), so a
 * clamped value is not sent again. Without `fields` or `snapshot`, a store
 * change of an edit field is not pushed.
 * An undefined r means no key: it is never written or baselined, and its
 * baseline is dropped (the token's value is left alone). A value the token
 * holds there is read back as an edit (adoption), unless it equals one in
 * flight or settled; an unreadable one is planned as rejected.
 * The token name follows the same rule, with its baseline under
 * NAME_BASELINE_KEY in the synced record.
 * `create-only` keys and visibility are set at creation only.
 * A new token is created at its instance's spawn position when it has one;
 * the others of the batch sit in a row at the viewport centre. The created
 * position is recorded under POSITION_BASELINE_KEY in the synced record.
 * An existing token whose instance has a spawn position is moved there when
 * the instance is in `context.moves` (an `mcp` change set it) or when its
 * recorded position differs from the spawn position (a change seen only in a
 * snapshot); the move is planned only when the token is not already there, and
 * the recorded position becomes the spawn position either way. A planned move
 * of a token that is not at its recorded position, or has none (a token
 * created before positions were recorded), is reported in `overrides`. No
 * position is ever recorded for an older token without a move, and otherwise
 * an existing token is never moved.
 * A new token records the look it is created with under LOOK_BASELINE_KEY:
 * its instance's monster key and its picture's url (null for a circle). An
 * existing token is redrawn when its instance is in `context.restyles` (an
 * `mcp` change set a new monster type) or its recorded look names another
 * monster key (a change seen only in a snapshot). It is drawn as a new token
 * of the type would be (`config.tokenKind` with the type's art; a type with no
 * art goes to `needsArt`), at scale 1 (no scale counts as 1). When the kind
 * stays, the redraw is in place: an IMAGE takes the image and grid, a SHAPE
 * the shape. It is planned in `restyle` only when the token differs from that
 * look, and the recorded look becomes the drawn one either way. A planned
 * redraw of a token whose picture differs from its recorded one, whose scale
 * is not 1, or that has no recorded look is reported in `overrides`.
 * When the kind must change (a SHAPE whose type has art, an IMAGE whose type
 * has none), the token is replaced (`replace`): a new item of the target look
 * with the token's name, position, visibility, rotation, layer, lock and
 * metadata, each as this plan leaves them (its planned rename, move and
 * metadata writes are folded in, and none is planned on the old token), its
 * synced record the token's next one with the new look. Its id is the old
 * one's with the next generation suffix (`X-r2`, `X-r3`, ...), skipping ids on
 * the scene. The old token's record, as read, is marked with that id under
 * REPLACED_BY_KEY. Every replacement is reported in `overrides` (a folded
 * move keeps its own note).
 * A token whose instance is in `context.reskins` (the GM picked the art
 * re-uploaded for its type) and whose type has art in `context.art` is
 * redrawn the same way, in place or replaced, with the re-skin notes
 * (reskinOverrideNote, reskinReplaceNote) in place of the monster change ones;
 * a redraw for a new monster type wins over it. A token with no recorded look
 * and no `restyles` or `reskins` entry is never redrawn and gets no record;
 * other item types are left alone.
 * The first linked token seen is an instance's token (others are duplicates,
 * left alone), except after a half-done replacement: a linked token whose
 * record names another linked token of its instance on the scene under
 * REPLACED_BY_KEY is deleted, its replacement is the instance's token, and the
 * replacement is reported in `overrides`. A marker whose replacement is not on
 * the scene is left as it is.
 * An instance in `context.placed` whose token is missing was deleted by the
 * GM and is not recreated.
 */
export function planSync(
  desired: EncounterInstance[],
  observed: SceneItem[],
  config: SyncConfig,
  context: {
    viewportCenter: Vec2;
    placed: ReadonlySet<string>;
    /** Monster key -> the art its new tokens are created with. */
    art: Readonly<Record<string, PublishedTokenArt>>;
    /** True when the reconcile follows a snapshot (connect, reconnect or gap). */
    snapshot?: boolean;
    /** Per instance id: what the events and commands since the last reconcile say about its edit fields. */
    fields?: ReadonlyMap<string, FieldContext>;
    /** Instance ids whose spawn position an `mcp` change set since the last reconcile. */
    moves?: ReadonlySet<string>;
    /** Instance ids an `mcp` monster-changed event named since the last reconcile. */
    restyles?: ReadonlySet<string>;
    /** Instance ids whose tokens are redrawn with the art re-uploaded for their type. */
    reskins?: ReadonlySet<string>;
  },
): SyncPlan {
  const plan: SyncPlan = {
    add: [],
    update: [],
    delete: [],
    rename: [],
    move: [],
    restyle: [],
    replace: [],
    deleted: [],
    needsArt: [],
    edits: [],
    rejected: [],
    overrides: [],
  };
  const wanted = new Map(desired.map((i) => [i.id, i]));
  const linked = new Map<string, SceneItem[]>();
  for (const item of observed) {
    const id = instanceIdOf(item);
    if (id === undefined) continue;
    if (!wanted.has(id)) plan.delete.push(item.id);
    else linked.set(id, [...(linked.get(id) ?? []), item]);
  }
  // Instances whose replacement note is already planned.
  const replaceNoted = new Set<string>();
  const noteReplacement = (
    instance: EncounterInstance,
    note: (name: string) => string = replaceOverrideNote,
  ): void => {
    if (replaceNoted.has(instance.id)) return;
    replaceNoted.add(instance.id);
    plan.overrides.push({
      instanceId: instance.id,
      message: note(instance.displayName),
    });
  };
  const tokens = new Map<string, SceneItem>();
  for (const [id, items] of linked) {
    // A half-done replacement: the old token, marked with the id of its
    // replacement, is still on the scene next to it. The old token is
    // deleted and the replacement is the instance's token.
    const ids = new Set(items.map((item) => item.id));
    const marked = items.find((item) => {
      const by = replacedBy(item);
      return by !== undefined && by !== item.id && ids.has(by);
    });
    const replacement =
      marked === undefined
        ? undefined
        : items.find((item) => item.id === replacedBy(marked));
    if (marked !== undefined && replacement !== undefined) {
      plan.delete.push(marked.id);
      tokens.set(id, replacement);
      // A re-skin's replacement keeps its own note; a monster change wins.
      noteReplacement(
        wanted.get(id)!,
        context.reskins?.has(id) === true && context.restyles?.has(id) !== true
          ? reskinReplaceNote
          : undefined,
      );
    } else {
      // A duplicate token (e.g. a copy-pasted one) is left alone: the first
      // one seen is the instance's token.
      tokens.set(id, items[0]!);
    }
  }
  // Ids a replacement may not take: those on the scene and those planned.
  const takenIds = new Set(observed.map((item) => item.id));

  const owned = config.projectors.filter((p) => p.mode === "owned");
  for (const [id, token] of tokens) {
    const instance = wanted.get(id)!;
    const baseline = asRecord(token.metadata[SYNCED_METADATA_KEY]);
    const next = { ...baseline };
    // The token's planned writes, made on it or folded into its replacement.
    const updates: { key: string; value: unknown }[] = [];
    let rename: string | undefined;
    let move: Vec2 | undefined;
    for (const projector of owned) {
      const { key, project, readBack } = projector;
      const raw = project(instance);
      const o = token.metadata[key];
      const d = project(instance, o, baseline[key]);
      const hasBaseline = Object.hasOwn(baseline, key);
      if (raw === undefined) {
        delete next[key];
        // The instance has no value for this key: a value the table holds is
        // adopted (the tracker's count for a monster without initiative).
        if (readBack !== undefined && o !== undefined) {
          const read = readBack(o, instance);
          const known = context.fields?.get(id);
          const edit = Object.fromEntries(
            Object.entries(read.edit).filter(([name, typed]) => {
              const field = name as EditField;
              return ![known?.inflight, known?.settled].some(
                (record) =>
                  record !== undefined &&
                  Object.hasOwn(record, field) &&
                  record[field] === typed,
              );
            }),
          );
          if (Object.keys(edit).length > 0)
            plan.edits.push({ instanceId: id, ...edit });
          if (read.invalid.length > 0)
            plan.rejected.push({
              instanceId: id,
              message: `${read.invalid.join(" and ")} on ${instance.displayName} is not a whole number`,
            });
        }
      } else if (
        readBack !== undefined &&
        (hasBaseline ||
          // No baseline yet (a value adopted into the store): the store wins
          // over the table when an `mcp` change moved one of its fields.
          (o !== undefined &&
            movesEditField(projector, context.fields?.get(id))))
      ) {
        const fields = planEditFields(
          { ...projector, readBack },
          instance,
          o,
          baseline[key],
          context.snapshot === true,
          context.fields?.get(id) ?? {},
        );
        if (fields.push !== undefined)
          updates.push({ key, value: fields.push });
        next[key] = fields.baseline;
        if (Object.keys(fields.edit).length > 0)
          plan.edits.push({ instanceId: id, ...fields.edit });
        if (fields.invalid.length > 0)
          plan.rejected.push({
            instanceId: id,
            message: `${fields.invalid.join(" and ")} on ${instance.displayName} is not a whole number`,
          });
        for (const message of fields.overrides)
          plan.overrides.push({ instanceId: id, message });
      } else if (deepEqual(d, o)) {
        next[key] = raw;
      } else if (hasBaseline) {
        if (!deepEqual(raw, baseline[key])) {
          updates.push({ key, value: d });
          next[key] = raw;
        }
      } else {
        if (o === undefined) updates.push({ key, value: d });
        next[key] = raw;
      }
    }
    const d = instance.displayName;
    if (d === token.name) {
      next[NAME_BASELINE_KEY] = d;
    } else if (Object.hasOwn(baseline, NAME_BASELINE_KEY)) {
      if (d !== baseline[NAME_BASELINE_KEY]) {
        rename = d;
        next[NAME_BASELINE_KEY] = d;
      }
    } else {
      next[NAME_BASELINE_KEY] = d;
    }
    const spawn = instance.spawnPosition;
    if (spawn) {
      const recorded = asPosition(baseline[POSITION_BASELINE_KEY]);
      const target = { x: spawn.x, y: spawn.y };
      if (
        context.moves?.has(id) === true ||
        (recorded !== undefined && !samePosition(recorded, target))
      ) {
        if (!samePosition(token.position, target)) {
          move = target;
          if (recorded === undefined || !samePosition(token.position, recorded))
            plan.overrides.push({
              instanceId: id,
              message: moveOverrideNote(
                instance.displayName,
                recorded !== undefined,
              ),
            });
        }
        next[POSITION_BASELINE_KEY] = target;
      }
    }
    const look = asLook(baseline[LOOK_BASELINE_KEY]);
    let replacing: ReturnType<typeof redrawnLook>;
    const restyled =
      context.restyles?.has(id) === true ||
      (look !== undefined && look.monsterKey !== instance.monsterKey);
    // A re-skin draws with the type's art, so only a type that has some.
    const reskinned =
      !restyled &&
      context.reskins?.has(id) === true &&
      Object.hasOwn(context.art, instance.monsterKey);
    if (restyled || reskinned) {
      const redrawn = redrawnLook(token, instance, context.art, config);
      if (
        redrawn !== undefined &&
        redrawn.typeArt === undefined &&
        !plan.needsArt.includes(instance.monsterKey)
      )
        plan.needsArt.push(instance.monsterKey);
      if (redrawn !== undefined && redrawn.target.type !== token.type)
        replacing = redrawn;
      else if (redrawn?.patch !== undefined) {
        if (!drawnAs(token, redrawn.patch)) {
          plan.restyle.push({ id: token.id, patch: redrawn.patch });
          const picture =
            token.type === "IMAGE" ? (token.image?.url ?? null) : null;
          const scale = token.scale ?? UNIT_SCALE;
          if (
            look === undefined ||
            picture !== look.image ||
            scale.x !== 1 ||
            scale.y !== 1
          )
            plan.overrides.push({
              instanceId: id,
              message: (reskinned ? reskinOverrideNote : restyleOverrideNote)(
                instance.displayName,
                look !== undefined,
              ),
            });
        }
        next[LOOK_BASELINE_KEY] = {
          monsterKey: instance.monsterKey,
          image: redrawn.image,
        };
      }
    }
    if (replacing !== undefined) {
      // A new item with the old token's fields as this plan leaves them; the
      // old token gets no write but the marker, and is then deleted.
      const newId = replacementId(token.id, takenIds);
      takenIds.add(newId);
      const metadata: Record<string, unknown> = { ...token.metadata };
      for (const { key, value } of updates)
        if (value === undefined) delete metadata[key];
        else metadata[key] = value;
      const record: Record<string, unknown> = {
        ...next,
        [LOOK_BASELINE_KEY]: {
          monsterKey: instance.monsterKey,
          image: replacing.image,
        },
      };
      delete record[REPLACED_BY_KEY];
      metadata[SYNCED_METADATA_KEY] = record;
      const position = move ?? token.position;
      plan.replace.push({
        id: token.id,
        marker: {
          ...baseline,
          [REPLACED_BY_KEY]: newId,
        },
        item: {
          ...replacing.target,
          id: newId,
          name: rename ?? token.name,
          visible: token.visible,
          position: { x: position.x, y: position.y },
          layer: token.layer ?? replacing.target.layer,
          ...(token.rotation === undefined ? {} : { rotation: token.rotation }),
          ...(token.locked === undefined ? {} : { locked: token.locked }),
          metadata,
        },
      });
      noteReplacement(instance, reskinned ? reskinReplaceNote : undefined);
      continue;
    }
    for (const { key, value } of updates)
      plan.update.push({ id: token.id, key, value });
    if (rename !== undefined) plan.rename.push({ id: token.id, name: rename });
    if (move !== undefined) plan.move.push({ id: token.id, position: move });
    if (!deepEqual(next, baseline))
      plan.update.push({ id: token.id, key: SYNCED_METADATA_KEY, value: next });
  }

  for (const instance of desired)
    if (!tokens.has(instance.id) && context.placed.has(instance.id))
      plan.deleted.push(instance.id);

  const missing = desired.filter(
    (i) => !tokens.has(i.id) && !context.placed.has(i.id),
  );
  const row = rowPositions(
    missing.filter((i) => i.spawnPosition == null).map((i) => i.footprint),
    context.viewportCenter,
  );
  let slot = 0;
  missing.forEach((instance) => {
    const position = instance.spawnPosition
      ? { x: instance.spawnPosition.x, y: instance.spawnPosition.y }
      : row[slot++]!;
    const metadata: Record<string, unknown> = {};
    const synced: Record<string, unknown> = {};
    for (const p of config.projectors) {
      const value = p.project(instance);
      if (value === undefined) continue;
      metadata[p.key] = value;
      if (p.mode === "owned") synced[p.key] = value;
    }
    synced[NAME_BASELINE_KEY] = instance.displayName;
    synced[POSITION_BASELINE_KEY] = { x: position.x, y: position.y };
    const art = Object.hasOwn(context.art, instance.monsterKey)
      ? context.art[instance.monsterKey]
      : undefined;
    synced[LOOK_BASELINE_KEY] = {
      monsterKey: instance.monsterKey,
      image: art?.url ?? null,
    };
    metadata[SYNCED_METADATA_KEY] = synced;
    if (!art && !plan.needsArt.includes(instance.monsterKey))
      plan.needsArt.push(instance.monsterKey);
    plan.add.push({
      ...config.tokenKind(instance, art),
      id: `ttrpg-instance-${instance.id}`,
      name: instance.displayName,
      visible: false,
      position,
      metadata,
    });
  });
  return plan;
}
