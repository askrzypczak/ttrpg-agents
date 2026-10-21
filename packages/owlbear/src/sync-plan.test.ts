import { describe, expect, it } from "vitest";
import type { SceneItem } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  rowPositions,
  type EncounterInstance,
  type Projector,
  type SyncConfig,
  type SyncPlan,
} from "./sync-plan.js";

const inst = (
  n: number,
  over: Partial<EncounterInstance> = {},
): EncounterInstance => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: `Shadow ${n}`,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  groupId: null,
  createdAt: n,
  ...over,
});

const HP_KEY = "test.ext/hp";
const NOTE_KEY = "test.ext/note";

const link: Projector = {
  key: INSTANCE_METADATA_KEY,
  mode: "owned",
  project: (i) => ({ instanceId: i.id }),
};
const hp: Projector = {
  key: HP_KEY,
  mode: "owned",
  project: (i) => i.currentHp,
};
const note: Projector = {
  key: NOTE_KEY,
  mode: "create-only",
  project: (i) => i.displayName,
};

const shapeKind = () => ({
  type: "SHAPE",
  shape: { shapeType: "CIRCLE" as const, width: 150, height: 150 },
});

const config = (...projectors: Projector[]): SyncConfig => ({
  projectors,
  tokenKind: shapeKind,
});

const center = { x: 1000, y: 500 };
const ctx = (placed: string[] = []) => ({
  viewportCenter: center,
  placed: new Set(placed),
});

