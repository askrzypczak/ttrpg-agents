import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  type EncounterInstance,
  type SyncPlan,
} from "./sync-plan.js";

const inst = (over: Partial<EncounterInstance> = {}): EncounterInstance =>
  makeTestInstance({
    id: "i1",
    displayName: "Shadow 1",
    maxHp: 16,
    currentHp: 10,
    armorClass: 12,
    initiative: 14,
    ...over,
  });

const plan = (desired: EncounterInstance[], observed: SceneItem[]): SyncPlan =>
  planSync(desired, observed, defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(["i1"]),
    art: {},
  });

const emptyPlan: SyncPlan = {
  add: [],
  update: [],
  delete: [],
  rename: [],
  deleted: [],
  needsArt: [],
  edits: [],
  rejected: [],
};

/** Applies the plan's key-level metadata updates to copies of `items`. */
function applyUpdates(items: SceneItem[], p: SyncPlan): SceneItem[] {
  const out = structuredClone(items);
  for (const { id, key, value } of p.update) {
    const item = out.find((i) => i.id === id);
    if (!item) throw new Error(`update for unknown item ${id}`);
    if (value === undefined) delete item.metadata[key];
    else item.metadata[key] = structuredClone(value);
  }
  return out;
}

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

const bubblesOf = (item: SceneItem): unknown =>
  item.metadata[STAT_BUBBLES_METADATA_KEY];
const bubblesBaselineOf = (item: SceneItem): unknown =>
  (item.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
    STAT_BUBBLES_METADATA_KEY
  ];

describe("planSync write-back of table edits", () => {
  it("planSync emits an edit for a table-edited owned key and sets its baseline to the table value", () => {
    const token = editedToken(inst(), {
      health: 18,
      "max health": 20,
      "armor class": 14,
    });

    const p = plan([inst()], [token]);

    expect(p.edits).toEqual([
      { instanceId: "i1", currentHp: 18, maxHp: 20, armorClass: 14 },
    ]);
    expect(p.rejected).toEqual([]);
    const [after] = applyUpdates([token], p);
    // The table value stays, and becomes the baseline.
    expect(bubblesOf(after!)).toEqual(bubblesOf(token));
    expect(bubblesBaselineOf(after!)).toEqual(bubblesOf(token));
  });

  it("planSync emits no edit when the encounter changed as well", () => {
    const token = editedToken(inst(), { health: 5 });

    const p = plan([inst({ currentHp: 8 })], [token]);

    expect(p.edits).toEqual([]);
    const [after] = applyUpdates([token], p);
    expect(bubblesOf(after!)).toMatchObject({ health: 8 });
    expect(bubblesBaselineOf(after!)).toMatchObject({ health: 8 });

    // Control: the same table edit with an unchanged encounter is written back.
    expect(plan([inst()], [token]).edits).toEqual([
      { instanceId: "i1", currentHp: 5 },
    ]);
  });

  it("planSync pushes the store's clamped value back after the store answers with a different value", () => {
    const token = editedToken(inst(), { health: 99 });
    const first = plan([inst()], [token]);
    expect(first.edits).toEqual([{ instanceId: "i1", currentHp: 99 }]);
    const [sent] = applyUpdates([token], first);

    // The store clamped 99 to max HP.
    const answered = inst({ currentHp: 16 });
    const second = plan([answered], [sent!]);

    expect(second.edits).toEqual([]);
    const [after] = applyUpdates([sent!], second);
    expect(bubblesOf(after!)).toMatchObject({ health: 16 });
    expect(bubblesBaselineOf(after!)).toMatchObject({ health: 16 });
    expect(plan([answered], [after!])).toEqual(emptyPlan);
  });

  it("planSync plans nothing after the store accepted the edit exactly", () => {
    const token = editedToken(inst(), { health: 5, "armor class": 15 });
    const first = plan([inst()], [token]);
    expect(first.edits).toEqual([
      { instanceId: "i1", currentHp: 5, armorClass: 15 },
    ]);
    const [sent] = applyUpdates([token], first);

    expect(plan([inst({ currentHp: 5, armorClass: 15 })], [sent!])).toEqual(
      emptyPlan,
    );
  });

  it("planSync reports an unparseable value and leaves it on the table", () => {
    const token = editedToken(inst(), { health: "lots" });

    const p = plan([inst()], [token]);

    expect(p.rejected).toEqual([
      { instanceId: "i1", message: expect.any(String) },
    ]);
    expect(p.edits).toEqual([]);
    expect(p.update).toEqual([]);
  });
});
