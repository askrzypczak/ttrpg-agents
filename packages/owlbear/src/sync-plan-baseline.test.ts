import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import type { SceneItem } from "./scene-model.js";
import {
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  type EncounterInstance,
  type FieldContext,
  type SyncConfig,
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
  config: SyncConfig = defaultSyncConfig,
): SyncPlan =>
  planSync(desired, observed, config, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(["i1"]),
    art: {},
    ...(fields ? { fields: new Map([["i1", fields]]) } : {}),
  });

/** A token created for `instance`, as the sync first writes it, with a tracker value and baseline. */
function tokenWith(
  tracker: unknown,
  trackerBaseline?: Record<string, unknown>,
): SceneItem {
  const [created] = planSync([inst()], [], defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(),
    art: {},
  }).add;
  const token = structuredClone(created!);
  token.metadata[INITIATIVE_METADATA_KEY] = tracker;
  if (trackerBaseline !== undefined)
    (token.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
      INITIATIVE_METADATA_KEY
    ] = trackerBaseline;
  return token;
}

const syncedWrites = (p: SyncPlan) =>
  p.update.filter((u) => u.key === SYNCED_METADATA_KEY);

describe("planSync baseline of the tracker count", () => {
  it("a baseline without a count stays without one while the table's count is planned as an edit", () => {
    const token = tokenWith({ count: "14", active: false }, { active: false });

    const p = plan([inst()], [token]);

    expect(p.edits).toEqual([{ instanceId: "i1", initiative: 14 }]);
    expect(syncedWrites(p)).toEqual([]);
  });

  it("a cleared initiative acknowledged by the store leaves no count in the baseline", () => {
    const token = tokenWith({ count: "14", active: false });

    const p = plan([inst()], [token], { settled: { initiative: null } });

    expect(p.edits).toEqual([{ instanceId: "i1", initiative: 14 }]);
    const [write] = syncedWrites(p);
    const recorded = (write!.value as Record<string, unknown>)[
      INITIATIVE_METADATA_KEY
    ] as Record<string, unknown>;
    expect(Object.hasOwn(recorded, "count")).toBe(false);
  });
});

describe("planSync with a key the instance has no value for", () => {
  it("leaves a token value alone when the projector cannot read it back", () => {
    const config: SyncConfig = {
      ...defaultSyncConfig,
      projectors: [{ key: "other", mode: "owned", project: () => undefined }],
    };
    const token = tokenWith({ count: "3", active: false });
    token.metadata.other = { value: 1 };

    const p = plan([inst()], [token], undefined, config);

    expect(p.edits).toEqual([]);
    expect(p.rejected).toEqual([]);
  });
});

describe("planSync with a table value that has no baseline", () => {
  /** A token whose Stat Bubbles value was written by hand: no baseline for the key. */
  function unbaselined(bubbles?: Record<string, unknown>): SceneItem {
    const token = tokenWith({ count: "10", active: false });
    delete (token.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
      STAT_BUBBLES_METADATA_KEY
    ];
    if (bubbles === undefined) delete token.metadata[STAT_BUBBLES_METADATA_KEY];
    else token.metadata[STAT_BUBBLES_METADATA_KEY] = bubbles;
    return token;
  }

  const bubblesWrite = (p: SyncPlan) =>
    p.update.find((u) => u.key === STAT_BUBBLES_METADATA_KEY)?.value;

  it("a value the store moved one field of is pushed", () => {
    const token = unbaselined({
      health: 3,
      "max health": 16,
      "armor class": 12,
      hide: true,
    });

    const p = plan([inst({ currentHp: 7 })], [token], {
      moved: new Set(["currentHp"]),
    });

    expect(bubblesWrite(p)).toMatchObject({ health: 7, "max health": 16 });
  });

  it("is left alone when the store moved no field of it", () => {
    const token = unbaselined({
      health: 3,
      "max health": 16,
      "armor class": 12,
      hide: true,
    });

    const p = plan([inst({ currentHp: 7 })], [token]);

    expect(bubblesWrite(p)).toBeUndefined();
  });

  it("a token without the value gets the whole value once the store moved a field", () => {
    const token = unbaselined();

    const p = plan([inst({ currentHp: 7 })], [token], {
      moved: new Set(["currentHp"]),
    });

    expect(bubblesWrite(p)).toMatchObject({
      health: 7,
      "max health": 16,
      "armor class": 12,
    });
  });
});