/** An existing token of ours for instance `n` with the given extra metadata. */
const token = (
  n: number,
  metadata: Record<string, unknown> = {},
  over: Partial<SceneItem> = {},
): SceneItem => ({
  id: `token-${n}`,
  type: "SHAPE",
  name: `Shadow ${n}`,
  visible: false,
  position: { x: 0, y: 0 },
  metadata: { [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` }, ...metadata },
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
  ...over,
});

/** The link baseline a token of ours has once we wrote it. */
const linkBaseline = (n: number) => ({
  [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
});

const foreign: SceneItem = {
  id: "map",
  type: "IMAGE",
  name: "Map",
  visible: true,
  position: { x: 0, y: 0 },
  metadata: { "other.ext/thing": { instanceId: "i1" } },
};

/** Applies the plan's key-level metadata updates to copies of `items`. */
function applyUpdates(items: SceneItem[], plan: SyncPlan): SceneItem[] {
  const out = structuredClone(items);
  for (const { id, key, value } of plan.update) {
    const item = out.find((i) => i.id === id);
    if (!item) throw new Error(`update for unknown item ${id}`);
    if (value === undefined) delete item.metadata[key];
    else item.metadata[key] = structuredClone(value);
  }
  return out;
}

const metadataOf = (items: SceneItem[], id: string) =>
  items.find((i) => i.id === id)!.metadata;

describe("planSync", () => {
  it("adds an instance with no token", () => {
    const plan = planSync(
      [inst(1), inst(2), inst(3)],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect(plan.delete).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.add.map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 2",
      "Shadow 3",
    ]);
    expect(plan.add.map((i) => i.metadata[INSTANCE_METADATA_KEY])).toEqual([
      { instanceId: "i1" },
      { instanceId: "i2" },
      { instanceId: "i3" },
    ]);
    expect(plan.add.every((i) => i.visible === false)).toBe(true);
    expect(plan.add.every((i) => i.type === "SHAPE")).toBe(true);
    expect(plan.add.every((i) => i.shape?.shapeType === "CIRCLE")).toBe(true);
    expect(plan.add.map((i) => i.position)).toEqual(rowPositions(3, center));
    expect(new Set(plan.add.map((i) => i.id)).size).toBe(3);
  });

  it("deletes our token with no instance", () => {
    const stale = token(9);
    const plan = planSync(
      [inst(1)],
      [token(1, { [SYNCED_METADATA_KEY]: linkBaseline(1) }), stale],
      config(link),
      ctx(["i1", "i9"]),
    );
    expect(plan.delete).toEqual([stale.id]);
    expect(plan.add).toEqual([]);
  });

  it("leaves items that are not ours alone", () => {
    const plan = planSync([inst(1)], [foreign], config(link, hp), ctx());
    expect(plan.delete).toEqual([]);
    expect(plan.update.filter((u) => u.id === foreign.id)).toEqual([]);
    // The foreign item's look-alike metadata does not count as a token of i1.
    expect(plan.add.map((i) => i.metadata[INSTANCE_METADATA_KEY])).toEqual([
      { instanceId: "i1" },
    ]);
  });

  it("plans nothing when the scene matches", () => {
    const plan = planSync(
      [inst(1), inst(2)],
      [
        token(1, { [SYNCED_METADATA_KEY]: linkBaseline(1) }),
        token(2, { [SYNCED_METADATA_KEY]: linkBaseline(2) }),
        foreign,
      ],
      defaultSyncConfig,
      ctx(["i1", "i2"]),
    );
    expect(plan).toEqual({ add: [], update: [], delete: [] });
  });

  it("pushes an owned key when the encounter changed and the table did not", () => {
    const observed = [
      token(1, {
        [HP_KEY]: 16,
        [SYNCED_METADATA_KEY]: { ...linkBaseline(1), [HP_KEY]: 16 },
      }),
    ];
    const plan = planSync(
      [inst(1, { currentHp: 10 })],
      observed,
      config(link, hp),
      ctx(["i1"]),
    );
    expect(plan.add).toEqual([]);
    expect(plan.delete).toEqual([]);
    const metadata = metadataOf(applyUpdates(observed, plan), "token-1");
    expect(metadata[HP_KEY]).toBe(10);
    expect(metadata[SYNCED_METADATA_KEY]).toEqual({
      ...linkBaseline(1),
      [HP_KEY]: 10,
    });
  });

  it("leaves an owned key the table changed while the encounter did not", () => {
    const observed = [
      token(1, {
        [HP_KEY]: 5,
        [SYNCED_METADATA_KEY]: { ...linkBaseline(1), [HP_KEY]: 16 },
      }),
    ];
    const plan = planSync(
      [inst(1, { currentHp: 16 })],
      observed,
      config(link, hp),
      ctx(["i1"]),
    );
    expect(plan).toEqual({ add: [], update: [], delete: [] });
  });

  it("pushes after a table edit once the encounter changes again", () => {
    const observed = [
      token(1, {
        [HP_KEY]: 5,
        [SYNCED_METADATA_KEY]: { ...linkBaseline(1), [HP_KEY]: 16 },
      }),
    ];
    const plan = planSync(
      [inst(1, { currentHp: 10 })],
      observed,
      config(link, hp),
      ctx(["i1"]),
    );
    const metadata = metadataOf(applyUpdates(observed, plan), "token-1");
    expect(metadata[HP_KEY]).toBe(10);
    expect(metadata[SYNCED_METADATA_KEY]).toEqual({
      ...linkBaseline(1),
      [HP_KEY]: 10,
    });
  });

  it("re-baselines when the table already equals the encounter", () => {
    const observed = [
      token(1, {
        [HP_KEY]: 10,
        [SYNCED_METADATA_KEY]: { ...linkBaseline(1), [HP_KEY]: 16 },
      }),
    ];
    const plan = planSync(
      [inst(1, { currentHp: 10 })],
      observed,
      config(link, hp),
      ctx(["i1"]),
    );
    expect(plan.update.filter((u) => u.key === HP_KEY)).toEqual([]);
    const metadata = metadataOf(applyUpdates(observed, plan), "token-1");
    expect(metadata[HP_KEY]).toBe(10);
    expect(metadata[SYNCED_METADATA_KEY]).toEqual({
      ...linkBaseline(1),
      [HP_KEY]: 10,
    });
  });

  it("writes an absent owned key and adopts an existing value when there is no baseline", () => {
    const observed = [
      // No value and no baseline for the key: we write it.
      token(1, { [SYNCED_METADATA_KEY]: linkBaseline(1) }),
      // A value from a legacy token or another writer, no baseline: kept.
      token(2, { [HP_KEY]: 3 }),
    ];
    const plan = planSync(
      [inst(1), inst(2)],
      observed,
      config(link, hp),
      ctx(["i1", "i2"]),
    );
    expect(plan.add).toEqual([]);
    expect(plan.delete).toEqual([]);
    const after = applyUpdates(observed, plan);
    const first = metadataOf(after, "token-1");
    expect(first[HP_KEY]).toBe(16);
    expect(first[SYNCED_METADATA_KEY]).toMatchObject({ [HP_KEY]: 16 });
    const second = metadataOf(after, "token-2");
    expect(second[HP_KEY]).toBe(3);
    expect(second[SYNCED_METADATA_KEY]).toMatchObject({ [HP_KEY]: 16 });
  });

  it("never changes create-only keys, position or visibility of an existing token", () => {
    const observed = [
      token(
        1,
        {
          [NOTE_KEY]: "a note the GM wrote",
          [SYNCED_METADATA_KEY]: { ...linkBaseline(1), [NOTE_KEY]: "Old name" },
        },
        { name: "Renamed", visible: true, position: { x: 7, y: 9 } },
      ),
    ];
    const plan = planSync([inst(1)], observed, config(link, note), ctx(["i1"]));
    expect(plan.add).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(plan.update.filter((u) => u.key === NOTE_KEY)).toEqual([]);
    expect(metadataOf(applyUpdates(observed, plan), "token-1")[NOTE_KEY]).toBe(
      "a note the GM wrote",
    );
  });

  it("does not recreate an instance already placed on this scene", () => {
    const plan = planSync(
      [inst(1), inst(2)],
      [token(2, { [SYNCED_METADATA_KEY]: linkBaseline(2) })],
      defaultSyncConfig,
      ctx(["i1", "i2"]),
    );
    expect(plan).toEqual({ add: [], update: [], delete: [] });
  });

  it("plans a non-default token kind (IMAGE on CHARACTER)", () => {
    const image = {
      url: "https://example.test/shadow.png",
      mime: "image/png",
      width: 300,
      height: 300,
    };
    const grid = { dpi: 300, offset: { x: 150, y: 150 } };
    const imageConfig: SyncConfig = {
      projectors: [link],
      tokenKind: () => ({ type: "IMAGE", layer: "CHARACTER", image, grid }),
    };
    const plan = planSync([inst(1)], [], imageConfig, ctx());
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]).toMatchObject({
      type: "IMAGE",
      layer: "CHARACTER",
      image,
      grid,
      name: "Shadow 1",
      visible: false,
    });
    expect(plan.add[0]!.shape).toBeUndefined();
  });

  it("new tokens carry projector values and baselines", () => {
    const plan = planSync(
      [inst(1, { currentHp: 12 })],
      [],
      config(link, hp, note),
      ctx(),
    );
    expect(plan.add).toHaveLength(1);
    const metadata = plan.add[0]!.metadata;
    expect(metadata[INSTANCE_METADATA_KEY]).toEqual({ instanceId: "i1" });
    expect(metadata[HP_KEY]).toBe(12);
    expect(metadata[NOTE_KEY]).toBe("Shadow 1");
    expect(metadata[SYNCED_METADATA_KEY]).toMatchObject({
      ...linkBaseline(1),
      [HP_KEY]: 12,
    });
  });
});

describe("rowPositions", () => {
  it("rowPositions centres a row", () => {
    expect(rowPositions(3, { x: 1000, y: 500 })).toEqual([
      { x: 850, y: 500 },
      { x: 1000, y: 500 },
      { x: 1150, y: 500 },
    ]);
    expect(rowPositions(1, { x: 10, y: 20 })).toEqual([{ x: 10, y: 20 }]);
  });
});
