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
    maxHp: 10,
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

/** Plans the answer to a write-back, where the store's snapshot is also the desired state. */
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

describe("planSync with an answer that differs from the table in another field", () => {
  it("an answer that carries an MCP change to another field pushes it and plans no edit", () => {
    const token = editedToken(inst(), { "armor class": 15 });
    // The MCP dealt damage before the bridge applied the armor class edit.
    const answer = inst({ currentHp: 3, armorClass: 15 });

    const p = planAnswer(token, answer, { armorClass: 15 });

    const writes = bubbleWrites(p);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value).toMatchObject({
      health: 3,
      "armor class": 15,
    });
    expect(p.edits).toEqual([]);
    expect(p.differs).toEqual([]);
    expect(p.sent.i1?.[STAT_BUBBLES_METADATA_KEY]).toBeUndefined();
  });

  it("an answer is still adopted when the only differing field was sent", () => {
    const token = editedToken(inst(), { health: 15 });

    const p = planAnswer(token, inst(), { currentHp: 15 });

    expect(bubbleWrites(p)).toEqual([]);
    expect(p.edits).toEqual([]);
    expect(p.differs).toEqual([
      { instanceId: "i1", message: expect.any(String) },
    ]);
  });

  it("an answer is adopted and an unsent typed field is sent when the other differing field was sent", () => {
    // The token was made when the goblin had 12 HP; the store now has 10. The
    // GM typed 15 HP (sent) and also a max HP of 25 (not sent). The store's
    // move of HP cannot be told from a clamp, so the typed 15 stays.
    const token = editedToken(inst({ currentHp: 12, maxHp: 20 }), {
      health: 15,
      "max health": 25,
    });
    const answer = inst({ currentHp: 10, maxHp: 20 });

    const p = planAnswer(token, answer, { currentHp: 15 });

    expect(bubbleWrites(p)).toEqual([]);
    expect(p.edits).toEqual([{ instanceId: "i1", maxHp: 25 }]);
  });

  it("a store clamp of another field is pushed to the table", () => {
    const token = editedToken(inst({ currentHp: 8 }), { "max health": 5 });
    // The store lowered max HP to 5 as asked and clamped HP down with it.
    const answer = inst({ currentHp: 5, maxHp: 5 });

    const p = planAnswer(token, answer, { maxHp: 5 });

    const writes = bubbleWrites(p);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value).toMatchObject({ health: 5, "max health": 5 });
    expect(p.edits).toEqual([]);
    expect(p.differs).toEqual([]);
  });
});
