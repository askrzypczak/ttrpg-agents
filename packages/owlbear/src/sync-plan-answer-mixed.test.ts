import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  defaultSyncConfig,
  planSync,
  type EditMemory,
  type EncounterInstance,
  type SyncPlan,
} from "./sync-plan.js";

const inst = (over: Partial<EncounterInstance> = {}): EncounterInstance =>
  makeTestInstance({
    id: "i1",
    displayName: "Goblin 2",
    maxHp: 20,
    currentHp: 10,
    armorClass: 12,
    ...over,
  });

/** A token created for `instance`, then edited at the table. */
function editedToken(
  instance: EncounterInstance,
  fields: Record<string, unknown>,
): SceneItem {
  const [created] = planSync([instance], [], defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(),
    art: {},
  }).add;
  const token = structuredClone(created!);
  token.metadata[STAT_BUBBLES_METADATA_KEY] = {
    ...(token.metadata[STAT_BUBBLES_METADATA_KEY] as object),
    ...fields,
  };
  return token;
}

function planAnswer(
  token: SceneItem,
  answer: EncounterInstance,
  sent: EditMemory[string][string],
): SyncPlan {
  return planSync([answer], [token], defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(["i1"]),
    art: {},
    answered: new Map([[answer.id, answer]]),
    sent: { i1: { [STAT_BUBBLES_METADATA_KEY]: sent } },
  });
}

const bubbleWrites = (p: SyncPlan) =>
  p.update.filter((u) => u.key === STAT_BUBBLES_METADATA_KEY);

describe("planSync with an answer whose differing fields disagree", () => {
  it("one field the store moved blocks adoption even when another is the GM's own", () => {
    // The MCP lowered HP (the token still shows the old 10) while the GM
    // typed an armor class that has not been sent yet.
    const token = editedToken(inst(), { "armor class": 15 });

    const p = planAnswer(token, inst({ currentHp: 3 }), {});

    const writes = bubbleWrites(p);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value).toMatchObject({
      health: 3,
      "armor class": 12,
    });
    expect(p.edits).toEqual([]);
  });

  it("a sent value that equals the old baseline is still the table's own", () => {
    const token = editedToken(inst(), {});

    const p = planAnswer(token, inst({ currentHp: 4 }), { currentHp: 10 });

    expect(bubbleWrites(p)).toEqual([]);
    expect(p.edits).toEqual([]);
  });
});
