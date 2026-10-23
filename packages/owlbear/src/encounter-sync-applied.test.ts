import { describe, expect, it } from "vitest";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";

const inst = (n: number) => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: `Shadow ${n}`,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: n,
});

describe("appliedInstanceCount", () => {
  it("an hp-changed event leaves the count unchanged", async () => {
    const { obr } = createFakeObr();
    const sync = createEncounterSync(obr);
    await sync.handleMessage({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: [inst(1), inst(2)] },
    });
    await sync.handleMessage({
      v: 1,
      type: "encounter-event",
      payload: { type: "hp-changed", id: "i1", currentHp: 3, maxHp: 16 },
    });
    expect(sync.appliedInstanceCount()).toBe(2);
  });
});
