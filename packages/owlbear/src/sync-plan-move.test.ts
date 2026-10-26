import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem, Vec2 } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  POSITION_BASELINE_KEY,
  SYNCED_METADATA_KEY,
  planSync,
  type EncounterInstance,
  type Projector,
  type SyncConfig,
  type SyncPlan,
} from "./sync-plan.js";

const inst = (
  n: number,
  over: Partial<EncounterInstance> = {},
): EncounterInstance =>
  makeTestInstance({
    id: `i${n}`,
    displayName: `Shadow ${n}`,
    createdAt: n,
    ...over,
  });

const link: Projector = {
  key: INSTANCE_METADATA_KEY,
  mode: "owned",
  project: (i) => ({ instanceId: i.id }),
};

const config: SyncConfig = {
  projectors: [link],
  tokenKind: () => ({
    type: "SHAPE",
    shape: { shapeType: "CIRCLE" as const, width: 150, height: 150 },
  }),
};

const center = { x: 1000, y: 500 };

/** Where the extension last placed token 1. */
const placed: Vec2 = { x: 250, y: 150 };
/** Where the GM dragged token 1 on the table. */
const dragged: Vec2 = { x: 900, y: 900 };
/** The new spawn position the move tool set for instance 1. */
const target: Vec2 = { x: 650, y: 550 };

const ctx = (
  over: { moves?: string[]; snapshot?: boolean; placed?: string[] } = {},
) => ({
  viewportCenter: center,
  placed: new Set(over.placed ?? ["i1"]),
  art: {},
  ...(over.snapshot === undefined ? {} : { snapshot: over.snapshot }),
  ...(over.moves === undefined ? {} : { moves: new Set(over.moves) }),
});

/**
 * Token `n` at `at`; its synced record holds the link, the name and, unless
 * `baseline` is null, the position it was last placed at.
 */
