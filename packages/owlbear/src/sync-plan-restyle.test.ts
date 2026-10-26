import { describe, expect, it } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem, Vec2 } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  LOOK_BASELINE_KEY,
  NAME_BASELINE_KEY,
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

/** Only the link projector, and the default token look. */
const config: SyncConfig = {
  projectors: [
    {
      key: INSTANCE_METADATA_KEY,
      mode: "owned",
      project: (i) => ({ instanceId: i.id }),
    },
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
    ...over,
  });

const position: Vec2 = { x: 450, y: 300 };

type Look = { monsterKey: string; image: string | null };

/** An image token for instance `n`, drawn as a Wolf, with `look` recorded (none for null). */
const imageToken = (
  n: number,
  over: {
    look?: Look | null;
    image?: SceneItem["image"];
    grid?: SceneItem["grid"];
    scale?: Vec2 | null;
  } = {},
): SceneItem => {
  const look =
    over.look === undefined
      ? { monsterKey: "wolf", image: wolfArt.url }
      : over.look;
  return {
    id: `token-${n}`,
    type: "IMAGE",
    name: `Dire Wolf ${n}`,
    visible: true,
    position: { ...position },
    layer: "CHARACTER",
    image: over.image ?? wolfImage,
    grid: over.grid ?? wolfGrid,
    ...(over.scale === null ? {} : { scale: over.scale ?? { x: 1, y: 1 } }),
    metadata: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [SYNCED_METADATA_KEY]: {
        [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
        [NAME_BASELINE_KEY]: `Dire Wolf ${n}`,
        ...(look === null ? {} : { [LOOK_BASELINE_KEY]: look }),
      },
    },
  };
};

/** A circle token for instance `n`, drawn for a 1-cell Wolf, with its look recorded. */
const circleToken = (n: number): SceneItem => ({
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
    [SYNCED_METADATA_KEY]: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [NAME_BASELINE_KEY]: `Dire Wolf ${n}`,
      [LOOK_BASELINE_KEY]: { monsterKey: "wolf", image: null },
    },
  },
});

const ctx = (
  over: {
    restyles?: string[];
    art?: Record<string, PublishedTokenArt>;
    placed?: string[];
  } = {},
) => ({
  viewportCenter: { x: 1000, y: 500 },
  placed: new Set(over.placed ?? ["i1", "i2"]),
  art: over.art ?? { wolf: wolfArt, "dire-wolf": direWolfArt },
  ...(over.restyles === undefined ? {} : { restyles: new Set(over.restyles) }),
});

/** The look the plan records for token `id`, if it writes the synced record. */
function recordedLook(plan: SyncPlan, id: string): unknown {
  const write = plan.update.find(
    (u) => u.id === id && u.key === SYNCED_METADATA_KEY,
  );
  return write === undefined
    ? undefined
    : (write.value as Record<string, unknown>)[LOOK_BASELINE_KEY];
}

const changedNote =
  "Dire Wolf 1's token was redrawn for its new monster type at the agent's request; its art or size had been changed on the table, and was overwritten.";
const maybeChangedNote =
  "Dire Wolf 1's token was redrawn for its new monster type at the agent's request; its art or size may have been changed on the table, and was overwritten.";

