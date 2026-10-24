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

describe("planSync with an answer while the table holds an unsent value", () => {
  it("a value typed after an edit was sent is adopted and sent when the older answer arrives", () => {
    const token = editedToken(inst(), { health: 7 });

    const p = planAnswer(token, inst({ currentHp: 5 }), { currentHp: 5 });

    expect(bubbleWrites(p)).toEqual([]);
    expect(p.edits).toEqual([{ instanceId: "i1", currentHp: 7 }]);
  });

  it("an unsent value in another field is adopted and sent when an answer arrives", () => {
    const token = editedToken(inst(), { health: 5, "armor class": 15 });

    const p = planAnswer(token, inst({ currentHp: 5 }), { currentHp: 5 });

    expect(bubbleWrites(p)).toEqual([]);
    expect(p.edits).toEqual([{ instanceId: "i1", armorClass: 15 }]);
  });
});
