import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  type EncounterInstance,
  type Projector,
  type SyncConfig,
  type SyncPlan,
} from "./sync-plan.js";

const inst = (
  n: number,
  over: Partial<EncounterInstance> = {},
): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    displayName: `Shadow ${n}`,
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
  art: {},
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

/** The link and name baseline a token of ours has once we wrote it. */
const linkBaseline = (n: number) => ({
  [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
  [NAME_BASELINE_KEY]: `Shadow ${n}`,
});

/** The stat bubbles value the default config writes for the default `inst(n)`. */
const bubbles = { health: 16, "max health": 16, hide: true };

/** The link, name and stat bubbles baseline a token of ours has once the default config wrote it. */
const defaultBaseline = (n: number) => ({
  ...linkBaseline(n),
  [STAT_BUBBLES_METADATA_KEY]: bubbles,
});

/** A token of ours the default config wrote for the default `inst(n)`; `metadata` adds to or overrides its keys. */
const defaultToken = (
  n: number,
  metadata: Record<string, unknown> = {},
  over: Partial<SceneItem> = {},
): SceneItem =>
  token(
    n,
    {
      [STAT_BUBBLES_METADATA_KEY]: bubbles,
      [SYNCED_METADATA_KEY]: defaultBaseline(n),
      ...metadata,
    },
    over,
  );

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

describe("planSync projector arguments", () => {
  it("planSync passes the key's baseline value to the projector", () => {
    const calls: { id: string; current: unknown; baseline: unknown }[] = [];
    const recording: Projector = {
      key: HP_KEY,
      mode: "owned",
      project: (i, current, baseline) => {
        calls.push({ id: i.id, current, baseline });
        return i.currentHp;
      },
    };
    const withBaseline = token(1, {
      [HP_KEY]: 7,
      [SYNCED_METADATA_KEY]: { ...linkBaseline(1), [HP_KEY]: 9 },
    });
    const withoutBaseline = token(2, {
      [HP_KEY]: 5,
      [SYNCED_METADATA_KEY]: linkBaseline(2),
    });

    planSync(
      [inst(1), inst(2)],
      [withBaseline, withoutBaseline],
      config(link, recording),
      ctx(["i1", "i2"]),
    );

    expect(calls).toContainEqual({ id: "i1", current: 7, baseline: 9 });
    expect(calls).toContainEqual({ id: "i2", current: 5, baseline: undefined });
  });
});

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
    expect(plan.add.map((i) => i.position)).toEqual([
      { x: 850, y: 500 },
      { x: 1000, y: 500 },
      { x: 1150, y: 500 },
    ]);
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
      [defaultToken(1), defaultToken(2), foreign],
      defaultSyncConfig,
      ctx(["i1", "i2"]),
    );
    expect(plan).toEqual({
      add: [],
      update: [],
      delete: [],
      rename: [],
      move: [],
      deleted: [],
      needsArt: [],
      edits: [],
      rejected: [],
      overrides: [],
    });
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
    expect(plan).toEqual({
      add: [],
      update: [],
      delete: [],
      rename: [],
      move: [],
      deleted: [],
      needsArt: [],
      edits: [],
      rejected: [],
      overrides: [],
    });
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
      [defaultToken(2)],
      defaultSyncConfig,
      ctx(["i1", "i2"]),
    );
    expect(plan).toMatchObject({
      add: [],
      update: [],
      delete: [],
      rename: [],
      move: [],
    });
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
      [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
      [HP_KEY]: 12,
    });
  });
});

