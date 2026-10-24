import type { InstanceEdit, TokenArt } from "@ttrpg-agents/engine";
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

/** The image spans one grid cell, its centre at the item position. */
export function oneCellGrid(art: Pick<TokenArt, "width" | "height">): GridSpec {
  return {
    dpi: Math.max(art.width, art.height),
    offset: { x: art.width / 2, y: art.height / 2 },
  };
}

/** Row of `count` positions centred horizontally on `center`. */
export function rowPositions(count: number, center: Vec2): Vec2[] {
  const startX = center.x - ((count - 1) * TOKEN_SIZE) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * TOKEN_SIZE,
    y: center.y,
  }));
}

/**
 * One piece of token metadata derived from an instance. `owned` keys are
 * kept in step with the encounter (table-wins rule, see planSync);
 * `create-only` keys are written when the token is created and never again.
 */
export type Projector = {
  key: string;
  mode: "owned" | "create-only";
  project(instance: EncounterInstance, current?: unknown): unknown;
  /**
   * Reads a value edited on the table back into the instance fields it
   * changed; `invalid` names the fields whose value could not be read.
   */
  invert?(
    value: unknown,
    instance: EncounterInstance,
  ): { edit: Omit<InstanceEdit, "instanceId">; invalid: string[] };
};

export type TokenKind = Pick<
  SceneItem,
  "type" | "layer" | "shape" | "image" | "grid"
>;

export type SyncConfig = {
  projectors: Projector[];
  /** The look of a new token; `art` is the stored art of its monster type, if any. */
  tokenKind(instance: EncounterInstance, art: TokenArt | undefined): TokenKind;
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
  tokenKind: (_instance, art) =>
    art
      ? {
          type: "IMAGE",
          layer: "CHARACTER",
          image: {
            url: art.url,
            mime: art.mime,
            width: art.width,
            height: art.height,
          },
          grid: oneCellGrid(art),
        }
      : {
          type: "SHAPE",
          layer: "CHARACTER",
          shape: {
            shapeType: "CIRCLE",
            width: TOKEN_SIZE,
            height: TOKEN_SIZE,
          },
        },
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
 * - d != o, b present, r == b (the table was edited): leave it. If the
 *   projector can `invert` the value, the changed fields are planned as an
 *   edit to write back and b := o (the baseline temporarily holds the edited
 *   table value, so the store's answer is judged by the rules above: accepted
 *   exactly is d == o, a different value is r != b and is pushed). Values that
 *   cannot be read are planned as rejected and left on the table, b untouched.
 * - d != o, no b: push d if o is absent, else keep o; either way b := r.
 * An undefined r means no key: it is never written or baselined, and its
 * baseline is dropped (the token's value is left alone).
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
    art: Readonly<Record<string, TokenArt>>;
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
    for (const { key, project, invert } of owned) {
      const raw = project(instance);
      const o = token.metadata[key];
      const d = project(instance, o);
      const hasBaseline = Object.hasOwn(baseline, key);
      if (raw === undefined) {
        delete next[key];
      } else if (deepEqual(d, o)) {
        next[key] = raw;
      } else if (hasBaseline) {
        if (!deepEqual(raw, baseline[key])) {
          plan.update.push({ id: token.id, key, value: d });
          next[key] = raw;
        } else if (invert) {
          // The table was edited: write the change back and keep the table
          // value as the baseline until the store answers.
          const { edit, invalid } = invert(o, instance);
          if (Object.keys(edit).length > 0) {
            plan.edits.push({ instanceId: id, ...edit });
            next[key] = o;
          }
          if (invalid.length > 0)
            plan.rejected.push({
              instanceId: id,
              message: `${invalid.join(" and ")} on ${instance.displayName} is not a whole number`,
            });
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
  const positions = rowPositions(missing.length, context.viewportCenter);
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
