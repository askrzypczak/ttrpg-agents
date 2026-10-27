import { describe, expect, it } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  LOOK_BASELINE_KEY,
  NAME_BASELINE_KEY,
  REPLACED_BY_KEY,
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  replaceOverrideNote,
  reskinReplaceNote,
  restyleOverrideNote,
  type EncounterInstance,
  type SyncConfig,
} from "./sync-plan.js";

/** The wolf art the GM picked after re-uploading its stored bytes. */
const wolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-c3c3c3c3c3c3c3c3.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: "c3".repeat(32),
};
const wolfImage = {
  url: wolfArt.url,
  mime: wolfArt.mime,
  width: wolfArt.width,
  height: wolfArt.height,
};
/** One cell, image centred. */
const wolfGrid = { dpi: 300, offset: { x: 150, y: 140 } };

/** The art of the monster type the instance had before. */
const dogImage = {
  url: "https://cdn.owlbear.rodeo/assets/dog.png",
  mime: "image/png",
  width: 200,
  height: 200,
};
const dogGrid = { dpi: 200, offset: { x: 100, y: 100 } };

/** The link projector and the default token look. */
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

const wolf = (n: number): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    monsterKey: "wolf",
    displayName: `Wolf ${n}`,
    createdAt: n,
    footprint: 1,
  });

/** A token linked to instance `n`, with its synced record. */
const token = (
  n: number,
  id: string,
  look: Partial<SceneItem>,
  record: Record<string, unknown>,
): SceneItem => ({
  id,
  type: "SHAPE",
  name: `Wolf ${n}`,
  visible: false,
  position: { x: 450, y: 300 },
  layer: "CHARACTER",
  scale: { x: 1, y: 1 },
  ...look,
  metadata: {
    [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
    [SYNCED_METADATA_KEY]: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [NAME_BASELINE_KEY]: `Wolf ${n}`,
      ...record,
    },
  },
});

const circle: Partial<SceneItem> = {
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
};

const ctx = (ids: { reskins: string[]; restyles?: string[] }) => ({
  viewportCenter: { x: 1000, y: 500 },
  placed: new Set(["i1", "i2"]),
  art: { wolf: wolfArt },
  reskins: new Set(ids.reskins),
  restyles: new Set(ids.restyles ?? []),
});

describe("planSync re-skin notes", () => {
  it("a half-done re-skin replacement is finished with the re-skin replacement note", () => {
    // The circle was marked and its image replacement added; its delete failed.
    const tokens = (): SceneItem[] => [
      token(1, "token-1", circle, {
        [LOOK_BASELINE_KEY]: { monsterKey: "wolf", image: null },
        [REPLACED_BY_KEY]: "token-1-r2",
      }),
      token(
        1,
        "token-1-r2",
        { type: "IMAGE", image: wolfImage, grid: wolfGrid },
        { [LOOK_BASELINE_KEY]: { monsterKey: "wolf", image: wolfArt.url } },
      ),
    ];

    const plan = planSync(
      [wolf(1)],
      tokens(),
      config,
      ctx({ reskins: ["i1"] }),
    );

    expect(plan.delete).toEqual(["token-1"]);
    expect(plan.replace).toEqual([]);
    expect(plan.restyle).toEqual([]);
    expect(plan.overrides).toEqual([
      { instanceId: "i1", message: reskinReplaceNote("Wolf 1") },
    ]);

    // Control: with a monster change of the instance too, the monster change
    // note is used.
    const changed = planSync(
      [wolf(1)],
      tokens(),
      config,
      ctx({ reskins: ["i1"], restyles: ["i1"] }),
    );
    expect(changed.delete).toEqual(["token-1"]);
    expect(changed.overrides).toEqual([
      { instanceId: "i1", message: replaceOverrideNote("Wolf 1") },
    ]);
  });

  it("an instance both re-skinned and changed to another monster type gets the monster change notes, not the re-skin ones", () => {
    const dogLook = { monsterKey: "dog", image: dogImage.url };
    const tokens = [
      // Drawn as a dog, its art then changed on the table: redrawn in place.
      token(
        1,
        "token-1",
        {
          type: "IMAGE",
          image: { ...dogImage, url: "https://example.test/gm-art.png" },
          grid: dogGrid,
        },
        { [LOOK_BASELINE_KEY]: dogLook },
      ),
      // A circle: replaced with an image token.
      token(2, "token-2", circle, {
        [LOOK_BASELINE_KEY]: { monsterKey: "dog", image: null },
      }),
    ];

    const plan = planSync(
      [wolf(1), wolf(2)],
      tokens,
      config,
      ctx({ reskins: ["i1", "i2"], restyles: ["i1", "i2"] }),
    );

    expect(plan.restyle.map((r) => r.id)).toEqual(["token-1"]);
    expect(plan.replace.map((r) => r.id)).toEqual(["token-2"]);
    expect(plan.overrides).toEqual([
      { instanceId: "i1", message: restyleOverrideNote("Wolf 1", true) },
      { instanceId: "i2", message: replaceOverrideNote("Wolf 2") },
    ]);
  });
});
