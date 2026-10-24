import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import { defaultSyncConfig, planSync } from "./sync-plan.js";

const instance = makeTestInstance({
  id: "i1",
  displayName: "Shadow 1",
  maxHp: 16,
  currentHp: 10,
  armorClass: 12,
});

const ctx = {
  viewportCenter: { x: 0, y: 0 },
  placed: new Set<string>(),
  art: {},
};

describe("planSync write-back of mixed table edits", () => {
  it("planSync sends the valid fields and reports the unreadable ones of one edit", () => {
    const [created] = planSync([instance], [], defaultSyncConfig, ctx).add;
    const token = structuredClone(created!);
    token.metadata[STAT_BUBBLES_METADATA_KEY] = {
      ...(token.metadata[STAT_BUBBLES_METADATA_KEY] as object),
      health: 4,
      "max health": "many",
      "armor class": 1.5,
    };

    const p = planSync([instance], [token], defaultSyncConfig, {
      ...ctx,
      placed: new Set(["i1"]),
    });

    expect(p.edits).toEqual([{ instanceId: "i1", currentHp: 4 }]);
    expect(p.rejected).toEqual([
      {
        instanceId: "i1",
        message: "max health and armor class on Shadow 1 is not a whole number",
      },
    ]);
  });
});