describe("planSync deleted", () => {
  it("reports a wanted instance that is placed and has no token as deleted", () => {
    const plan = planSync(
      [inst(1), inst(2)],
      [token(2, { [SYNCED_METADATA_KEY]: linkBaseline(2) })],
      defaultSyncConfig,
      ctx(["i1", "i2"]),
    );
    expect(plan.deleted).toEqual(["i1"]);
    expect(plan.add).toEqual([]);
  });

  it("does not report one that is not placed (fresh scene is populated)", () => {
    // i1 is the placed control; i2 was never placed on this scene.
    const plan = planSync(
      [inst(1), inst(2)],
      [],
      defaultSyncConfig,
      ctx(["i1"]),
    );
    expect(plan.deleted).toEqual(["i1"]);
    expect(plan.add.map((i) => i.metadata[INSTANCE_METADATA_KEY])).toEqual([
      { instanceId: "i2" },
    ]);
  });

  it("does not report one that still has a token", () => {
    // i2's token has no baseline yet, i3's has one; i1's token is gone.
    const plan = planSync(
      [inst(1), inst(2), inst(3)],
      [token(2), token(3, { [SYNCED_METADATA_KEY]: linkBaseline(3) })],
      defaultSyncConfig,
      ctx(["i1", "i2", "i3"]),
    );
    expect(plan.deleted).toEqual(["i1"]);
  });

  it("does not report an instance that is no longer wanted", () => {
    // i9 is still in the placed record but has left the encounter.
    const plan = planSync([inst(1)], [], defaultSyncConfig, ctx(["i1", "i9"]));
    expect(plan.deleted).toEqual(["i1"]);
  });
});

/** The synced record of `id` after applying the plan's metadata updates. */
const syncedAfter = (items: SceneItem[], plan: SyncPlan, id: string) =>
  metadataOf(applyUpdates(items, plan), id)[SYNCED_METADATA_KEY];

describe("planSync token name", () => {
  it("renames a token whose name equals its baseline when the store name changed", () => {
    const observed = [defaultToken(1)];
    const plan = planSync(
      [inst(1, { displayName: "Boss" })],
      observed,
      defaultSyncConfig,
      ctx(["i1"]),
    );
    expect(plan.add).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(plan.rename).toEqual([{ id: "token-1", name: "Boss" }]);
    expect(syncedAfter(observed, plan, "token-1")).toEqual({
      ...defaultBaseline(1),
      [NAME_BASELINE_KEY]: "Boss",
    });
  });

  it("records a name baseline on creation", () => {
    const plan = planSync([inst(1)], [], defaultSyncConfig, ctx());
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]!.name).toBe("Shadow 1");
    expect(plan.add[0]!.metadata[SYNCED_METADATA_KEY]).toMatchObject({
      [NAME_BASELINE_KEY]: "Shadow 1",
    });
    expect(plan.rename).toEqual([]);
  });

  it("leaves a GM-renamed token alone while the store name is unchanged", () => {
    const observed = [
      // The GM renamed token 1 on the table; its store name is unchanged.
      defaultToken(1, {}, { name: "Boss" }),
      // Control: token 2's store name changed, so it is renamed.
      defaultToken(2),
    ];
    const plan = planSync(
      [inst(1), inst(2, { displayName: "Ghost" })],
      observed,
      defaultSyncConfig,
      ctx(["i1", "i2"]),
    );
    expect(plan.rename).toEqual([{ id: "token-2", name: "Ghost" }]);
    expect(syncedAfter(observed, plan, "token-1")).toEqual(defaultBaseline(1));
  });

  it("renames again after a further store change even if the GM had renamed it", () => {
    const observed = [defaultToken(1, {}, { name: "Boss" })];
    const plan = planSync(
      [inst(1, { displayName: "Ghost" })],
      observed,
      defaultSyncConfig,
      ctx(["i1"]),
    );
    expect(plan.rename).toEqual([{ id: "token-1", name: "Ghost" }]);
    expect(syncedAfter(observed, plan, "token-1")).toEqual({
      ...defaultBaseline(1),
      [NAME_BASELINE_KEY]: "Ghost",
    });
  });

  it("keeps the token name and adopts the baseline when there is no name baseline", () => {
    const observed = [
      // A token from before name sync: no name in its synced record.
      defaultToken(
        1,
        {
          [SYNCED_METADATA_KEY]: {
            [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
            [STAT_BUBBLES_METADATA_KEY]: bubbles,
          },
        },
        { name: "Boss" },
      ),
    ];
    const plan = planSync([inst(1)], observed, defaultSyncConfig, ctx(["i1"]));
    expect(plan.rename).toEqual([]);
    expect(syncedAfter(observed, plan, "token-1")).toEqual(defaultBaseline(1));
  });

  it("re-baselines when token name already equals the store name", () => {
    const observed = [defaultToken(1, {}, { name: "Ghost" })];
    const plan = planSync(
      [inst(1, { displayName: "Ghost" })],
      observed,
      defaultSyncConfig,
      ctx(["i1"]),
    );
    expect(plan.rename).toEqual([]);
    expect(syncedAfter(observed, plan, "token-1")).toEqual({
      ...defaultBaseline(1),
      [NAME_BASELINE_KEY]: "Ghost",
    });
  });
});

