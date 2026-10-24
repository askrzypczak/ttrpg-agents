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

/**
 * The longer side of the image spans `cells` grid cells, its centre at the
 * item position.
 */
function cellsGrid(
  art: Pick<TokenArt, "width" | "height">,
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

/**
 * Per instance id, per projector key: the edit fields already sent to the
 * store for what is on the table, so they are not sent again. Interim until
 * #209 (origin-tagged deltas): do not build on it.
 */
export type EditMemory = Record<
  string,
  Record<string, Omit<InstanceEdit, "instanceId">>
>;

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
  /** The edits now on the table, to remember so they are not sent again. */
  sent: EditMemory;
  /** Answered edits whose table value differs from the store's, left on the table. */
  differs: { instanceId: string; message: string }[];
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

const EDIT_LABELS: Record<keyof Omit<InstanceEdit, "instanceId">, string> = {
  currentHp: "HP",
  maxHp: "max HP",
  armorClass: "armor class",
};

/**
 * The note for an answered instance whose table values differ from the
 * store's, or `undefined` when the table matches.
 */
function differsMessage(
  owned: Projector[],
  token: SceneItem,
  answer: EncounterInstance,
): string | undefined {
  const clauses: string[] = [];
  for (const { key, readBack } of owned) {
    if (!readBack) continue;
    const { edit } = readBack(token.metadata[key], answer);
    for (const [field, table] of Object.entries(edit)) {
      const name = field as keyof typeof EDIT_LABELS;
      clauses.push(
        `${EDIT_LABELS[name]} ${String(answer[name])} for ${answer.displayName}, not the ${String(table)} on the table`,
      );
    }
  }
  return clauses.length > 0
    ? `The store holds ${clauses.join("; ")}; the token keeps your value.`
    : undefined;
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
 * - d != o, b present, r == b (the table was edited): leave it. If the
 *   projector can `readBack` the value, the changed fields not already in
 *   `context.sent` are planned as an edit to write back, b untouched. Values
 *   that cannot be read are planned as rejected and left on the table.
 * Only a change of the encounter writes to the table: the store's answer to a
 * write-back (`context.answered`) sets b := the raw projection of the answered
 * instance for keys that can be read back. A clamped or refused edit then stays
 * on the table (reported in `differs`) and is not pushed or sent again, and a
 * value typed since is adopted and sent as an edit. If the store moved a field
 * (the table still holds the old baseline value there and it is not in
 * `context.sent`: an MCP change, or a clamp of another field), b is kept and
 * the rule above pushes the whole value.
 * - d != o, no b: push d if o is absent, else keep o; either way b := r.
 * A projector may use the baseline to apply this rule per field inside its
 * value: a table edit wins until the encounter changes that field.
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
    /** Instances as the store answered a write-back of their edit. */
    answered?: ReadonlyMap<string, EncounterInstance>;
    /** Edits already sent for what is on the table. */
    sent?: Readonly<EditMemory>;
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
    sent: {},
    differs: [],
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
    const answer = context.answered?.get(id);
    for (const { key, project, readBack } of owned) {
      const raw = project(instance);
      const o = token.metadata[key];
      // The store's answer to a write-back is the baseline unless the store
      // moved a field since we last wrote it (an MCP change or a clamp): then
      // the table differs from the answer in a field that still holds the old
      // baseline value, and the normal rule pushes the answer. Any other
      // difference is the table's own: a value we sent (it stays, only a later
      // encounter change is pushed) or one typed since (adopted, then sent).
      const sentFields: Record<string, unknown> =
        context.sent?.[id]?.[key] ?? {};
      const answerRaw =
        answer !== undefined && readBack !== undefined
          ? project(answer)
          : undefined;
      // A field the projector applies its own rule to (Stat Bubbles `hide`)
      // that the answer moved also blocks adoption: it is pushed.
      const adopted =
        answer !== undefined &&
        readBack !== undefined &&
        deepEqual(
          project(answer, o, baseline[key]),
          project(answer, o, answerRaw),
        ) &&
        Object.entries(readBack(o, answer).edit).every(
          ([field, value]) =>
            sentFields[field] === value ||
            (readBack(baseline[key], answer).edit as Record<string, unknown>)[
              field
            ] !== value,
        );
      const b = adopted ? answerRaw : baseline[key];
      // Stryker disable next-line ConditionalExpression: equivalent, without an answer b is the stored baseline, which next already holds
      if (adopted) next[key] = b;
      const d = project(instance, o, b);
      const hasBaseline = adopted || Object.hasOwn(baseline, key);
      if (raw === undefined) {
        delete next[key];
      } else if (deepEqual(d, o)) {
        next[key] = raw;
      } else if (hasBaseline) {
        if (!deepEqual(raw, b)) {
          plan.update.push({ id: token.id, key, value: d });
          next[key] = raw;
        } else if (readBack) {
          // The table was edited: write the change back unless it was
          // already sent. The baseline stays; the store's answer never
          // writes to the table.
          const { edit, invalid } = readBack(o, instance);
          const already = context.sent?.[id]?.[key] ?? {};
          const fresh = Object.fromEntries(
            Object.entries(edit).filter(
              ([field, value]) =>
                !Object.hasOwn(already, field) ||
                (already as Record<string, unknown>)[field] !== value,
            ),
          );
          if (Object.keys(fresh).length > 0)
            plan.edits.push({ instanceId: id, ...fresh });
          // Stryker disable next-line EqualityOperator,ConditionalExpression: equivalent, an empty remembered edit is the same as none
          if (Object.keys(edit).length > 0) (plan.sent[id] ??= {})[key] = edit;
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

    if (answer !== undefined) {
      // A key the plan pushes to is no longer the table's value to keep.
      const kept = owned.filter(
        (p) => !plan.update.some((u) => u.id === token.id && u.key === p.key),
      );
      const message = differsMessage(kept, token, answer);
      if (message !== undefined) plan.differs.push({ instanceId: id, message });
    }
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
