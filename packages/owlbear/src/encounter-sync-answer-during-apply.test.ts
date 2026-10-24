import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { INSTANCE_METADATA_KEY, type EncounterInstance } from "./sync-plan.js";

const inst = (currentHp: number): EncounterInstance =>
  makeTestInstance({
    id: "i1",
    displayName: "Goblin 2",
    maxHp: 16,
    currentHp,
    armorClass: 12,
  });

const snapshot = (
  instance: EncounterInstance,
  cause?: string,
): BridgeMessage => ({
  v: 1,
  type: "encounter-snapshot",
  payload: { instances: [instance], ...(cause ? { cause } : {}) },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("createEncounterSync with an answer arriving during a reconcile", () => {
  it("an answer that arrives while the previous one is being applied is still applied", async () => {
    const { obr, scene } = createFakeObr();
    let gate: Promise<void> | undefined;
    let reached: (() => void) | undefined;
    const held = {
      ...obr,
      getItems: async (): Promise<SceneItem[]> => {
        if (gate) {
          const wait = gate;
          gate = undefined;
          reached?.();
          await wait;
        }
        return obr.getItems();
      },
    };
    const sync = createEncounterSync(held);
    await sync.handleMessage(snapshot(inst(10)));
    await settle();
    const tokenId = scene
      .getItems()
      .find((i) => INSTANCE_METADATA_KEY in i.metadata)!.id;
    const bubbles = () =>
      scene.getItems().find((i) => i.id === tokenId)!.metadata[
        STAT_BUBBLES_METADATA_KEY
      ] as Record<string, unknown>;
    scene.setItemMetadata([
      {
        id: tokenId,
        key: STAT_BUBBLES_METADATA_KEY,
        value: { ...bubbles(), health: 99 },
      },
    ]);
    await settle();

    // The first answer's reconcile stops at getItems; a second answer lands then.
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    const hit = new Promise<void>((resolve) => (reached = resolve));
    const first = sync.handleMessage(snapshot(inst(16), "instance-edit:i1"));
    await hit;
    const second = sync.handleMessage(snapshot(inst(12), "instance-edit:i1"));
    release();
    await Promise.all([first, second]);
    await settle();

    expect(bubbles().health).toBe(99);
  });
});
