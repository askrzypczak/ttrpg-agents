import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  defaultSyncConfig,
  planSync,
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

const context = {
  viewportCenter: { x: 0, y: 0 },
  placed: new Set(["i1", "i2"]),
  art: {},
};

/** A token created for `instance`, then edited at the table. */
function editedToken(
  instance: EncounterInstance,
  fields: Record<string, unknown>,
): SceneItem {
  const [created] = planSync([instance], [], defaultSyncConfig, {
    ...context,
    placed: new Set(),
  }).add;
  const token = structuredClone(created!);
  token.metadata[STAT_BUBBLES_METADATA_KEY] = {
    ...(token.metadata[STAT_BUBBLES_METADATA_KEY] as object),
    ...fields,
  };
  return token;
}

const bubbleWrites = (p: SyncPlan, id: string) =>
  p.update.filter((u) => u.id === id && u.key === STAT_BUBBLES_METADATA_KEY);

describe("planSync with an answer after a different value was sent", () => {
  it("an answer is not adopted when the table still shows the old baseline value of a field the store changed", () => {
    // The GM's 5 HP was sent, but the table shows the 10 HP it had before:
    // the store has since moved HP itself (4), so that is pushed.
    const token = editedToken(inst(), { health: 10 });
    const answer = inst({ currentHp: 4 });

    const p = planSync([answer], [token], defaultSyncConfig, {
      ...context,
      answered: new Map([["i1", answer]]),
      sent: { i1: { [STAT_BUBBLES_METADATA_KEY]: { currentHp: 5 } } },
    });

    const writes = bubbleWrites(p, token.id);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value).toMatchObject({ health: 4 });
    expect(p.edits).toEqual([]);
  });

  it("another token's push for the same key does not hide an answered token's note", () => {
    const other = editedToken(inst({ id: "i2", displayName: "Goblin 3" }), {});
    const token = editedToken(inst(), { health: 15 });
    const answer = inst({ currentHp: 10 });

    // The first token's HP changed through the MCP, so it is pushed.
    const p = planSync(
      [inst({ id: "i2", displayName: "Goblin 3", currentHp: 7 }), answer],
      [other, token],
      defaultSyncConfig,
      {
        ...context,
        answered: new Map([["i1", answer]]),
        sent: { i1: { [STAT_BUBBLES_METADATA_KEY]: { currentHp: 15 } } },
      },
    );

    expect(bubbleWrites(p, other.id)).toHaveLength(1);
    expect(bubbleWrites(p, token.id)).toEqual([]);
    expect(p.differs).toEqual([
      { instanceId: "i1", message: expect.any(String) },
    ]);
  });
});
