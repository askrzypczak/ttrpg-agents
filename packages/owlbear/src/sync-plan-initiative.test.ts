import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import type { SceneItem } from "./scene-model.js";
import {
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
    initiative: 10,
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

/** A token created for `instance`, as the sync first writes it. */
function createdToken(instance: EncounterInstance): SceneItem {
  const [created] = planSync([instance], [], defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(),
    art: {},
  }).add;
  return structuredClone(created!);
}

/** A token created for `instance` whose tracker value was then set at the table. */
function withTracker(instance: EncounterInstance, tracker: unknown): SceneItem {
  const token = createdToken(instance);
  token.metadata[INITIATIVE_METADATA_KEY] = tracker;
  return token;
}

/** A token created for `instance` that the GM removed from the tracker. */
function removedFromTracker(instance: EncounterInstance): SceneItem {
  const token = createdToken(instance);
  delete token.metadata[INITIATIVE_METADATA_KEY];
  return token;
}

const trackerUpdates = (p: SyncPlan) =>
  p.update.filter((u) => u.key === INITIATIVE_METADATA_KEY);

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

const trackerAfter = (token: SceneItem, p: SyncPlan): unknown =>
  applyUpdates([token], p)[0]!.metadata[INITIATIVE_METADATA_KEY];

describe("planSync write-back of the initiative count", () => {
  it("a count edited on the tracker is planned as an initiative edit and the token keeps it", () => {
    const token = withTracker(inst(), { count: "14", active: true });

    const p = plan([inst()], [token]);

    expect(p.edits).toEqual([{ instanceId: "i1", initiative: 14 }]);
    expect(p.rejected).toEqual([]);
    expect(trackerUpdates(p)).toEqual([]);
    expect(trackerAfter(token, p)).toEqual({ count: "14", active: true });
  });

  it("an active-only change plans no edit and no push", () => {
    const token = withTracker(inst(), { count: "10", active: true });

    const p = plan([inst()], [token]);

    expect(p.edits).toEqual([]);
    expect(p.rejected).toEqual([]);
    expect(trackerUpdates(p)).toEqual([]);

    // Control: a count edited as well as the active flag is planned.
    const edited = withTracker(inst(), { count: "14", active: true });
    expect(plan([inst()], [edited]).edits).toEqual([
      { instanceId: "i1", initiative: 14 },
    ]);
  });

  it("after the store acknowledges the edit planSync plans nothing for the tracker key", () => {
    const token = withTracker(inst(), { count: "14", active: false });

    const p = plan([inst({ initiative: 14 })], [token], {
      settled: { initiative: 14 },
    });

    expect(p.edits).toEqual([]);
    expect(p.rejected).toEqual([]);
    expect(trackerUpdates(p)).toEqual([]);
    expect(trackerAfter(token, p)).toEqual({ count: "14", active: false });

    // Control: the acknowledged value is the agreed one, so a later edit is planned.
    const later = withTracker(inst(), { count: "16", active: false });
    expect(
      plan([inst({ initiative: 14 })], [later], {
        settled: { initiative: 14 },
      }).edits,
    ).toEqual([{ instanceId: "i1", initiative: 16 }]);
  });

  it("a count edit in flight is not planned again", () => {
    const token = withTracker(inst(), { count: "14", active: false });

    const p = plan([inst()], [token], { inflight: { initiative: 14 } });

    expect(p.edits).toEqual([]);
    expect(trackerUpdates(p)).toEqual([]);

    // Control: the same token with nothing in flight is planned as an edit.
    expect(plan([inst()], [token]).edits).toEqual([
      { instanceId: "i1", initiative: 14 },
    ]);
  });

  it("an mcp initiative change pushes the new count over a table edit and keeps active", () => {
    const token = withTracker(inst(), { count: "14", active: true });

    const p = plan([inst({ initiative: 7 })], [token], {
      moved: new Set(["initiative"]),
    });

    expect(p.edits).toEqual([]);
    expect(trackerUpdates(p)).toEqual([
      {
        id: token.id,
        key: INITIATIVE_METADATA_KEY,
        value: { count: "7", active: true },
      },
    ]);

    // Control: without the move the table edit stays and is planned instead.
    const unmoved = plan([inst()], [token]);
    expect(trackerUpdates(unmoved)).toEqual([]);
    expect(unmoved.edits).toEqual([{ instanceId: "i1", initiative: 14 }]);
  });

  it("an unreadable count is planned as rejected and left on the table", () => {
    for (const count of ["", "abc", "1.5"]) {
      const token = withTracker(inst(), { count, active: false });

      const p = plan([inst()], [token]);

      expect(p.edits, JSON.stringify(count)).toEqual([]);
      expect(p.rejected, JSON.stringify(count)).toEqual([
        { instanceId: "i1", message: expect.any(String) },
      ]);
      expect(trackerUpdates(p), JSON.stringify(count)).toEqual([]);
    }

    // Control: once the count reads as a whole number it is planned as an edit.
    const readable = withTracker(inst(), { count: " 12 ", active: false });
    const p = plan([inst()], [readable]);
    expect(p.rejected).toEqual([]);
    expect(p.edits).toEqual([{ instanceId: "i1", initiative: 12 }]);
  });

  it("after a snapshot a stored initiative equal to the token's count lists no override, and a different one is pushed and listed", () => {
    const token = withTracker(inst(), { count: "14", active: true });

    const same = plan([inst({ initiative: 14 })], [token], undefined, true);
    expect(same.overrides).toEqual([]);
    expect(same.edits).toEqual([]);
    expect(trackerUpdates(same)).toEqual([]);

    const different = plan([inst({ initiative: 7 })], [token], undefined, true);
    expect(different.edits).toEqual([]);
    expect(trackerUpdates(different)).toEqual([
      {
        id: token.id,
        key: INITIATIVE_METADATA_KEY,
        value: { count: "7", active: true },
      },
    ]);
    expect(different.overrides).toHaveLength(1);
    expect(different.overrides[0]).toMatchObject({ instanceId: "i1" });
    expect(different.overrides[0]!.message).toContain("Shadow 1");
    expect(different.overrides[0]!.message).toContain("7");
  });
});

