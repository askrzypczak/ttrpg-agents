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
    statsVisible: false,
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

describe("planSync with an answer and the hide field", () => {
  it("an answer that carries a statsVisible change is not adopted and its hide is pushed", () => {
    // The GM typed 15 HP (sent, then clamped to 10) while the MCP revealed
    // the stats; both arrive in the one answer.
    const token = editedToken(inst(), { health: 15 });
    const answer = inst({ currentHp: 10, statsVisible: true });

    const p = planAnswer(token, answer, { currentHp: 15 });

    const writes = bubbleWrites(p);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value).toMatchObject({ health: 10, hide: false });
    expect(p.edits).toEqual([]);
  });

  it("a GM's own hide toggle is still adopted when an answer arrives", () => {
    // The GM revealed the stats at the table and typed 15 HP (sent, then
    // clamped to 10); the store still has them hidden.
    const token = editedToken(inst(), { health: 15, hide: false });
    const answer = inst({ currentHp: 10 });

    const p = planAnswer(token, answer, { currentHp: 15 });

    expect(bubbleWrites(p)).toEqual([]);
    expect(p.edits).toEqual([]);
  });
});
