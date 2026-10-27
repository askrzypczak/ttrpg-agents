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
  reskinOverrideNote,
  reskinReplaceNote,
  type EncounterInstance,
  type SyncConfig,
} from "./sync-plan.js";

const SHA = "c3".repeat(32);

/** The wolf art the GM picked after re-uploading its stored bytes. */
const reuploaded: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-c3c3c3c3c3c3c3c3.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: SHA,
};

const reuploadedImage = {
  url: reuploaded.url,
  mime: reuploaded.mime,
  width: reuploaded.width,
  height: reuploaded.height,
};
/** One cell, image centred. */
const reuploadedGrid = { dpi: 300, offset: { x: 150, y: 140 } };

/** The wolf art whose Owlbear asset is gone. */
const goneImage = {
  url: "https://cdn.owlbear.rodeo/assets/wolf-gone.png",
  mime: "image/png",
  width: 200,
  height: 200,
};
const goneGrid = { dpi: 200, offset: { x: 100, y: 100 } };

const HP_KEY = "test/hp";
const OTHER_KEY = "other.extension/note";

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

const wolf = (n: number): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    monsterKey: "wolf",
    displayName: `Wolf ${n}`,
    createdAt: n,
    footprint: 1,
    currentHp: 11,
  });

const position: Vec2 = { x: 450, y: 300 };

