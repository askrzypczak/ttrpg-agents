import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  defaultSyncConfig,
  planSync,
  type EncounterInstance,
  type Projector,
  type SyncConfig,
} from "./sync-plan.js";

const instance: EncounterInstance = makeTestInstance();

const KEY = "test.ext/value";
const context = { viewportCenter: { x: 0, y: 0 }, placed: new Set<string>() };
const linkValue = { instanceId: "i1" };
const link: Projector = {
  key: INSTANCE_METADATA_KEY,
  mode: "owned",
  project: (i) => ({ instanceId: i.id }),
};
const configFor = (project: () => unknown): SyncConfig => ({
  projectors: [link, { key: KEY, mode: "owned", project }],
  tokenKind: defaultSyncConfig.tokenKind,
});

const itemWith = (metadata: Record<string, unknown>): SceneItem => ({
  id: "t1",
  type: "SHAPE",
  name: "Shadow 1",
  visible: false,
  position: { x: 0, y: 0 },
  metadata,
});

describe("planSync guards", () => {
  it.each([
    ["a string", "i1"],
    ["null", null],
    ["a number instanceId", { instanceId: 5 }],
    ["an empty object", {}],
  ])("does not treat an item whose link is %s as ours", (_name, value) => {
    const plan = planSync(
      [instance],
      [itemWith({ [INSTANCE_METADATA_KEY]: value })],
      defaultSyncConfig,
      context,
    );
    expect(plan.delete).toEqual([]);
    expect(plan.add).toHaveLength(1);
  });

  // The projected value d and the token's value o differ, so a push is
  // expected (the baseline is a sentinel that differs from d).
  it.each<[string, unknown, unknown]>([
    ["number vs null", 1, null],
    ["null vs object", null, {}],
    ["object vs null", {}, null],
    ["array vs object", [], {}],
    ["object vs array", {}, []],
    ["array longer", [1], [1, 2]],
    ["object with an extra key", { a: 1 }, { a: 1, b: 2 }],
    ["object missing a key", { a: 1, b: 2 }, { a: 1 }],
    ["different values", { a: 1 }, { a: 2 }],
    ["same keys, other names", { a: 1 }, { b: 1 }],
    ["string vs number", "1", 1],
    ["number vs empty object", 1, {}],
    ["empty object vs number", {}, 1],
  ])("pushes when the values differ: %s", (_name, d, o) => {
    const plan = planSync(
      [instance],
      [
        itemWith({
          [INSTANCE_METADATA_KEY]: linkValue,
          [KEY]: o,
          [SYNCED_METADATA_KEY]: {
            [INSTANCE_METADATA_KEY]: linkValue,
            [KEY]: "sentinel",
          },
        }),
      ],
      configFor(() => d),
      context,
    );
    expect(plan.update.filter((u) => u.key === KEY)).toEqual([
      { id: "t1", key: KEY, value: d },
    ]);
  });

  it("does not push structurally equal values", () => {
    const value = { a: [1, { b: null }], c: "x" };
    const plan = planSync(
      [instance],
      [
        itemWith({
          [INSTANCE_METADATA_KEY]: linkValue,
          [KEY]: structuredClone(value),
          [SYNCED_METADATA_KEY]: {
            [INSTANCE_METADATA_KEY]: linkValue,
            [NAME_BASELINE_KEY]: "Shadow 1",
            [KEY]: structuredClone(value),
          },
        }),
      ],
      configFor(() => value),
      context,
    );
    expect(plan.update).toEqual([]);
  });

  it.each([
    ["an array", ["a"]],
    ["a string", "oops"],
    ["null", null],
  ])("ignores a baseline that is %s", (_name, baseline) => {
    const plan = planSync(
      [instance],
      [
        itemWith({
          [INSTANCE_METADATA_KEY]: linkValue,
          [KEY]: "table",
          [SYNCED_METADATA_KEY]: baseline,
        }),
      ],
      configFor(() => "db"),
      context,
    );
    expect(plan.update).toEqual([
      {
        id: "t1",
        key: SYNCED_METADATA_KEY,
        value: {
          [INSTANCE_METADATA_KEY]: linkValue,
          [NAME_BASELINE_KEY]: "Shadow 1",
          [KEY]: "db",
        },
      },
    ]);
  });

  it("gives a new token no baseline entry for a create-only key", () => {
    const plan = planSync(
      [instance],
      [],
      {
        projectors: [link, { key: KEY, mode: "create-only", project: () => 1 }],
        tokenKind: defaultSyncConfig.tokenKind,
      },
      context,
    );
    expect(plan.add[0]!.metadata[KEY]).toBe(1);
    const synced = plan.add[0]!.metadata[SYNCED_METADATA_KEY];
    expect(synced).toMatchObject({ [INSTANCE_METADATA_KEY]: linkValue });
    expect(synced).not.toHaveProperty([KEY]);
  });
});
