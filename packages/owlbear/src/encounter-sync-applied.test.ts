import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import { createMessageFeed } from "./testing/messages.js";

const inst = (n: number) =>
  makeTestInstance({ id: `i${n}`, displayName: `Shadow ${n}`, createdAt: n });

describe("appliedInstanceCount", () => {
  it("an hp-changed event leaves the count unchanged", async () => {
    const { obr } = createFakeObr();
    const sync = createEncounterSync(obr);
    const feed = createMessageFeed();
    await sync.handleMessage(feed.snapshot([inst(1), inst(2)]));
    await sync.handleMessage(
      feed.event({ type: "hp-changed", id: "i1", currentHp: 3, maxHp: 16 }),
    );
    expect(sync.appliedInstanceCount()).toBe(2);
  });
});
