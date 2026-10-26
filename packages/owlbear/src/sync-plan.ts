import type { InstanceEdit, PublishedTokenArt } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { initiativeProjector } from "./initiative.js";
import type { GridSpec, SceneItem, Vec2 } from "./scene-model.js";
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
  delete: string[];
  /** Token renames (a top-level item field, not metadata). */
  rename: { id: string; name: string }[];
  /** Wanted instances placed on this scene whose token is gone (the GM deleted it). */
  deleted: string[];
  /** Monster keys, once each, of instances getting a token that have no art. */
  needsArt: string[];
  /** Table edits of owned keys to write back to the store. */
  edits: InstanceEdit[];
  /** Table values that could not be read back, left on the table. */
  rejected: { instanceId: string; message: string }[];
  /** Stat Bubbles fields a snapshot pushed over a different token value, for the DM to audit. */
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
 * `create-only` keys, position and visibility are set at creation only.
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
  },
): SyncPlan {
  const plan: SyncPlan = {
    add: [],
    update: [],
    delete: [],
    rename: [],
    deleted: [],
    needsArt: [],
    edits: [],
    rejected: [],
    overrides: [],
  };
  const wanted = new Map(desired.map((i) => [i.id, i]));
  const tokens = new Map<string, SceneItem>();
  for (const item of observed) {
    const id = instanceIdOf(item);
    if (id === undefined) continue;
    // A duplicate token (e.g. a copy-pasted one) is left alone: the first
    // one seen is the instance's token.
    if (!wanted.has(id)) plan.delete.push(item.id);
    else if (!tokens.has(id)) tokens.set(id, item);
  }

  const owned = config.projectors.filter((p) => p.mode === "owned");
  for (const [id, token] of tokens) {
    const instance = wanted.get(id)!;
    const baseline = asRecord(token.metadata[SYNCED_METADATA_KEY]);
    const next = { ...baseline };
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
          plan.update.push({ id: token.id, key, value: fields.push });
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
          plan.update.push({ id: token.id, key, value: d });
          next[key] = raw;
        }
      } else {
        if (o === undefined) plan.update.push({ id: token.id, key, value: d });
        next[key] = raw;
      }
    }
    const d = instance.displayName;
    if (d === token.name) {
      next[NAME_BASELINE_KEY] = d;
    } else if (Object.hasOwn(baseline, NAME_BASELINE_KEY)) {
      if (d !== baseline[NAME_BASELINE_KEY]) {
        plan.rename.push({ id: token.id, name: d });
        next[NAME_BASELINE_KEY] = d;
      }
    } else {
      next[NAME_BASELINE_KEY] = d;
    }
    if (!deepEqual(next, baseline))
      plan.update.push({ id: token.id, key: SYNCED_METADATA_KEY, value: next });
  }

  for (const instance of desired)
    if (!tokens.has(instance.id) && context.placed.has(instance.id))
      plan.deleted.push(instance.id);

  const missing = desired.filter(
    (i) => !tokens.has(i.id) && !context.placed.has(i.id),
  );
  const positions = rowPositions(
    missing.map((i) => i.footprint),
    context.viewportCenter,
  );
  missing.forEach((instance, n) => {
    const metadata: Record<string, unknown> = {};
    const synced: Record<string, unknown> = {};
    for (const p of config.projectors) {
      const value = p.project(instance);
      if (value === undefined) continue;
      metadata[p.key] = value;
      if (p.mode === "owned") synced[p.key] = value;
    }
    synced[NAME_BASELINE_KEY] = instance.displayName;
    metadata[SYNCED_METADATA_KEY] = synced;
    const art = Object.hasOwn(context.art, instance.monsterKey)
      ? context.art[instance.monsterKey]
      : undefined;
    if (!art && !plan.needsArt.includes(instance.monsterKey))
      plan.needsArt.push(instance.monsterKey);
    plan.add.push({
      ...config.tokenKind(instance, art),
      id: `ttrpg-instance-${instance.id}`,
      name: instance.displayName,
      visible: false,
      position: positions[n]!,
      metadata,
    });
  });
  return plan;
}
