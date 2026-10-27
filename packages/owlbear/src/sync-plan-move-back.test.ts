import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type { SceneItem, Vec2 } from "./scene-model.js";
import {
  INSTANCE_METADATA_KEY,
  NAME_BASELINE_KEY,
  POSITION_BASELINE_KEY,
  PREVIOUS_POSITION_KEY,
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

/** Where the extension placed token 1 in the default row. */
const placed: Vec2 = { x: 250, y: 150 };
/** Where the GM dragged token 1 on the table. */
const dragged: Vec2 = { x: 900, y: 900 };
/** The spawn position the move tool set for instance 1. */
const target: Vec2 = { x: 650, y: 550 };
/** A later spawn position the move tool set for instance 1. */
const laterTarget: Vec2 = { x: 400, y: 800 };

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
 * Token `n` at `at`; its synced record holds the link, the name, the
 * recorded position `position` and, when `previous` is given (null
 * included), that previous position.
 */
const tokenOf = (
  n: number,
  at: Vec2,
  record: { position: Vec2; previous?: Vec2 | null },
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
      [POSITION_BASELINE_KEY]: { ...record.position },
      ...(record.previous === undefined
        ? {}
        : {
            [PREVIOUS_POSITION_KEY]:
              record.previous === null ? null : { ...record.previous },
          }),
    },
  },
  shape: { shapeType: "CIRCLE", width: 150, height: 150 },
});

/**
 * Token 2, moved to `target` from where it stood at `placed`, whose
 * instance's spawn position was cleared: it moves back on any reconcile.
 */
const clearedSibling = {
  instance: inst(2),
  token: tokenOf(2, target, { position: target, previous: placed }),
  move: { id: "token-2", position: placed },
};

/** The synced record the plan writes for item `id`, if any. */
function syncedWrite(
  plan: SyncPlan,
  id: string,
): Record<string, unknown> | undefined {
  return plan.update.find((u) => u.id === id && u.key === SYNCED_METADATA_KEY)
    ?.value as Record<string, unknown> | undefined;
}

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

