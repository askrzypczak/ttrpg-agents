import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  type EncounterInstance,
  type FieldContext,
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

const plan = (
  desired: EncounterInstance[],
  observed: SceneItem[],
  fields?: FieldContext,
  snapshot = false,
): SyncPlan =>
  planSync(desired, observed, defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(["i1"]),
    art: {},
    ...(snapshot ? { snapshot } : {}),
    ...(fields ? { fields: new Map([["i1", fields]]) } : {}),
  });

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
  it("planSync emits an edit for a table-edited owned key and leaves the table value", () => {
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
    expect(bubblesOf(after!)).toEqual(bubblesOf(token));
  });

  it("planSync emits no edit when the encounter changed as well", () => {
    const token = editedToken(inst(), { health: 5 });

    const p = plan([inst({ currentHp: 8 })], [token], {
      moved: new Set(["currentHp"]),
    });

    expect(p.edits).toEqual([]);
    const [after] = applyUpdates([token], p);
    expect(bubblesOf(after!)).toMatchObject({ health: 8 });
    expect(bubblesBaselineOf(after!)).toMatchObject({ health: 8 });

    // Control: the same table edit with an unchanged encounter is written back.
    expect(plan([inst()], [token]).edits).toEqual([
      { instanceId: "i1", currentHp: 5 },
    ]);
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

describe("planSync with edit fields in flight, settled or moved", () => {
  const stored = (over: Partial<EncounterInstance> = {}) =>
    inst({ displayName: "Goblin 2", ...over });

  /** The token's Stat Bubbles value after the plan's metadata writes. */
  const bubblesAfter = (token: SceneItem, p: SyncPlan): unknown =>
    bubblesOf(applyUpdates([token], p)[0]!);

  const pushesBubbles = (p: SyncPlan): boolean =>
    p.update.some((u) => u.key === STAT_BUBBLES_METADATA_KEY);

  it("a field the store moved is pushed while a field in flight keeps its sent value", () => {
    const token = editedToken(stored(), { "max health": 20 });

    const p = plan([stored({ currentHp: 7 })], [token], {
      moved: new Set(["currentHp"]),
      inflight: { maxHp: 20 },
    });

    expect(bubblesAfter(token, p)).toMatchObject({
      health: 7,
      "max health": 20,
    });
    expect(p.edits).toEqual([]);
  });

  it("a settled field is recorded in the baseline without a push", () => {
    // 99 was sent and the store clamped it to its max HP of 16.
    const token = editedToken(stored(), { health: 99 });

    const p = plan([stored({ currentHp: 16 })], [token], {
      settled: { currentHp: 99 },
    });

    expect(pushesBubbles(p)).toBe(false);
    expect(p.edits).toEqual([]);
    expect(p.overrides).toEqual([]);
    const [after] = applyUpdates([token], p);
    expect(bubblesOf(after!)).toMatchObject({ health: 99 });
    expect(bubblesBaselineOf(after!)).toMatchObject({ health: 99 });
  });

  it("a field in flight is not planned as an edit again", () => {
    const token = editedToken(stored(), { health: 5 });

    // Control: without the command in flight the table value is an edit.
    expect(plan([stored()], [token]).edits).toEqual([
      { instanceId: "i1", currentHp: 5 },
    ]);

    const p = plan([stored()], [token], { inflight: { currentHp: 5 } });

    expect(p.edits).toEqual([]);
    expect(pushesBubbles(p)).toBe(false);
  });

  it("a field moved by mcp is pushed over a table edit of it", () => {
    // HP 5 was typed after the last write; the store now says 10 again.
    const token = editedToken(stored(), { health: 5 });

    const p = plan([stored()], [token], { moved: new Set(["currentHp"]) });

    expect(bubblesAfter(token, p)).toMatchObject({ health: 10 });
    expect(p.edits).toEqual([]);
  });

  it("a field in flight keeps its sent value although the store moved it", () => {
    const token = editedToken(stored(), { health: 5 });

    const p = plan([stored({ currentHp: 7 })], [token], {
      moved: new Set(["currentHp"]),
      inflight: { currentHp: 5 },
    });

    expect(bubblesAfter(token, p)).toMatchObject({ health: 5 });
    expect(p.edits).toEqual([]);
  });

  describe("overrides", () => {
    /** A token whose clamped value 99 was recorded as the baseline. */
    function clampedToken(): SceneItem {
      const token = editedToken(stored(), { health: 99 });
      const synced = token.metadata[SYNCED_METADATA_KEY] as Record<
        string,
        unknown
      >;
      synced[STAT_BUBBLES_METADATA_KEY] = {
        ...(synced[STAT_BUBBLES_METADATA_KEY] as object),
        health: 99,
      };
      return token;
    }

    it("a field a snapshot pushes over a different token value is reported as an override naming the instance, field, table value and store value", () => {
      const token = clampedToken();

      const p = plan([stored({ currentHp: 16 })], [token], undefined, true);

      expect(bubblesAfter(token, p)).toMatchObject({ health: 16 });
      expect(p.overrides).toHaveLength(1);
      expect(p.overrides[0]!.instanceId).toBe("i1");
      for (const part of ["Goblin 2", "HP", "99", "16"])
        expect(p.overrides[0]!.message).toContain(part);
    });

    it("a field an mcp event pushes is not reported as an override", () => {
      const token = editedToken(stored({ currentHp: 16 }), { health: 99 });

      const p = plan([stored({ currentHp: 16 })], [token], {
        moved: new Set(["currentHp"]),
      });

      expect(bubblesAfter(token, p)).toMatchObject({ health: 16 });
      expect(p.overrides).toEqual([]);
    });
  });
});

describe("planSync per edit field", () => {
  /** The token's Stat Bubbles write in the plan, if any. */
  const bubblesWrite = (p: SyncPlan): unknown =>
    p.update.find((u) => u.key === STAT_BUBBLES_METADATA_KEY)?.value;

  it.each([
    [
      // 99 was acknowledged (and clamped to 16) just before the snapshot.
      "a field settled since the last reconcile",
      99,
      16,
      { settled: { currentHp: 99 } },
    ],
    [
      // The edit to 7 reached the store, but its acknowledgement was lost.
      "a store value the token already shows",
      7,
      7,
      undefined,
    ],
    [
      // The snapshot was read after the edit to 5 committed, before its answer.
      "an edit the store already holds that is still in flight",
      5,
      5,
      { inflight: { currentHp: 5 } },
    ],
  ])(
    "a snapshot writes nothing and records no override for %s",
    (_name, typed, storeHp, fields: FieldContext | undefined) => {
      const token = editedToken(inst(), { health: typed });

      const p = plan([inst({ currentHp: storeHp })], [token], fields, true);

      expect(bubblesWrite(p)).toBeUndefined();
      expect(p.overrides).toEqual([]);
      expect(p.edits).toEqual([]);
      const [after] = applyUpdates([token], p);
      expect(bubblesBaselineOf(after!)).toMatchObject({ health: typed });
    },
  );

  it("a store change of HP that no event or snapshot reports is not pushed, even to a value without hide", () => {
    // Another extension left the value without `hide`.
    const token = editedToken(inst(), {});
    delete (
      token.metadata[STAT_BUBBLES_METADATA_KEY] as Record<string, unknown>
    ).hide;

    expect(plan([inst({ currentHp: 7 })], [token]).update).toEqual([]);

    // Control: reported as moved, it is pushed.
    expect(
      bubblesWrite(
        plan([inst({ currentHp: 7 })], [token], {
          moved: new Set(["currentHp"]),
        }),
      ),
    ).toMatchObject({ health: 7 });
  });

  it("an unreadable value the store's change replaces is not reported", () => {
    const token = editedToken(inst(), { health: "lots" });

    const p = plan([inst({ currentHp: 7 })], [token], {
      moved: new Set(["currentHp"]),
    });

    expect(bubblesWrite(p)).toMatchObject({ health: 7 });
    expect(p.rejected).toEqual([]);

    // Control: left on the table, it is reported.
    expect(plan([inst()], [token]).rejected).toHaveLength(1);
  });
});

describe("planSync per edit field, fields the token or the baseline lack", () => {
  it("a field the token lacks stays absent when another field is pushed", () => {
    const token = editedToken(inst(), {});
    delete (
      token.metadata[STAT_BUBBLES_METADATA_KEY] as Record<string, unknown>
    )["max health"];

    const p = plan([inst({ currentHp: 7 })], [token], {
      moved: new Set(["currentHp"]),
    });

    const written = p.update.find((u) => u.key === STAT_BUBBLES_METADATA_KEY)
      ?.value as Record<string, unknown>;
    expect(written).toMatchObject({ health: 7 });
    expect(Object.hasOwn(written, "max health")).toBe(false);
  });

  it("a table value with no agreed value is written back and gets no baseline entry", () => {
    // Created without an armor class, so its baseline has none; the GM typed 14.
    const token = editedToken(inst({ armorClass: null }), {
      "armor class": 14,
    });

    const p = plan([inst({ armorClass: 12 })], [token]);

    expect(p.edits).toEqual([{ instanceId: "i1", armorClass: 14 }]);
    expect(p.update).toEqual([]);
  });
});
