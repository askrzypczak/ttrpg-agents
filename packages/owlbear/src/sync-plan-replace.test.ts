import { describe, expect, it } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem, Vec2 } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  LOOK_BASELINE_KEY,
  NAME_BASELINE_KEY,
  POSITION_BASELINE_KEY,
  REPLACED_BY_KEY,
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  type EncounterInstance,
  type SyncConfig,
  type SyncPlan,
} from "./sync-plan.js";

const wolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/wolf.png",
  mime: "image/png",
  width: 300,
  height: 300,
};

const direWolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/dire-wolf.webp",
  mime: "image/webp",
  width: 400,
  height: 200,
  sha256: "a".repeat(64),
};

/** Dire wolf art as an item's image: the reference without its hash. */
const direWolfImage = {
  url: direWolfArt.url,
  mime: direWolfArt.mime,
  width: direWolfArt.width,
  height: direWolfArt.height,
};
/** Dire wolf art spanning 2 cells: the longer side over 2, centred. */
const direWolfGrid = { dpi: 200, offset: { x: 200, y: 100 } };

const wolfImage = {
  url: wolfArt.url,
  mime: wolfArt.mime,
  width: wolfArt.width,
  height: wolfArt.height,
};
const wolfGrid = { dpi: 300, offset: { x: 150, y: 150 } };

/** A 2-cell circle. */
const bigCircle = { shapeType: "CIRCLE", width: 300, height: 300 } as const;

const HP_KEY = "test/hp";

/** The link projector, an owned HP key, and the default token look. */
const config: SyncConfig = {
  projectors: [
    {
      key: INSTANCE_METADATA_KEY,
      mode: "owned",
      project: (i) => ({ instanceId: i.id }),
    },
    { key: HP_KEY, mode: "owned", project: (i) => i.currentHp },
  ],
  tokenKind: defaultSyncConfig.tokenKind,
};

/** Instance `n` after it was changed to a Dire Wolf (large: 2 cells). */
const direWolf = (
  n: number,
  over: Partial<EncounterInstance> = {},
): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    monsterKey: "dire-wolf",
    displayName: `Dire Wolf ${n}`,
    createdAt: n,
    footprint: 2,
    currentHp: 16,
    ...over,
  });

const position: Vec2 = { x: 450, y: 300 };

const OTHER_KEY = "other.extension/note";

/** The synced record of a token for instance `n` drawn as a Wolf. */
const wolfRecord = (
  n: number,
  image: string | null,
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
  [HP_KEY]: 16,
  [NAME_BASELINE_KEY]: `Dire Wolf ${n}`,
  [LOOK_BASELINE_KEY]: { monsterKey: "wolf", image },
  ...over,
});

/** A circle token for instance `n`, drawn for a 1-cell Wolf, with its look recorded. */
const circleToken = (
  n: number,
  over: Partial<SceneItem> & { record?: Record<string, unknown> } = {},
): SceneItem => {
  const { record, ...item } = over;
  return {
    id: `token-${n}`,
    type: "SHAPE",
    name: `Dire Wolf ${n}`,
    visible: false,
    position: { ...position },
    layer: "CHARACTER",
    shape: { shapeType: "CIRCLE", width: 150, height: 150 },
    scale: { x: 1, y: 1 },
    metadata: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [HP_KEY]: 16,
      [SYNCED_METADATA_KEY]: record ?? wolfRecord(n, null),
    },
    ...item,
  };
};

