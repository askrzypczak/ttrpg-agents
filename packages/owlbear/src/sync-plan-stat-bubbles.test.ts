import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
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
    currentHp: 16,
    armorClass: 12,
    initiative: 14,
    ...over,
  });

const plan = (
  desired: EncounterInstance[],
  observed: SceneItem[],
  placed: string[] = [],
  fields?: FieldContext,
): SyncPlan =>
  planSync(desired, observed, defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(placed),
    art: {},
    ...(fields ? { fields: new Map([["i1", fields]]) } : {}),
  });

/** The store moved HP, as an `mcp` event does. */
const hpMoved: FieldContext = { moved: new Set(["currentHp"]) };

const emptyPlan: SyncPlan = {
  add: [],
  update: [],
  delete: [],
  rename: [],
  move: [],
  restyle: [],
  deleted: [],
  needsArt: [],
  edits: [],
  rejected: [],
  overrides: [],
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

const FOREIGN_KEY = "other.ext/notes";

describe("planSync with the stat bubbles projector", () => {
  it("a new token is created with the stat bubbles metadata beside the instance link and initiative", () => {
    const { add } = plan([inst()], []);
    expect(add).toHaveLength(1);
    const metadata = add[0]!.metadata;
    expect(metadata[INSTANCE_METADATA_KEY]).toEqual({ instanceId: "i1" });
    expect(metadata[INITIATIVE_METADATA_KEY]).toEqual({
      count: "14",
      active: false,
    });
    const bubbles = {
      health: 16,
      "max health": 16,
      "armor class": 12,
      hide: true,
    };
    expect(metadata[STAT_BUBBLES_METADATA_KEY]).toEqual(bubbles);
    expect(
      (metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
        STAT_BUBBLES_METADATA_KEY
      ],
    ).toEqual(bubbles);
  });

  it("an HP change writes only the stat bubbles key and leaves other metadata keys and temporary health alone", () => {
    const initiative = { count: "14", active: false };
    const baselineBubbles = {
      health: 16,
      "max health": 16,
      "armor class": 12,
      hide: true,
    };
    const token: SceneItem = {
      id: "token-1",
      type: "SHAPE",
      name: "Shadow 1",
      visible: false,
      position: { x: 0, y: 0 },
      shape: { shapeType: "CIRCLE", width: 150, height: 150 },
      metadata: {
        [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
        [INITIATIVE_METADATA_KEY]: initiative,
        [FOREIGN_KEY]: { text: "keep me" },
        [STAT_BUBBLES_METADATA_KEY]: {
          ...baselineBubbles,
          "temporary health": 4,
        },
        [SYNCED_METADATA_KEY]: {
          [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
          [INITIATIVE_METADATA_KEY]: initiative,
          [STAT_BUBBLES_METADATA_KEY]: baselineBubbles,
          [NAME_BASELINE_KEY]: "Shadow 1",
        },
      },
    };

    const p = plan([inst({ currentHp: 10 })], [token], ["i1"], hpMoved);

    expect(p.update.map((u) => u.key).sort()).toEqual(
      [STAT_BUBBLES_METADATA_KEY, SYNCED_METADATA_KEY].sort(),
    );
    const metadata = applyUpdates([token], p)[0]!.metadata;
    expect(metadata[STAT_BUBBLES_METADATA_KEY]).toEqual({
      health: 10,
      "max health": 16,
      "armor class": 12,
      hide: true,
      "temporary health": 4,
    });
    expect(metadata[INSTANCE_METADATA_KEY]).toEqual({ instanceId: "i1" });
    expect(metadata[INITIATIVE_METADATA_KEY]).toEqual(initiative);
    expect(metadata[FOREIGN_KEY]).toEqual({ text: "keep me" });
  });

  it("planning the same instances again writes nothing", () => {
    const desired = [inst(), inst({ id: "i2", displayName: "Shadow 2" })];
    const created = plan(desired, []).add;
    expect(created.map((t) => t.metadata[STAT_BUBBLES_METADATA_KEY])).toEqual([
      { health: 16, "max health": 16, "armor class": 12, hide: true },
      { health: 16, "max health": 16, "armor class": 12, hide: true },
    ]);

    expect(plan(desired, created, ["i1", "i2"])).toEqual(emptyPlan);
  });

  it("a table edit to HP is kept until the encounter HP changes again", () => {
    const [created] = plan([inst()], []).add;
    const edited: SceneItem = structuredClone(created!);
    edited.metadata[STAT_BUBBLES_METADATA_KEY] = {
      ...(edited.metadata[STAT_BUBBLES_METADATA_KEY] as object),
      health: 5,
    };

    // The table value is written back to the store and is not overwritten.
    const written = plan([inst()], [edited], ["i1"]);
    expect(written.edits).toEqual([{ instanceId: "i1", currentHp: 5 }]);
    expect(
      applyUpdates([edited], written)[0]!.metadata[STAT_BUBBLES_METADATA_KEY],
    ).toEqual(edited.metadata[STAT_BUBBLES_METADATA_KEY]);

    const changed = plan([inst({ currentHp: 8 })], [edited], ["i1"], hpMoved);
    const metadata = applyUpdates([edited], changed)[0]!.metadata;
    expect(metadata[STAT_BUBBLES_METADATA_KEY]).toEqual({
      health: 8,
      "max health": 16,
      "armor class": 12,
      hide: true,
    });
  });

  describe("hide follows statsVisible", () => {
    const shown = { health: 16, "max health": 16, "armor class": 12 };

    /** Our token for `inst()`, with the hide it shows and the hide we last wrote. */
    const bubblesToken = (hide: boolean, baselineHide: boolean): SceneItem => ({
      id: "token-1",
      type: "SHAPE",
      name: "Shadow 1",
      visible: false,
      position: { x: 0, y: 0 },
      shape: { shapeType: "CIRCLE", width: 150, height: 150 },
      metadata: {
        [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
        [INITIATIVE_METADATA_KEY]: { count: "14", active: false },
        [STAT_BUBBLES_METADATA_KEY]: { ...shown, hide },
        [SYNCED_METADATA_KEY]: {
          [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
          [INITIATIVE_METADATA_KEY]: { count: "14", active: false },
          [STAT_BUBBLES_METADATA_KEY]: { ...shown, hide: baselineHide },
          [NAME_BASELINE_KEY]: "Shadow 1",
        },
      },
    });

    const bubblesAfter = (token: SceneItem, p: SyncPlan): unknown =>
      applyUpdates([token], p)[0]!.metadata[STAT_BUBBLES_METADATA_KEY];

    const syncedBubblesAfter = (token: SceneItem, p: SyncPlan): unknown =>
      (
        applyUpdates([token], p)[0]!.metadata[SYNCED_METADATA_KEY] as Record<
          string,
          unknown
        >
      )[STAT_BUBBLES_METADATA_KEY];

    it("planSync pushes hide false when the encounter reveals a token whose baseline hide was true", () => {
      const token = bubblesToken(true, true);
      const p = plan([inst({ statsVisible: true })], [token], ["i1"]);
      expect(p.update).toContainEqual({
        id: "token-1",
        key: STAT_BUBBLES_METADATA_KEY,
        value: { ...shown, hide: false },
      });
      expect(bubblesAfter(token, p)).toEqual({ ...shown, hide: false });
      expect(syncedBubblesAfter(token, p)).toEqual({ ...shown, hide: false });
    });

    it("planSync pushes hide true again when the encounter hides it", () => {
      const token = bubblesToken(false, false);
      const p = plan([inst({ statsVisible: false })], [token], ["i1"]);
      expect(p.update).toContainEqual({
        id: "token-1",
        key: STAT_BUBBLES_METADATA_KEY,
        value: { ...shown, hide: true },
      });
      expect(bubblesAfter(token, p)).toEqual({ ...shown, hide: true });
      expect(syncedBubblesAfter(token, p)).toEqual({ ...shown, hide: true });
    });

    it("a hide toggled at the table survives an HP change while statsVisible is unchanged", () => {
      for (const statsVisible of [false, true]) {
        const label = `statsVisible ${String(statsVisible)}`;
        const [created] = plan([inst({ statsVisible })], []).add;
        expect(created!.metadata[STAT_BUBBLES_METADATA_KEY], label).toEqual({
          ...shown,
          hide: !statsVisible,
        });

        const toggled: SceneItem = structuredClone(created!);
        toggled.metadata[STAT_BUBBLES_METADATA_KEY] = {
          ...shown,
          hide: statsVisible,
        };
        expect(
          plan([inst({ statsVisible })], [toggled], ["i1"]).update,
          label,
        ).toEqual([]);

        const hit = plan(
          [inst({ statsVisible, currentHp: 10 })],
          [toggled],
          ["i1"],
          hpMoved,
        );
        expect(bubblesAfter(toggled, hit), label).toEqual({
          ...shown,
          health: 10,
          hide: statsVisible,
        });
      }
    });

    it("a revealed instance's new token is created with hide false", () => {
      const { add } = plan(
        [
          inst({ statsVisible: true }),
          inst({ id: "i2", displayName: "Shadow 2" }),
        ],
        [],
      );
      const written = add.map((t) => [
        t.metadata[STAT_BUBBLES_METADATA_KEY],
        (t.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
          STAT_BUBBLES_METADATA_KEY
        ],
      ]);
      expect(written).toEqual([
        [
          { ...shown, hide: false },
          { ...shown, hide: false },
        ],
        [
          { ...shown, hide: true },
          { ...shown, hide: true },
        ],
      ]);
    });
  });
});