describe("planSync initiative tracker", () => {
  const tracker = (count: string) => ({ count, active: false });
  const syncedOf = (item: SceneItem) =>
    item.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>;

  it("a new token from the default config carries the tracker metadata and is hidden", () => {
    const plan = planSync(
      [inst(1, { initiative: 14 })],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]!.metadata[INITIATIVE_METADATA_KEY]).toEqual(
      tracker("14"),
    );
    expect(plan.add[0]!.visible).toBe(false);
  });

  it("a null initiative on a new token has no tracker key and no baseline entry", () => {
    const plan = planSync(
      [inst(1, { initiative: null }), inst(2, { initiative: 12 })],
      [],
      defaultSyncConfig,
      ctx(),
    );
    const [none, rolled] = plan.add;
    expect(Object.hasOwn(none!.metadata, INITIATIVE_METADATA_KEY)).toBe(false);
    expect(Object.hasOwn(syncedOf(none!), INITIATIVE_METADATA_KEY)).toBe(false);
    // Control: the projector is active in the default config.
    expect(rolled!.metadata[INITIATIVE_METADATA_KEY]).toEqual(tracker("12"));
  });

  it("a null initiative on an existing token writes nothing and records no baseline", () => {
    const observed = [defaultToken(1), defaultToken(2)];
    const plan = planSync(
      [inst(1, { initiative: null }), inst(2, { initiative: 12 })],
      observed,
      defaultSyncConfig,
      ctx(["i1", "i2"]),
    );
    expect(plan.update.filter((u) => u.id === "token-1")).toEqual([]);
    const after = applyUpdates(observed, plan);
    expect(
      Object.hasOwn(metadataOf(after, "token-1"), INITIATIVE_METADATA_KEY),
    ).toBe(false);
    expect(syncedAfter(observed, plan, "token-1")).toEqual(defaultBaseline(1));
    // Control: the projector is active in the default config.
    expect(metadataOf(after, "token-2")[INITIATIVE_METADATA_KEY]).toEqual(
      tracker("12"),
    );
  });

  it("a null initiative drops an existing tracker baseline", () => {
    const observed = [
      defaultToken(1, {
        [SYNCED_METADATA_KEY]: {
          ...defaultBaseline(1),
          [INITIATIVE_METADATA_KEY]: tracker("14"),
        },
      }),
    ];
    const plan = planSync(
      [inst(1, { initiative: null })],
      observed,
      defaultSyncConfig,
      ctx(["i1"]),
    );
    expect(syncedAfter(observed, plan, "token-1")).toEqual(defaultBaseline(1));
  });

  it("planSync pushes a changed initiative count and keeps active true on the token", () => {
    const observed = [
      defaultToken(1, {
        [INITIATIVE_METADATA_KEY]: { count: "10", active: true },
        [SYNCED_METADATA_KEY]: {
          ...defaultBaseline(1),
          [INITIATIVE_METADATA_KEY]: tracker("10"),
        },
      }),
    ];
    const plan = planSync(
      [inst(1, { initiative: 14 })],
      observed,
      defaultSyncConfig,
      {
        ...ctx(["i1"]),
        fields: new Map([["i1", { moved: new Set(["initiative" as const]) }]]),
      },
    );
    expect(
      plan.update.filter(
        (u) => u.id === "token-1" && u.key === INITIATIVE_METADATA_KEY,
      ),
    ).toEqual([
      {
        id: "token-1",
        key: INITIATIVE_METADATA_KEY,
        value: { count: "14", active: true },
      },
    ]);
    const after = applyUpdates(observed, plan);
    expect(metadataOf(after, "token-1")[INITIATIVE_METADATA_KEY]).toEqual({
      count: "14",
      active: true,
    });
    expect(syncedAfter(observed, plan, "token-1")).toEqual({
      ...defaultBaseline(1),
      [INITIATIVE_METADATA_KEY]: tracker("14"),
    });
  });

  it("planSync keeps a tracker-side count edit on the token and plans it as an edit, even after the token became active", () => {
    const observed = [
      defaultToken(1, {
        [INITIATIVE_METADATA_KEY]: { count: "20", active: true },
        [SYNCED_METADATA_KEY]: {
          ...defaultBaseline(1),
          [INITIATIVE_METADATA_KEY]: tracker("10"),
        },
      }),
    ];
    const plan = planSync(
      [inst(1, { initiative: 10 })],
      observed,
      defaultSyncConfig,
      ctx(["i1"]),
    );
    expect(plan.update).toEqual([]);
    expect(plan.edits).toEqual([{ instanceId: "i1", initiative: 20 }]);
    const after = applyUpdates(observed, plan);
    expect(metadataOf(after, "token-1")[INITIATIVE_METADATA_KEY]).toEqual({
      count: "20",
      active: true,
    });
  });
});