const tokenOf = (
  n: number,
  at: Vec2,
  baseline: Vec2 | null = placed,
): SceneItem => ({
  id: `token-${n}`,
  type: "SHAPE",
  name: `Shadow ${n}`,
  visible: false,
  position: { ...at },
  metadata: {
    [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
    [SYNCED_METADATA_KEY]: {
      [INSTANCE_METADATA_KEY]: { instanceId: `i${n}` },
      [NAME_BASELINE_KEY]: `Shadow ${n}`,
      ...(baseline === null ? {} : { [POSITION_BASELINE_KEY]: baseline }),
    },
  },
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
});

/** Token 1 at `at`, as `tokenOf`. */
const token = (at: Vec2, baseline: Vec2 | null = placed): SceneItem =>
  tokenOf(1, at, baseline);

/** Token 2, still where it was placed, whose instance the move tool sent to `target`. */
const movedSibling = {
  instance: inst(2, { spawnPosition: target }),
  token: tokenOf(2, placed),
  move: { id: "token-2", position: target },
};

/** Applies the plan's metadata updates and moves to copies of `items`. */
function applyPlan(items: SceneItem[], plan: SyncPlan): SceneItem[] {
  const out = structuredClone(items);
  for (const { id, key, value } of plan.update) {
    const item = out.find((i) => i.id === id);
    if (!item) throw new Error(`update for unknown item ${id}`);
    if (value === undefined) delete item.metadata[key];
    else item.metadata[key] = structuredClone(value);
  }
  for (const { id, position } of plan.move) {
    const item = out.find((i) => i.id === id);
    if (!item) throw new Error(`move for unknown item ${id}`);
    item.position = { ...position };
  }
  return out;
}

const movedNote =
  "Shadow 1 was moved at the agent's request; its token had been moved on the table, and that position was overwritten.";
const maybeMovedNote =
  "Shadow 1 was moved at the agent's request; its token may have been moved on the table, and that position was overwritten.";

describe("planSync token position", () => {
  it("planSync records a new token's created position in its synced record", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target }), inst(2)],
      [],
      config,
      ctx({ placed: [] }),
    );
    const syncedPosition = plan.add.map(
      (item) =>
        (item.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>)[
          POSITION_BASELINE_KEY
        ],
    );
    expect(syncedPosition).toEqual([target, center]);
    expect(plan.add.map((item) => item.position)).toEqual(syncedPosition);
  });

  it("an existing token moves to its instance's spawn position when an mcp change set it", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target })],
      [token(placed)],
      config,
      ctx({ moves: ["i1"] }),
    );
    expect(plan.move).toEqual([{ id: "token-1", position: target }]);
    expect(plan.add).toEqual([]);
  });

  it("a token whose instance's spawn position did not change is not moved", () => {
    // The GM dragged token 1; its spawn position is still where it was
    // placed. Token 2's instance was moved in the same change.
    for (const snapshot of [false, true]) {
      const plan = planSync(
        [inst(1, { spawnPosition: placed }), movedSibling.instance],
        [token(dragged), movedSibling.token],
        config,
        ctx({ snapshot, moves: ["i2"], placed: ["i1", "i2"] }),
      );
      expect(plan.move, `snapshot ${String(snapshot)}`).toEqual([
        movedSibling.move,
      ]);
    }
  });

  it("a moved token is not moved again by the next plan", () => {
    const desired = [inst(1, { spawnPosition: target })];
    const first = planSync(
      desired,
      [token(placed)],
      config,
      ctx({ moves: ["i1"] }),
    );
    expect(first.move).toEqual([{ id: "token-1", position: target }]);
    const after = applyPlan([token(placed)], first);

    for (const snapshot of [false, true]) {
      const next = planSync(desired, after, config, ctx({ snapshot }));
      expect(next.move, `snapshot ${String(snapshot)}`).toEqual([]);
    }
  });

  it("a token the GM moved after the move stays where the GM put it", () => {
    const desired = [inst(1, { spawnPosition: target })];
    const first = planSync(
      desired,
      [token(placed)],
      config,
      ctx({ moves: ["i1"] }),
    );
    expect(first.move).toEqual([{ id: "token-1", position: target }]);
    const after = applyPlan([token(placed)], first).map((item) => ({
      ...item,
      position: { ...dragged },
    }));

    for (const snapshot of [false, true]) {
      const next = planSync(desired, after, config, ctx({ snapshot }));
      expect(next.move, `snapshot ${String(snapshot)}`).toEqual([]);
    }
  });

  it("a snapshot whose spawn position differs from the position last placed moves the token", () => {
    // The move happened while the extension was offline: no mcp event, only
    // the snapshot's spawn position.
    const plan = planSync(
      [inst(1, { spawnPosition: target })],
      [token(placed)],
      config,
      ctx({ snapshot: true }),
    );
    expect(plan.move).toEqual([{ id: "token-1", position: target }]);
  });

  it("a token already at its new spawn position is not written", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target }), movedSibling.instance],
      [token(target), movedSibling.token],
      config,
      ctx({ moves: ["i1", "i2"], placed: ["i1", "i2"] }),
    );
    expect(plan.move).toEqual([movedSibling.move]);
    expect(plan.overrides).toEqual([]);
  });

  it("a token without a position baseline is not moved without an mcp change", () => {
    for (const snapshot of [false, true]) {
      const plan = planSync(
        [inst(1, { spawnPosition: target }), movedSibling.instance],
        [token(dragged, null), movedSibling.token],
        config,
        ctx({ snapshot, moves: ["i2"], placed: ["i1", "i2"] }),
      );
      expect(plan.move, `snapshot ${String(snapshot)}`).toEqual([
        movedSibling.move,
      ]);
    }
  });

  it("moving a token the GM had moved on the table is listed in overrides", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target })],
      [token(dragged)],
      config,
      ctx({ moves: ["i1"] }),
    );
    expect(plan.move).toEqual([{ id: "token-1", position: target }]);
    expect(plan.overrides).toEqual([{ instanceId: "i1", message: movedNote }]);
  });

  it("moving a token still where it was last placed lists no override", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target })],
      [token(placed)],
      config,
      ctx({ moves: ["i1"] }),
    );
    expect(plan.move).toEqual([{ id: "token-1", position: target }]);
    expect(plan.overrides).toEqual([]);
  });

  it("moving a token with no position baseline is listed in overrides as possibly moved", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target })],
      [token(placed, null)],
      config,
      ctx({ moves: ["i1"] }),
    );
    expect(plan.move).toEqual([{ id: "token-1", position: target }]);
    expect(plan.overrides).toEqual([
      { instanceId: "i1", message: maybeMovedNote },
    ]);
  });
});