describe("planSync previous position", () => {
  it("a new token created in the default row records a null previous position, and one created at its spawn position records none", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target }), inst(2)],
      [],
      config,
      ctx({ placed: [] }),
    );

    const records = plan.add.map(
      (item) => item.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>,
    );
    expect(records).toHaveLength(2);
    expect(Object.hasOwn(records[0]!, PREVIOUS_POSITION_KEY)).toBe(false);
    expect(Object.hasOwn(records[1]!, PREVIOUS_POSITION_KEY)).toBe(true);
    expect(records[1]![PREVIOUS_POSITION_KEY]).toBeNull();
  });

  it("moving a token whose record holds a null previous position records where the token stood before the move", () => {
    const plan = planSync(
      [inst(1, { spawnPosition: target })],
      [tokenOf(1, dragged, { position: placed, previous: null })],
      config,
      ctx({ moves: ["i1"] }),
    );

    expect(plan.move).toEqual([{ id: "token-1", position: target }]);
    expect(syncedWrite(plan, "token-1")).toMatchObject({
      [POSITION_BASELINE_KEY]: target,
      [PREVIOUS_POSITION_KEY]: dragged,
    });
  });

  it("a move of a token already at its target after a retry records its recorded position as the previous position", () => {
    // The move was written to the token, but not its record.
    const plan = planSync(
      [inst(1, { spawnPosition: target })],
      [tokenOf(1, target, { position: placed, previous: null })],
      config,
      ctx({ moves: ["i1"] }),
    );

    expect(plan.move).toEqual([]);
    expect(syncedWrite(plan, "token-1")).toMatchObject({
      [POSITION_BASELINE_KEY]: target,
      [PREVIOUS_POSITION_KEY]: placed,
    });
  });

  it("a later move keeps the recorded previous position", () => {
    const tokens = [tokenOf(1, placed, { position: placed, previous: null })];
    const first = planSync(
      [inst(1, { spawnPosition: target })],
      tokens,
      config,
      ctx({ moves: ["i1"] }),
    );
    const after = applyPlan(tokens, first);

    const later = planSync(
      [inst(1, { spawnPosition: laterTarget })],
      after,
      config,
      ctx({ moves: ["i1"] }),
    );

    expect(later.move).toEqual([{ id: "token-1", position: laterTarget }]);
    expect(syncedWrite(later, "token-1")).toMatchObject({
      [POSITION_BASELINE_KEY]: laterTarget,
      [PREVIOUS_POSITION_KEY]: placed,
    });
  });

  it("a token whose instance's spawn position is cleared moves back to its previous position, and its record then holds that position and a null previous position", () => {
    const plan = planSync(
      [inst(1)],
      [tokenOf(1, target, { position: target, previous: placed })],
      config,
      ctx({ moves: ["i1"] }),
    );

    expect(plan.move).toEqual([{ id: "token-1", position: placed }]);
    const record = syncedWrite(plan, "token-1");
    expect(record?.[POSITION_BASELINE_KEY]).toEqual(placed);
    expect(record && Object.hasOwn(record, PREVIOUS_POSITION_KEY)).toBe(true);
    expect(record?.[PREVIOUS_POSITION_KEY]).toBeNull();
  });

  it("a token whose spawn position was cleared while the extension was away moves back on a snapshot", () => {
    const plan = planSync(
      [inst(1)],
      [tokenOf(1, target, { position: target, previous: placed })],
      config,
      ctx({ snapshot: true }),
    );

    expect(plan.move).toEqual([{ id: "token-1", position: placed }]);
  });

  it("a token already at its previous position is not written when its spawn position is cleared", () => {
    const plan = planSync(
      [inst(1)],
      [tokenOf(1, placed, { position: target, previous: placed })],
      config,
      ctx({ moves: ["i1"] }),
    );

    expect(plan.move).toEqual([]);
    expect(plan.overrides).toEqual([]);
    const record = syncedWrite(plan, "token-1");
    expect(record?.[POSITION_BASELINE_KEY]).toEqual(placed);
    expect(record && Object.hasOwn(record, PREVIOUS_POSITION_KEY)).toBe(true);
    expect(record?.[PREVIOUS_POSITION_KEY]).toBeNull();
  });

  it("moving a token back over a GM drag since the move is listed in overrides", () => {
    const plan = planSync(
      [inst(1)],
      [tokenOf(1, dragged, { position: target, previous: placed })],
      config,
      ctx({ moves: ["i1"] }),
    );

    expect(plan.move).toEqual([{ id: "token-1", position: placed }]);
    expect(plan.overrides).toEqual([{ instanceId: "i1", message: movedNote }]);
  });

  it("moving a token back that is still where it was moved lists no override", () => {
    const plan = planSync(
      [inst(1)],
      [tokenOf(1, target, { position: target, previous: placed })],
      config,
      ctx({ moves: ["i1"] }),
    );

    expect(plan.move).toEqual([{ id: "token-1", position: placed }]);
    expect(plan.overrides).toEqual([]);
  });

  it("a token whose spawn position an mcp change cleared with no previous position recorded moves to a fresh default-row slot, in one row with the batch's new tokens", () => {
    // Encounter order: new token 2 (two cells wide), then token 1, then new
    // token 3 at its own spawn position. The row holds 2 and 1, centred on
    // the viewport: 450 wide, from x 775.
    const plan = planSync(
      [
        inst(2, { footprint: 2 }),
        inst(1),
        inst(3, { spawnPosition: laterTarget }),
      ],
      [tokenOf(1, target, { position: target })],
      config,
      ctx({ moves: ["i1"] }),
    );

    const slotOf1 = { x: 1150, y: 500 };
    expect(plan.move).toEqual([{ id: "token-1", position: slotOf1 }]);
    expect(plan.add.map((item) => item.position)).toEqual([
      { x: 925, y: 500 },
      laterTarget,
    ]);
    const record = syncedWrite(plan, "token-1");
    expect(record?.[POSITION_BASELINE_KEY]).toEqual(slotOf1);
    expect(record && Object.hasOwn(record, PREVIOUS_POSITION_KEY)).toBe(true);
    expect(record?.[PREVIOUS_POSITION_KEY]).toBeNull();
  });

  it("a token with no previous position recorded whose instance has no spawn position is not moved without an mcp change", () => {
    for (const snapshot of [false, true]) {
      const plan = planSync(
        [inst(1), clearedSibling.instance],
        [tokenOf(1, target, { position: target }), clearedSibling.token],
        config,
        ctx({ snapshot, placed: ["i1", "i2"] }),
      );
      expect(plan.move, `snapshot ${String(snapshot)}`).toEqual([
        clearedSibling.move,
      ]);
    }
  });

  it("a token whose record holds a null previous position is not moved when an mcp change clears its spawn position", () => {
    const plan = planSync(
      [inst(1), clearedSibling.instance],
      [
        tokenOf(1, dragged, { position: placed, previous: null }),
        clearedSibling.token,
      ],
      config,
      ctx({ moves: ["i1", "i2"], placed: ["i1", "i2"] }),
    );

    expect(plan.move).toEqual([clearedSibling.move]);
  });
});
