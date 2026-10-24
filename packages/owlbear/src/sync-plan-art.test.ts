import { describe, expect, it } from "vitest";
import type { TokenArt } from "@ttrpg-agents/engine";
import type { SceneItem } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  instanceIdOf,
  planSync,
  type EncounterInstance,
} from "./sync-plan.js";

const inst = (
  n: number,
  monsterKey = "shadow",
  displayName = `Shadow ${n}`,
  footprint = 1,
): EncounterInstance => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey,
  displayName,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: n,
  footprint,
});

const shadowArt: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

const ghoulArt: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ghoul.webp",
  mime: "image/webp",
  width: 512,
  height: 512,
};

const center = { x: 1000, y: 500 };
const ctx = (art: Record<string, TokenArt> = {}, placed: string[] = []) => ({
  viewportCenter: center,
  placed: new Set(placed),
  art,
});

/** Our existing hidden circle for instance `n`, as we wrote it. */
const circleToken = (n: number): SceneItem => ({
  id: `token-${n}`,
  type: "SHAPE",
  name: `Shadow ${n}`,
  visible: false,
  position: { x: 0, y: 0 },
  layer: "CHARACTER",
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
  metadata: {
    [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
    [SYNCED_METADATA_KEY]: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [NAME_BASELINE_KEY]: `Shadow ${n}`,
    },
  },
});

const addedFor = (items: SceneItem[], instanceId: string) =>
  items.find((item) => instanceIdOf(item) === instanceId);

describe("planSync needsArt", () => {
  it("needsArt lists a monster type without art whose instance gets a token", () => {
    const plan = planSync(
      [inst(1), inst(2, "ghoul", "Ghoul 2")],
      [],
      defaultSyncConfig,
      ctx({ ghoul: ghoulArt }),
    );
    expect(plan.needsArt).toEqual(["shadow"]);
  });

  it("needsArt lists a monster type once for several instances", () => {
    const plan = planSync(
      [inst(1), inst(2), inst(3, "ghoul", "Ghoul 3"), inst(4)],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect([...plan.needsArt].sort()).toEqual(["ghoul", "shadow"]);
  });

  it("needsArt skips an instance that already has a token", () => {
    const plan = planSync(
      [inst(1), inst(2, "ghoul", "Ghoul 2")],
      [circleToken(1)],
      defaultSyncConfig,
      ctx({}, ["i1"]),
    );
    expect(plan.needsArt).toEqual(["ghoul"]);
  });

  it("needsArt skips an instance already placed whose token was deleted", () => {
    const plan = planSync(
      [inst(1), inst(2, "ghoul", "Ghoul 2")],
      [],
      defaultSyncConfig,
      ctx({}, ["i1"]),
    );
    expect(plan.deleted).toEqual(["i1"]);
    expect(plan.needsArt).toEqual(["ghoul"]);
  });
});

describe("planSync token art", () => {
  it("creates a hidden image token from the stored art", () => {
    const plan = planSync(
      [inst(1)],
      [],
      defaultSyncConfig,
      ctx({ shadow: shadowArt }),
    );
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]).toMatchObject({
      type: "IMAGE",
      layer: "CHARACTER",
      image: shadowArt,
      grid: { dpi: 300, offset: { x: 150, y: 140 } },
      name: "Shadow 1",
      visible: false,
      position: center,
    });
    expect(plan.add[0]!.shape).toBeUndefined();
    expect(plan.needsArt).toEqual([]);
  });

  it("creates the hidden circle for a type without art", () => {
    const plan = planSync(
      [inst(1), inst(2, "ghoul", "Ghoul 2")],
      [],
      defaultSyncConfig,
      ctx({ ghoul: ghoulArt }),
    );
    const shadow = addedFor(plan.add, "i1");
    expect(shadow).toMatchObject({
      type: "SHAPE",
      layer: "CHARACTER",
      shape: { shapeType: "CIRCLE" },
      visible: false,
    });
    expect(shadow!.image).toBeUndefined();
    // Control: the ghoul's art is used for the ghoul only.
    expect(addedFor(plan.add, "i2")).toMatchObject({
      type: "IMAGE",
      image: ghoulArt,
      grid: { dpi: 512, offset: { x: 256, y: 256 } },
    });
  });

  it("does not re-skin an existing token when art appears later", () => {
    const plan = planSync(
      [inst(1), inst(2)],
      [circleToken(1)],
      defaultSyncConfig,
      ctx({ shadow: shadowArt }, ["i1"]),
    );
    expect(plan.delete).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.add.map(instanceIdOf)).toEqual(["i2"]);
    // Control: the art is in effect for the instance that gets a new token.
    expect(plan.add[0]).toMatchObject({
      type: "IMAGE",
      image: shadowArt,
    });
  });
});

describe("planSync token art sizing", () => {
  it.each([
    ["wide", 600, 300, { dpi: 600, offset: { x: 300, y: 150 } }],
    ["tall", 300, 600, { dpi: 600, offset: { x: 150, y: 300 } }],
  ])(
    "sizes a token art image to one grid cell with the image centred (%s)",
    (_shape, width, height, grid) => {
      const art: TokenArt = { ...shadowArt, width, height };
      const plan = planSync(
        [inst(1)],
        [],
        defaultSyncConfig,
        ctx({ shadow: art }),
      );
      expect(plan.add[0]).toMatchObject({ type: "IMAGE", image: art, grid });
    },
  );
});

describe("planSync token footprint", () => {
  it.each([1, 2, 3, 4])(
    "a new image token spans its instance's footprint, centred (footprint %i)",
    (cells) => {
      const plan = planSync(
        [inst(1, "shadow", "Shadow 1", cells)],
        [],
        defaultSyncConfig,
        ctx({ shadow: shadowArt }),
      );
      // shadowArt is 300 x 280: the longer side spans `cells` grid cells.
      expect(plan.add[0]).toMatchObject({
        type: "IMAGE",
        image: shadowArt,
        grid: { dpi: 300 / cells, offset: { x: 150, y: 140 } },
        position: center,
      });
    },
  );

  it("a new hidden circle is footprint times the base token size", () => {
    const plan = planSync(
      [inst(1, "shadow", "Shadow 1", 3), inst(2, "ghoul", "Ghoul 2", 2)],
      [],
      defaultSyncConfig,
      ctx(),
    );
    expect(addedFor(plan.add, "i1")).toMatchObject({
      type: "SHAPE",
      shape: { shapeType: "CIRCLE", width: 450, height: 450 },
      visible: false,
    });
    expect(addedFor(plan.add, "i2")).toMatchObject({
      type: "SHAPE",
      shape: { shapeType: "CIRCLE", width: 300, height: 300 },
    });
  });

  it("a token already on the scene is not resized when the instance footprint differs", () => {
    const existing = circleToken(1);
    const plan = planSync(
      [inst(1, "shadow", "Shadow 1", 3), inst(2, "shadow", "Shadow 2", 3)],
      [existing],
      defaultSyncConfig,
      ctx({}, ["i1"]),
    );
    expect(plan.delete).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.rename).toEqual([]);
    expect(addedFor(plan.add, "i1")).toBeUndefined();
    // Control: a new token for the same footprint is created at full size.
    expect(addedFor(plan.add, "i2")).toMatchObject({
      shape: { shapeType: "CIRCLE", width: 450, height: 450 },
    });
  });
});