/** An image token for instance `n`, drawn as a Wolf, with its look recorded. */
const imageToken = (n: number, over: Partial<SceneItem> = {}): SceneItem => ({
  id: `token-${n}`,
  type: "IMAGE",
  name: `Dire Wolf ${n}`,
  visible: true,
  position: { ...position },
  layer: "CHARACTER",
  image: wolfImage,
  grid: wolfGrid,
  scale: { x: 1, y: 1 },
  metadata: {
    [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
    [HP_KEY]: 16,
    [SYNCED_METADATA_KEY]: wolfRecord(n, wolfArt.url),
  },
  ...over,
});

/** An item of another extension, not linked to any instance. */
const foreignItem = (id: string): SceneItem => ({
  id,
  type: "SHAPE",
  name: "Not ours",
  visible: true,
  position: { x: 0, y: 0 },
  layer: "PROP",
  shape: { shapeType: "RECTANGLE", width: 10, height: 10 },
  metadata: {},
});

const ctx = (
  over: {
    restyles?: string[];
    moves?: string[];
    art?: Record<string, PublishedTokenArt>;
    placed?: string[];
  } = {},
) => ({
  viewportCenter: { x: 1000, y: 500 },
  placed: new Set(over.placed ?? ["i1", "i2"]),
  art: over.art ?? { wolf: wolfArt, "dire-wolf": direWolfArt },
  ...(over.restyles === undefined ? {} : { restyles: new Set(over.restyles) }),
  ...(over.moves === undefined ? {} : { moves: new Set(over.moves) }),
});

/** The plan's writes that name the item `id`, apart from its replacement. */
const writesOn = (plan: SyncPlan, id: string) => ({
  rename: plan.rename.filter((r) => r.id === id),
  move: plan.move.filter((m) => m.id === id),
  restyle: plan.restyle.filter((r) => r.id === id),
  update: plan.update.filter((u) => u.id === id),
});

const noWrites = { rename: [], move: [], restyle: [], update: [] };

const replacedNote = (name: string) =>
  `${name}'s token was replaced with a new one for its new monster type at the agent's request; any attachments on the old token were deleted with it.`;

/** The synced record a planned item carries. */
const recordOf = (item: SceneItem | undefined): Record<string, unknown> =>
  item?.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>;

describe("planSync token replacement", () => {
  it("planSync replaces a circle token whose new type has art with an image token drawn from that art at the new footprint, carrying the old token's position, name, visibility, rotation, layer, lock and metadata", () => {
    const token = circleToken(1, {
      visible: true,
      rotation: 45,
      layer: "MOUNT",
      locked: true,
    });
    token.metadata[OTHER_KEY] = { keep: [1, 2] };

    const plan = planSync(
      [direWolf(1)],
      [token],
      config,
      ctx({ restyles: ["i1"] }),
    );

    expect(plan.replace).toHaveLength(1);
    const [replacement] = plan.replace;
    expect(replacement?.id).toBe("token-1");
    const item = replacement?.item;
    expect(item).toMatchObject({
      type: "IMAGE",
      image: direWolfImage,
      grid: direWolfGrid,
      name: "Dire Wolf 1",
      position,
      visible: true,
      rotation: 45,
      layer: "MOUNT",
      locked: true,
    });
    expect(item?.shape).toBeUndefined();
    expect(item?.scale ?? { x: 1, y: 1 }).toEqual({ x: 1, y: 1 });
    expect(item?.metadata[INSTANCE_METADATA_KEY]).toEqual({ instanceId: "i1" });
    expect(item?.metadata[HP_KEY]).toBe(16);
    expect(item?.metadata[OTHER_KEY]).toEqual({ keep: [1, 2] });
    expect(plan.restyle).toEqual([]);
    expect(plan.needsArt).toEqual([]);
    expect(plan.add).toEqual([]);
    expect(plan.delete).toEqual([]);
  });

  it("planSync replaces an image token whose new type has no usable art with a circle at the new footprint and lists the type in needsArt", () => {
    const plan = planSync(
      [direWolf(1), direWolf(2)],
      [imageToken(1), imageToken(2, { position: { x: 900, y: 300 } })],
      config,
      ctx({ restyles: ["i1", "i2"], art: { wolf: wolfArt } }),
    );

    expect(plan.replace.map((r) => r.id)).toEqual(["token-1", "token-2"]);
    expect(plan.replace[0]?.item).toMatchObject({
      type: "SHAPE",
      shape: bigCircle,
      name: "Dire Wolf 1",
      position,
      visible: true,
    });
    expect(plan.replace[1]?.item).toMatchObject({
      type: "SHAPE",
      shape: bigCircle,
      position: { x: 900, y: 300 },
    });
    for (const { item } of plan.replace) {
      expect(item.image).toBeUndefined();
      expect(item.scale ?? { x: 1, y: 1 }).toEqual({ x: 1, y: 1 });
    }
    expect(plan.restyle).toEqual([]);
    expect(plan.needsArt).toEqual(["dire-wolf"]);
  });

  it("planSync lists the new type of a circle token in needsArt when it has no art", () => {
    const plan = planSync(
      [direWolf(1), direWolf(2)],
      [circleToken(1), circleToken(2)],
      config,
      ctx({ restyles: ["i1", "i2"], art: { wolf: wolfArt } }),
    );

    expect(plan.needsArt).toEqual(["dire-wolf"]);
    expect(plan.replace).toEqual([]);
    expect(plan.restyle.map((r) => r.id)).toEqual(["token-1", "token-2"]);
  });

  it("planSync gives the replacement the old token's id with the next generation suffix, skipping ids already on the scene", () => {
    const newIdFor = (token: SceneItem, others: SceneItem[] = []) =>
      planSync(
        [direWolf(1)],
        [...others, token],
        config,
        ctx({ restyles: ["i1"] }),
      ).replace[0]?.item.id;

    expect(newIdFor(circleToken(1, { id: "ttrpg-instance-i1" }))).toBe(
      "ttrpg-instance-i1-r2",
    );
    expect(newIdFor(circleToken(1, { id: "token-1-r2" }))).toBe("token-1-r3");
    expect(newIdFor(circleToken(1, { id: "token-1-r9" }))).toBe("token-1-r10");
    expect(
      newIdFor(circleToken(1), [
        foreignItem("token-1-r2"),
        foreignItem("token-1-r3"),
      ]),
    ).toBe("token-1-r4");
  });

  it("planSync marks the old token's synced record with the replacement's id, and the replacement's record holds the new look and no marker", () => {
    const record = wolfRecord(1, null, { "test/extra": { kept: true } });
    const plan = planSync(
      [direWolf(1)],
      [circleToken(1, { record })],
      config,
      ctx({ restyles: ["i1"] }),
    );

    expect(plan.replace).toHaveLength(1);
    const [replacement] = plan.replace;
    expect(replacement?.item.id).toBe("token-1-r2");
    expect(replacement?.marker).toEqual({
      ...record,
      [REPLACED_BY_KEY]: "token-1-r2",
    });
    const synced = recordOf(replacement?.item);
    expect(synced).toMatchObject({
      [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
      [HP_KEY]: 16,
      [NAME_BASELINE_KEY]: "Dire Wolf 1",
      [LOOK_BASELINE_KEY]: { monsterKey: "dire-wolf", image: direWolfArt.url },
    });
    expect(Object.hasOwn(synced ?? {}, REPLACED_BY_KEY)).toBe(false);

    // A circle replacing an image token records no picture.
    const toCircle = planSync(
      [direWolf(1)],
      [imageToken(1)],
      config,
      ctx({ restyles: ["i1"], art: {} }),
    );
    expect(recordOf(toCircle.replace[0]?.item)[LOOK_BASELINE_KEY]).toEqual({
      monsterKey: "dire-wolf",
      image: null,
    });
  });

  it("planSync folds the old token's planned rename, move and metadata writes into the replacement and plans none of them on the old token", () => {
    const target: Vec2 = { x: 600, y: 750 };
    const token = circleToken(1, {
      name: "Wolf 1",
      record: wolfRecord(1, null, {
        [NAME_BASELINE_KEY]: "Wolf 1",
        [POSITION_BASELINE_KEY]: { ...position },
      }),
    });

    const plan = planSync(
      [direWolf(1, { currentHp: 31, spawnPosition: target })],
      [token],
      config,
      ctx({ restyles: ["i1"], moves: ["i1"] }),
    );

    expect(plan.replace).toHaveLength(1);
    const item = plan.replace[0]?.item;
    expect(item).toMatchObject({ name: "Dire Wolf 1", position: target });
    expect(item?.metadata[HP_KEY]).toBe(31);
    expect(recordOf(item)).toMatchObject({
      [HP_KEY]: 31,
      [NAME_BASELINE_KEY]: "Dire Wolf 1",
      [POSITION_BASELINE_KEY]: target,
    });
    expect(writesOn(plan, "token-1")).toEqual(noWrites);
    expect(writesOn(plan, "token-1-r2")).toEqual(noWrites);
    // The token was where it was last placed: no move note.
    expect(plan.overrides).toEqual([
      { instanceId: "i1", message: replacedNote("Dire Wolf 1") },
    ]);
  });

  it("planSync finishes a half-done replacement: it deletes the marked token whose replacement is on the scene, keeps the replacement as the instance's token and plans no new replacement", () => {
    const target: Vec2 = { x: 600, y: 750 };
    const marked = circleToken(1, {
      record: wolfRecord(1, null, {
        [POSITION_BASELINE_KEY]: { ...position },
        [REPLACED_BY_KEY]: "token-1-r2",
      }),
    });
    const replacement = imageToken(1, {
      id: "token-1-r2",
      image: direWolfImage,
      grid: direWolfGrid,
      metadata: {
        [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
        [HP_KEY]: 16,
        [SYNCED_METADATA_KEY]: wolfRecord(1, null, {
          [POSITION_BASELINE_KEY]: { ...position },
          [LOOK_BASELINE_KEY]: {
            monsterKey: "dire-wolf",
            image: direWolfArt.url,
          },
        }),
      },
    });

    for (const scene of [
      [marked, replacement],
      [replacement, marked],
    ]) {
      const plan = planSync(
        [direWolf(1, { spawnPosition: target })],
        scene,
        config,
        ctx({ restyles: ["i1"], moves: ["i1"] }),
      );

      expect(plan.delete).toEqual(["token-1"]);
      expect(plan.replace).toEqual([]);
      expect(plan.restyle).toEqual([]);
      expect(plan.add).toEqual([]);
      expect(plan.deleted).toEqual([]);
      expect(writesOn(plan, "token-1")).toEqual(noWrites);
      // The replacement is the instance's token: the usual rules apply to it.
      expect(plan.move).toEqual([{ id: "token-1-r2", position: target }]);
    }
  });

  it("planSync treats a marked token whose replacement is not on the scene as the instance's token, never reports its instance deleted, and plans the replacement again", () => {
    const stale = wolfRecord(1, null, { [REPLACED_BY_KEY]: "token-1-r2" });
    const plan = planSync(
      [direWolf(1)],
      [circleToken(1, { record: stale })],
      config,
      ctx({ restyles: ["i1"], placed: ["i1"] }),
    );

    expect(plan.deleted).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(plan.add).toEqual([]);
    expect(plan.replace).toHaveLength(1);
    expect(plan.replace[0]?.id).toBe("token-1");
    expect(plan.replace[0]?.item.id).toBe("token-1-r2");
    expect(plan.replace[0]?.item.type).toBe("IMAGE");
    expect(plan.replace[0]?.marker[REPLACED_BY_KEY]).toBe("token-1-r2");

    // Already drawn as the new type: no replacement, and still not deleted.
    const drawn = imageToken(1, {
      image: direWolfImage,
      grid: direWolfGrid,
      metadata: {
        [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
        [HP_KEY]: 16,
        [SYNCED_METADATA_KEY]: wolfRecord(1, direWolfArt.url, {
          [LOOK_BASELINE_KEY]: {
            monsterKey: "dire-wolf",
            image: direWolfArt.url,
          },
          [REPLACED_BY_KEY]: "token-1-r5",
        }),
      },
    });
    const quiet = planSync(
      [direWolf(1)],
      [drawn],
      config,
      ctx({ placed: ["i1"] }),
    );
    expect(quiet.deleted).toEqual([]);
    expect(quiet.delete).toEqual([]);
    expect(quiet.add).toEqual([]);
    expect(quiet.replace).toEqual([]);
  });

  it("planSync lists a replacement in overrides with the replacement note, and again when it finishes a half-done one", () => {
    const note = { instanceId: "i1", message: replacedNote("Dire Wolf 1") };

    // A token as it was last drawn.
    const plan = planSync(
      [direWolf(1)],
      [circleToken(1)],
      config,
      ctx({ restyles: ["i1"] }),
    );
    expect(plan.replace).toHaveLength(1);
    expect(plan.overrides).toEqual([note]);

    // The GM resized it, or it has no recorded look: still only the
    // replacement note.
    const resized = planSync(
      [direWolf(1)],
      [circleToken(1, { scale: { x: 2, y: 2 } })],
      config,
      ctx({ restyles: ["i1"] }),
    );
    expect(resized.overrides).toEqual([note]);
    const unrecorded = { ...wolfRecord(1, null) };
    delete unrecorded[LOOK_BASELINE_KEY];
    const noLook = planSync(
      [direWolf(1)],
      [circleToken(1, { record: unrecorded })],
      config,
      ctx({ restyles: ["i1"] }),
    );
    expect(noLook.overrides).toEqual([note]);

    // A move folded into the replacement keeps its own note.
    const target: Vec2 = { x: 600, y: 750 };
    const dragged = planSync(
      [direWolf(1, { spawnPosition: target })],
      [
        circleToken(1, {
          position: { x: 10, y: 10 },
          record: wolfRecord(1, null, {
            [POSITION_BASELINE_KEY]: { ...position },
          }),
        }),
      ],
      config,
      ctx({ restyles: ["i1"], moves: ["i1"] }),
    );
    expect(dragged.overrides).toHaveLength(2);
    expect(dragged.overrides).toContainEqual(note);
    expect(dragged.overrides).toContainEqual({
      instanceId: "i1",
      message:
        "Dire Wolf 1 was moved at the agent's request; its token had been moved on the table, and that position was overwritten.",
    });

    // A half-done replacement finished by deleting the marked token.
    const halfDone = planSync(
      [direWolf(1)],
      [
        circleToken(1, {
          record: wolfRecord(1, null, { [REPLACED_BY_KEY]: "token-1-r2" }),
        }),
        imageToken(1, {
          id: "token-1-r2",
          image: direWolfImage,
          grid: direWolfGrid,
          metadata: {
            [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
            [HP_KEY]: 16,
            [SYNCED_METADATA_KEY]: wolfRecord(1, null, {
              [LOOK_BASELINE_KEY]: {
                monsterKey: "dire-wolf",
                image: direWolfArt.url,
              },
            }),
          },
        }),
      ],
      config,
      ctx({ restyles: ["i1"] }),
    );
    expect(halfDone.delete).toEqual(["token-1"]);
    expect(halfDone.overrides).toEqual([note]);
  });
});
