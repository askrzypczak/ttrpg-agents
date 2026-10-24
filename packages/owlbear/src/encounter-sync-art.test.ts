import { describe, expect, it } from "vitest";
import type { TokenArt } from "@ttrpg-agents/engine";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr, type FakePick } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import type { SceneItem } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  instanceIdOf,
  type EncounterInstance,
} from "./sync-plan.js";

const inst = (n: number, monsterKey = "shadow"): EncounterInstance => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey,
  displayName: `${monsterKey} ${n}`,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: n,
  footprint: 1,
  statsVisible: false,
});

const snapshot = (
  instances: EncounterInstance[],
  art?: Record<string, TokenArt>,
): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload:
    art === undefined ? { instances, seq: 0 } : { instances, art, seq: 0 },
});

const artFor = (name: string): TokenArt => ({
  url: `https://cdn.owlbear.rodeo/assets/${name}.png`,
  mime: "image/png",
  width: 300,
  height: 280,
});
const shadowArt = artFor("shadow");
const ghoulArt = artFor("ghoul");

/** Our existing hidden circle for instance `n`, as we wrote it. */
const circleToken = (n: number, monsterKey = "shadow"): SceneItem => ({
  id: `token-${n}`,
  type: "SHAPE",
  name: `${monsterKey} ${n}`,
  visible: false,
  position: { x: 0, y: 0 },
  layer: "CHARACTER",
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
  metadata: {
    [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
    [SYNCED_METADATA_KEY]: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [NAME_BASELINE_KEY]: `${monsterKey} ${n}`,
    },
  },
});

/** Timers that never fire, so a failed reconcile is not retried behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

function setup(pickImage?: FakePick) {
  const fake = createFakeObr(undefined, undefined, { pickImage });
  const errors: unknown[] = [];
  const reported: [string, TokenArt][] = [];
  const sync = createEncounterSync(
    fake.obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      onTokenArt: (monsterKey, art) => reported.push([monsterKey, art]),
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  return { fake, sync, errors, reported, tokenOf };
}

const hiddenCircle = {
  type: "SHAPE",
  layer: "CHARACTER",
  visible: false,
  shape: { shapeType: "CIRCLE" },
};

describe("createEncounterSync token art", () => {
  it("prompts once for a monster type and makes image tokens for all its instances", async () => {
    const { fake, sync, errors, tokenOf } = setup(shadowArt);

    await sync.handleMessage(snapshot([inst(1), inst(2), inst(3)]));

    expect(fake.pickImageCalls()).toBe(1);
    for (const id of ["i1", "i2", "i3"])
      expect(tokenOf(id)).toMatchObject({
        type: "IMAGE",
        layer: "CHARACTER",
        visible: false,
        image: shadowArt,
        grid: { dpi: 300, offset: { x: 150, y: 140 } },
      });
    expect(errors).toEqual([]);
  });

  it("prompts once per monster type when several types are new", async () => {
    const picks = [artFor("first"), artFor("second")];
    let open = 0;
    let mostOpen = 0;
    const { fake, sync, errors, reported, tokenOf } = setup(async () => {
      open++;
      mostOpen = Math.max(mostOpen, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open--;
      return picks.shift();
    });
    const instances = [inst(1), inst(2, "ghoul"), inst(3), inst(4, "ghoul")];

    await sync.handleMessage(snapshot(instances));

    expect(fake.pickImageCalls()).toBe(2);
    expect(mostOpen).toBe(1);
    const byKey = new Map(reported);
    expect([...byKey.keys()].sort()).toEqual(["ghoul", "shadow"]);
    expect(byKey.get("ghoul")).not.toEqual(byKey.get("shadow"));
    for (const instance of instances)
      expect(tokenOf(instance.id)).toMatchObject({
        type: "IMAGE",
        image: byKey.get(instance.monsterKey),
      });
    expect(errors).toEqual([]);
  });

  it("reports the picked art through onTokenArt", async () => {
    const { sync, reported } = setup(shadowArt);

    await sync.handleMessage(snapshot([inst(1), inst(2)]));

    expect(reported).toEqual([["shadow", shadowArt]]);
  });

  it("does not prompt when the snapshot already has art for the type", async () => {
    const { fake, sync, reported, tokenOf } = setup(ghoulArt);

    await sync.handleMessage(
      snapshot([inst(1), inst(2)], { shadow: shadowArt }),
    );

    expect(fake.pickImageCalls()).toBe(0);
    expect(reported).toEqual([]);
    for (const id of ["i1", "i2"])
      expect(tokenOf(id)).toMatchObject({
        type: "IMAGE",
        image: shadowArt,
        grid: { dpi: 300, offset: { x: 150, y: 140 } },
      });
  });

  it("does not prompt for an instance that already has a token", async () => {
    const { fake, sync, reported, tokenOf } = setup(ghoulArt);
    fake.scene.addItems([circleToken(1)]);

    await sync.handleMessage(snapshot([inst(1), inst(2, "ghoul")]));

    // Only the ghoul, which gets a new token, is asked for.
    expect(fake.pickImageCalls()).toBe(1);
    expect(reported).toEqual([["ghoul", ghoulArt]]);
    expect(tokenOf("i1")).toMatchObject({ id: "token-1", ...hiddenCircle });
    expect(tokenOf("i2")).toMatchObject({
      type: "IMAGE",
      image: ghoulArt,
    });
  });

  it("creates the circle and does not prompt again this session after a cancelled pick", async () => {
    const { fake, sync, errors, reported, tokenOf } = setup(undefined);

    await sync.handleMessage(snapshot([inst(1)]));

    expect(fake.pickImageCalls()).toBe(1);
    expect(tokenOf("i1")).toMatchObject(hiddenCircle);

    // A later snapshot with a new shadow does not ask again.
    await sync.handleMessage(snapshot([inst(1), inst(2)]));

    expect(fake.pickImageCalls()).toBe(1);
    expect(tokenOf("i2")).toMatchObject(hiddenCircle);
    expect(reported).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("creates the circle without a sync error after a picker error", async () => {
    const { fake, sync, errors, reported, tokenOf } = setup(() =>
      Promise.reject(new Error("the picker failed to open")),
    );

    await sync.handleMessage(snapshot([inst(1)]));

    expect(fake.pickImageCalls()).toBe(1);
    expect(tokenOf("i1")).toMatchObject(hiddenCircle);
    expect(reported).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("creates the circle when the picked art fails validation", async () => {
    const notHttps = {
      ...shadowArt,
      url: "http://cdn.example.test/shadow.png",
    };
    const { fake, sync, errors, reported, tokenOf } = setup(notHttps);

    await sync.handleMessage(snapshot([inst(1)]));

    expect(fake.pickImageCalls()).toBe(1);
    expect(tokenOf("i1")).toMatchObject(hiddenCircle);
    expect(tokenOf("i1")!.image).toBeUndefined();
    expect(reported).toEqual([]);
    expect(errors).toEqual([]);
  });
});