describe("planSync row layout", () => {
  it("planSync places a row of one-cell tokens 150 apart, centred on the viewport (unchanged layout)", () => {
    const row = planSync(
      [inst(1), inst(2), inst(3)],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect(row.add.map((i) => i.position)).toEqual([
      { x: 850, y: 500 },
      { x: 1000, y: 500 },
      { x: 1150, y: 500 },
    ]);
    const single = planSync([inst(1)], [], defaultSyncConfig, {
      ...ctx(),
      viewportCenter: { x: 10, y: 20 },
    });
    expect(single.add.map((i) => i.position)).toEqual([{ x: 10, y: 20 }]);
  });

  it("a row of mixed footprints gives each token its own slot, centred as a whole", () => {
    // Slots 150 and 300 wide side by side: the 450-wide row spans x 775..1225.
    const plan = planSync(
      [inst(1, { footprint: 1 }), inst(2, { footprint: 2 })],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect(plan.add.map((i) => i.position)).toEqual([
      { x: 850, y: 500 },
      { x: 1075, y: 500 },
    ]);
  });
});

describe("planSync spawn position", () => {
  const spawn = { x: 225, y: 375 };
  const positionOf = (plan: SyncPlan, n: number) =>
    plan.add.find(
      (i) =>
        (i.metadata[INSTANCE_METADATA_KEY] as { instanceId: string })
          .instanceId === `i${n}`,
    )?.position;

  it("a new token is created at its instance's spawn position", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: spawn })],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect(positionOf(plan, 1)).toEqual(spawn);
  });

  it("a new token without a spawn position goes in the default row at the viewport centre", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: spawn }), inst(2, { spawnPosition: null })],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect(positionOf(plan, 2)).toEqual(center);
  });

  it("the default row holds only the new tokens without a spawn position", () => {
    const plan = planSync(
      [
        inst(1, { spawnPosition: null }),
        inst(2, { spawnPosition: spawn }),
        inst(3, { spawnPosition: null }),
      ],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect([1, 2, 3].map((n) => positionOf(plan, n))).toEqual([
      { x: 925, y: 500 },
      spawn,
      { x: 1075, y: 500 },
    ]);
  });

  it("an existing token is not moved to its instance's spawn position without a change", () => {
    // Token 1 sits where the GM left it; instance 2 is new in the same plan.
    const plan = planSync(
      [inst(1, { spawnPosition: spawn }), inst(2, { spawnPosition: spawn })],
      [defaultToken(1, {}, { position: { x: 7, y: 9 } })],
      defaultSyncConfig,
      ctx(["i1"]),
    );
    expect(plan.update.filter((u) => u.id === "token-1")).toEqual([]);
    expect(plan.move).toEqual([]);
    expect(positionOf(plan, 1)).toBeUndefined();
    expect(positionOf(plan, 2)).toEqual(spawn);
  });
});