describe("planSync with the token removed from the tracker", () => {
  it("removing the token from the tracker plans an initiative clear and pushes nothing", () => {
    const token = removedFromTracker(inst());

    const p = plan([inst()], [token]);

    expect(p.edits).toEqual([{ instanceId: "i1", initiative: null }]);
    expect(p.rejected).toEqual([]);
    expect(trackerUpdates(p)).toEqual([]);
    expect(trackerAfter(token, p)).toBeUndefined();
  });

  it("a clear in flight is not planned again", () => {
    const token = removedFromTracker(inst());

    const p = plan([inst()], [token], { inflight: { initiative: null } });

    expect(p.edits).toEqual([]);
    expect(trackerUpdates(p)).toEqual([]);

    // Control: with no clear in flight it is planned.
    expect(plan([inst()], [token]).edits).toEqual([
      { instanceId: "i1", initiative: null },
    ]);
  });
});

describe("planSync with a count on a token whose instance has no initiative", () => {
  const noInitiative = () => inst({ initiative: null });

  /** The token of an instance without initiative, added to the tracker at the table. */
  const addedToTracker = (tracker: unknown): SceneItem =>
    withTracker(noInitiative(), tracker);

  it("a count on a token whose instance has no initiative is planned as an adopted edit", () => {
    const token = addedToTracker({ count: "3", active: false });

    const p = plan([noInitiative()], [token]);

    expect(p.edits).toEqual([{ instanceId: "i1", initiative: 3 }]);
    expect(p.rejected).toEqual([]);
    expect(trackerUpdates(p)).toEqual([]);
    expect(trackerAfter(token, p)).toEqual({ count: "3", active: false });
  });

  it("an adopted count in flight or settled is not planned again", () => {
    const token = addedToTracker({ count: "3", active: false });

    const inFlight = plan([noInitiative()], [token], {
      inflight: { initiative: 3 },
    });
    expect(inFlight.edits).toEqual([]);

    const settled = plan([noInitiative()], [token], {
      settled: { initiative: 3 },
    });
    expect(settled.edits).toEqual([]);

    // Control: a different count is still adopted.
    const typed = addedToTracker({ count: "4", active: false });
    expect(
      plan([noInitiative()], [typed], { inflight: { initiative: 3 } }).edits,
    ).toEqual([{ instanceId: "i1", initiative: 4 }]);
  });

  it("an unreadable count on a token whose instance has no initiative is planned as rejected", () => {
    const token = addedToTracker({ count: "", active: false });

    const p = plan([noInitiative()], [token]);

    expect(p.edits).toEqual([]);
    expect(p.rejected).toEqual([
      { instanceId: "i1", message: expect.any(String) },
    ]);
    expect(trackerUpdates(p)).toEqual([]);
  });
});