describe("planSync token look", () => {
  it("planSync redraws an image token of an instance in restyles with the new type's art, a grid spanning the new footprint and scale 1, and records the new look", () => {
    const plan = planSync(
      [direWolf(1)],
      [imageToken(1)],
      config,
      ctx({
        restyles: ["i1"],
      }),
    );

    expect(plan.restyle).toEqual([
      {
        id: "token-1",
        patch: {
          image: direWolfImage,
          grid: direWolfGrid,
          scale: { x: 1, y: 1 },
        },
      },
    ]);
    expect(recordedLook(plan, "token-1")).toEqual({
      monsterKey: "dire-wolf",
      image: direWolfArt.url,
    });
    expect(plan.needsArt).toEqual([]);
    expect(plan.overrides).toEqual([]);
  });

  it("planSync redraws an image token whose new type has no art with its own picture at the new footprint and lists the type in needsArt", () => {
    const plan = planSync(
      [direWolf(1), direWolf(2)],
      [imageToken(1), imageToken(2)],
      config,
      ctx({ restyles: ["i1", "i2"], art: { wolf: wolfArt } }),
    );

    // The wolf picture, its longer side over 2 cells.
    const ownPicture = {
      image: wolfImage,
      grid: { dpi: 150, offset: { x: 150, y: 150 } },
      scale: { x: 1, y: 1 },
    };
    expect(plan.restyle).toEqual([
      { id: "token-1", patch: ownPicture },
      { id: "token-2", patch: ownPicture },
    ]);
    expect(plan.needsArt).toEqual(["dire-wolf"]);
    expect(recordedLook(plan, "token-1")).toEqual({
      monsterKey: "dire-wolf",
      image: wolfArt.url,
    });
  });

  it("planSync resizes a circle token to the new footprint and keeps it a circle", () => {
    const plan = planSync(
      [direWolf(1)],
      [circleToken(1)],
      config,
      ctx({
        restyles: ["i1"],
      }),
    );

    expect(plan.restyle).toEqual([
      {
        id: "token-1",
        patch: {
          shape: { shapeType: "CIRCLE", width: 300, height: 300 },
          scale: { x: 1, y: 1 },
        },
      },
    ]);
    expect(recordedLook(plan, "token-1")).toEqual({
      monsterKey: "dire-wolf",
      image: null,
    });
    expect(plan.needsArt).toEqual([]);
    expect(plan.overrides).toEqual([]);
  });

  it("planSync redraws a token whose recorded look names another monster type without a restyles entry", () => {
    const plan = planSync([direWolf(1)], [imageToken(1)], config, ctx());

    expect(plan.restyle).toEqual([
      {
        id: "token-1",
        patch: {
          image: direWolfImage,
          grid: direWolfGrid,
          scale: { x: 1, y: 1 },
        },
      },
    ]);
    expect(recordedLook(plan, "token-1")).toEqual({
      monsterKey: "dire-wolf",
      image: direWolfArt.url,
    });
  });

  it("planSync never redraws a token with no recorded look unless its instance is in restyles", () => {
    const token = imageToken(1, { look: null });

    const quiet = planSync([direWolf(1)], [token], config, ctx());
    expect(quiet.restyle).toEqual([]);
    expect(quiet.overrides).toEqual([]);
    expect(recordedLook(quiet, "token-1")).toBeUndefined();

    const named = planSync(
      [direWolf(1)],
      [token],
      config,
      ctx({
        restyles: ["i1"],
      }),
    );
    expect(named.restyle.map((r) => r.id)).toEqual(["token-1"]);
    expect(recordedLook(named, "token-1")).toEqual({
      monsterKey: "dire-wolf",
      image: direWolfArt.url,
    });
  });

  it("planSync records the look a new token is created with", () => {
    const plan = planSync(
      [
        direWolf(1),
        makeTestInstance({
          id: "i2",
          monsterKey: "ghoul",
          displayName: "Ghoul 1",
        }),
      ],
      [],
      config,
      ctx({ placed: [] }),
    );

    const synced = (n: number) =>
      plan.add.find(
        (item) =>
          (item.metadata[INSTANCE_METADATA_KEY] as { instanceId: string })
            .instanceId === `i${n}`,
      )?.metadata[SYNCED_METADATA_KEY] as Record<string, unknown> | undefined;
    expect(synced(1)?.[LOOK_BASELINE_KEY]).toEqual({
      monsterKey: "dire-wolf",
      image: direWolfArt.url,
    });
    // No art: a circle.
    expect(synced(2)?.[LOOK_BASELINE_KEY]).toEqual({
      monsterKey: "ghoul",
      image: null,
    });
  });

  it("planSync plans no redraw and no note for a token already drawn as the target, and records the look", () => {
    const token = imageToken(1, {
      image: direWolfImage,
      grid: direWolfGrid,
      // A token without a scale counts as scale 1.
      scale: null,
    });

    const plan = planSync(
      [direWolf(1)],
      [token],
      config,
      ctx({
        restyles: ["i1"],
      }),
    );

    expect(plan.restyle).toEqual([]);
    expect(plan.overrides).toEqual([]);
    expect(recordedLook(plan, "token-1")).toEqual({
      monsterKey: "dire-wolf",
      image: direWolfArt.url,
    });
  });

  it("planSync lists a redraw in overrides when the token's picture differs from its recorded one, its scale is not 1, or it has no recorded look, and not otherwise", () => {
    const notesFor = (token: SceneItem) =>
      planSync([direWolf(1)], [token], config, ctx({ restyles: ["i1"] }))
        .overrides;

    // The GM gave the token other art.
    expect(
      notesFor(
        imageToken(1, {
          image: {
            ...wolfImage,
            url: "https://cdn.owlbear.rodeo/assets/mine.png",
          },
        }),
      ),
    ).toEqual([{ instanceId: "i1", message: changedNote }]);
    // The GM resized the token.
    expect(notesFor(imageToken(1, { scale: { x: 2, y: 2 } }))).toEqual([
      { instanceId: "i1", message: changedNote },
    ]);
    // A token drawn before looks were recorded.
    expect(notesFor(imageToken(1, { look: null }))).toEqual([
      { instanceId: "i1", message: maybeChangedNote },
    ]);
    // As it was last drawn: no note.
    expect(notesFor(imageToken(1))).toEqual([]);
    expect(notesFor(circleToken(1))).toEqual([]);
  });
});
