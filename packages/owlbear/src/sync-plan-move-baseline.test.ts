import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem, Vec2 } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  POSITION_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  planSync,
  type SyncConfig,
  type SyncPlan,
} from "./sync-plan.js";

const config: SyncConfig = {
  projectors: [
    {
      key: INSTANCE_METADATA_KEY,
      mode: "owned",
      project: (i) => ({ instanceId: i.id }),
    },
  ],
  tokenKind: () => ({
    type: "SHAPE",
    shape: { shapeType: "CIRCLE" as const, width: 150, height: 150 },
  }),
};

/** Where the extension last placed token 1. */
const placed: Vec2 = { x: 250, y: 150 };
/** The new spawn position the move tool set for instance 1. */
const target: Vec2 = { x: 650, y: 550 };
/** Where the GM dragged token 1. */
const dragged: Vec2 = { x: 900, y: 900 };

const instance = makeTestInstance({
  id: "i1",
  displayName: "Shadow 1",
  spawnPosition: target,
});

const ctx = (over: { moves?: string[]; snapshot?: boolean } = {}) => ({
  viewportCenter: { x: 1000, y: 500 },
  placed: new Set(["i1"]),
  art: {},
  ...(over.snapshot === undefined ? {} : { snapshot: over.snapshot }),
  ...(over.moves === undefined ? {} : { moves: new Set(over.moves) }),
});

const token = (at: Vec2): SceneItem => ({
  id: "token-1",
  type: "SHAPE",
  name: "Shadow 1",
  visible: false,
  position: { ...at },
  metadata: {
    [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
    [SYNCED_METADATA_KEY]: {
      [INSTANCE_METADATA_KEY]: { instanceId: "i1" },
      [NAME_BASELINE_KEY]: "Shadow 1",
      [POSITION_BASELINE_KEY]: placed,
    },
  },
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
});

/** Applies the plan's metadata updates to a copy of the item. */
function applyUpdates(item: SceneItem, plan: SyncPlan): SceneItem {
  const out = structuredClone(item);
  for (const { id, key, value } of plan.update) {
    if (id !== out.id) continue;
    if (value === undefined) delete out.metadata[key];
    else out.metadata[key] = structuredClone(value);
  }
  return out;
}

describe("planSync token position record", () => {
  it("a token already at its new spawn position is not moved after the GM drags it", () => {
    const first = planSync(
      [instance],
      [token(target)],
      config,
      ctx({ moves: ["i1"] }),
    );
    expect(first.move).toEqual([]);
    const after = { ...applyUpdates(token(target), first), position: dragged };

    for (const snapshot of [false, true]) {
      const next = planSync([instance], [after], config, ctx({ snapshot }));
      expect(next.move, `snapshot ${String(snapshot)}`).toEqual([]);
    }
  });
});