/** The synced record of a wolf token for instance `n` drawn with `image`. */
const record = (n: number, image: string | null): Record<string, unknown> => ({
  [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
  [HP_KEY]: 11,
  [NAME_BASELINE_KEY]: `Wolf ${n}`,
  [LOOK_BASELINE_KEY]: { monsterKey: "wolf", image },
});

/** A 1-cell circle token for instance `n`, drawn while its type had no usable art. */
const circleToken = (n: number, over: Partial<SceneItem> = {}): SceneItem => ({
  id: `token-${n}`,
  type: "SHAPE",
  name: `Wolf ${n}`,
  visible: false,
  position: { ...position },
  layer: "CHARACTER",
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
  scale: { x: 1, y: 1 },
  metadata: {
    [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
    [HP_KEY]: 11,
    [SYNCED_METADATA_KEY]: record(n, null),
  },
  ...over,
});

/** An image token for instance `n`, drawn with `image` and recorded as drawn with `recorded`. */
const imageToken = (
  n: number,
  image: typeof goneImage,
  grid: typeof goneGrid,
  recorded: string | null | undefined,
  over: Partial<SceneItem> = {},
): SceneItem => {
  const synced = record(n, recorded ?? null);
  if (recorded === undefined) delete synced[LOOK_BASELINE_KEY];
  return {
    id: `token-${n}`,
    type: "IMAGE",
    name: `Wolf ${n}`,
    visible: false,
    position: { ...position },
    layer: "CHARACTER",
    image,
    grid,
    scale: { x: 1, y: 1 },
    metadata: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [HP_KEY]: 11,
      [SYNCED_METADATA_KEY]: synced,
    },
    ...over,
  };
};

const ctx = (reskins: string[]) => ({
  viewportCenter: { x: 1000, y: 500 },
  placed: new Set(["i1", "i2", "i3", "i4"]),
  art: { wolf: reuploaded },
  reskins: new Set(reskins),
});

describe("planSync re-skin with re-uploaded art", () => {
  it("a reskinned circle whose type now has art is replaced with an image token carrying its name, position, visibility and metadata, with the re-skin replacement note", () => {
    const token = circleToken(1, { visible: true });
    token.metadata[OTHER_KEY] = { keep: [1, 2] };

    const plan = planSync([wolf(1)], [token], config, ctx(["i1"]));

    expect(plan.replace).toHaveLength(1);
    expect(plan.replace[0]?.id).toBe("token-1");
    const item = plan.replace[0]?.item;
    expect(item).toMatchObject({
      type: "IMAGE",
      image: reuploadedImage,
      grid: reuploadedGrid,
      name: "Wolf 1",
      position,
      visible: true,
    });
    expect(item?.shape).toBeUndefined();
    expect(item?.metadata[INSTANCE_METADATA_KEY]).toEqual({ instanceId: "i1" });
    expect(item?.metadata[HP_KEY]).toBe(11);
    expect(item?.metadata[OTHER_KEY]).toEqual({ keep: [1, 2] });
    expect(
      (item?.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
        LOOK_BASELINE_KEY
      ],
    ).toEqual({ monsterKey: "wolf", image: reuploaded.url });
    expect(plan.overrides).toEqual([
      {
        instanceId: "i1",
        message:
          "Wolf 1's token was replaced with a new one drawn with the art uploaded for its monster type; any attachments on the old token were deleted with it.",
      },
    ]);
    expect(reskinReplaceNote("Wolf 1")).toBe(plan.overrides[0]?.message);
    expect(plan.add).toEqual([]);
    expect(plan.needsArt).toEqual([]);
  });

  it("a reskinned image token is redrawn in place with the type's art at scale 1, with a note only when its art or size had been changed on the table", () => {
    const tokens = [
      // Drawn with the gone art, as recorded: no note.
      imageToken(1, goneImage, goneGrid, goneImage.url),
      // Its art changed on the table since it was drawn.
      imageToken(
        2,
        { ...goneImage, url: "https://example.test/gm-art.png" },
        goneGrid,
        goneImage.url,
      ),
      // Resized on the table.
      imageToken(3, goneImage, goneGrid, goneImage.url, {
        scale: { x: 2, y: 2 },
      }),
      // No recorded look.
      imageToken(4, goneImage, goneGrid, undefined),
    ];

    const plan = planSync(
      [wolf(1), wolf(2), wolf(3), wolf(4)],
      tokens,
      config,
      ctx(["i1", "i2", "i3", "i4"]),
    );

    expect(plan.replace).toEqual([]);
    expect(plan.restyle.map((r) => r.id)).toEqual([
      "token-1",
      "token-2",
      "token-3",
      "token-4",
    ]);
    for (const { patch } of plan.restyle) {
      expect(patch.image).toEqual(reuploadedImage);
      expect(patch.grid).toEqual(reuploadedGrid);
      expect(patch.scale ?? { x: 1, y: 1 }).toEqual({ x: 1, y: 1 });
    }
    const changed =
      "Wolf 2's token was redrawn with the art uploaded for its monster type; its art or size had been changed on the table, and was overwritten.";
    const resized =
      "Wolf 3's token was redrawn with the art uploaded for its monster type; its art or size had been changed on the table, and was overwritten.";
    const unrecorded =
      "Wolf 4's token was redrawn with the art uploaded for its monster type; its art or size may have been changed on the table, and was overwritten.";
    expect(plan.overrides).toEqual([
      { instanceId: "i2", message: changed },
      { instanceId: "i3", message: resized },
      { instanceId: "i4", message: unrecorded },
    ]);
    expect(reskinOverrideNote("Wolf 2", true)).toBe(changed);
    expect(reskinOverrideNote("Wolf 4", false)).toBe(unrecorded);
    // Each redrawn token records the look it is now drawn with.
    for (const n of [1, 2, 3, 4]) {
      const update = plan.update.find(
        (u) => u.id === `token-${n}` && u.key === SYNCED_METADATA_KEY,
      );
      expect(
        (update?.value as Record<string, unknown> | undefined)?.[
          LOOK_BASELINE_KEY
        ],
        `token-${n}`,
      ).toEqual({ monsterKey: "wolf", image: reuploaded.url });
    }
  });

  it("a reskinned token already drawn with the type's art is not written", () => {
    const drawn = imageToken(
      1,
      reuploadedImage,
      reuploadedGrid,
      reuploaded.url,
    );
    // Beside it, a token still drawn with the gone art.
    const stale = imageToken(2, goneImage, goneGrid, goneImage.url);

    const plan = planSync(
      [wolf(1), wolf(2)],
      [drawn, stale],
      config,
      ctx(["i1", "i2"]),
    );

    expect(plan.restyle.map((r) => r.id)).toEqual(["token-2"]);
    expect(plan.replace).toEqual([]);
    expect(plan.update.filter((u) => u.id === "token-1")).toEqual([]);
    expect(plan.overrides.filter((o) => o.instanceId === "i1")).toEqual([]);
  });
});
