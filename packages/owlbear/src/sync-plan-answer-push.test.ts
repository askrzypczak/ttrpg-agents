import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { defaultSyncConfig, planSync } from "./sync-plan.js";

const inst = (currentHp: number) =>
  makeTestInstance({
    id: "i1",
    displayName: "Goblin 2",
    maxHp: 30,
    currentHp,
    armorClass: 12,
  });

describe("planSync differs when the same plan pushes an MCP change", () => {
  it("reports no difference for a key the plan pushes to", () => {
    const context = {
      viewportCenter: { x: 0, y: 0 },
      placed: new Set<string>(),
      art: {},
    };
    const [created] = planSync([inst(10)], [], defaultSyncConfig, context).add;
    const token = structuredClone(created!);
    token.metadata[STAT_BUBBLES_METADATA_KEY] = {
      ...(token.metadata[STAT_BUBBLES_METADATA_KEY] as object),
      health: 25,
    };

    const plan = planSync([inst(5)], [token], defaultSyncConfig, {
      ...context,
      placed: new Set(["i1"]),
      answered: new Map([["i1", inst(20)]]),
      sent: { i1: { [STAT_BUBBLES_METADATA_KEY]: { currentHp: 25 } } },
    });

    const push = plan.update.find((u) => u.key === STAT_BUBBLES_METADATA_KEY);
    expect(push?.value).toMatchObject({ health: 5 });
    expect(plan.differs).toEqual([]);
  });
});
