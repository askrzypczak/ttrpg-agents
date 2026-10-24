import { describe, expect, it } from "vitest";
import type { InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { INITIATIVE_METADATA_KEY } from "./initiative.js";
import type { SceneItem } from "./scene-model.js";
import { STAT_BUBBLES_METADATA_KEY } from "./stat-bubbles.js";
import {
  SYNCED_METADATA_KEY,
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
    maxHp: 16,
    currentHp: 10,
    armorClass: 12,
    initiative: 14,
    ...over,
  });

const plan = (
  desired: EncounterInstance[],
  observed: SceneItem[],
  extra: {
    answered?: ReadonlyMap<string, EncounterInstance>;
    sent?: EditMemory;
    placed?: string[];
  } = {},
): SyncPlan =>
  planSync(desired, observed, defaultSyncConfig, {
    viewportCenter: { x: 0, y: 0 },
    placed: new Set(extra.placed ?? ["i1"]),
    art: {},
    ...(extra.answered ? { answered: extra.answered } : {}),
    ...(extra.sent ? { sent: extra.sent } : {}),
  });

const answeredWith = (...instances: EncounterInstance[]) =>
  new Map(instances.map((i) => [i.id, i]));

/** What was sent for instance i1's stat bubbles, as the plan remembers it. */
const sentBubbles = (edit: Omit<InstanceEdit, "instanceId">): EditMemory => ({
  i1: { [STAT_BUBBLES_METADATA_KEY]: edit },
});

const sentOf = (p: SyncPlan): Record<string, unknown> =>
  p.sent.i1?.[STAT_BUBBLES_METADATA_KEY] ?? {};

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
  fields: Record<string, unknown> = {},
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

const bubblesOf = (item: SceneItem): Record<string, unknown> =>
  item.metadata[STAT_BUBBLES_METADATA_KEY] as Record<string, unknown>;
const syncedOf = (item: SceneItem): Record<string, unknown> =>
  item.metadata[SYNCED_METADATA_KEY] as Record<string, unknown>;
const bubbleWrites = (p: SyncPlan) =>
  p.update.filter((u) => u.key === STAT_BUBBLES_METADATA_KEY);

describe("planSync after a write-back answer", () => {
  it("an answered edit pushes nothing when the store value differs from the table", () => {
    const token = editedToken(inst(), { health: 15 });

    const p = plan([inst()], [token], {
      answered: answeredWith(inst()),
      sent: sentBubbles({ currentHp: 15 }),
    });

    expect(bubbleWrites(p)).toEqual([]);
    expect(p.edits).toEqual([]);
    const [after] = applyUpdates([token], p);
    expect(bubblesOf(after!).health).toBe(15);
  });

  it("an answered edit adopts the store value as the baseline in the synced record", () => {
    const token = editedToken(inst(), { health: 15 });
    // The store accepted the edit but clamped it to 12.
    const answer = inst({ currentHp: 12 });

    const p = plan([answer], [token], {
      answered: answeredWith(answer),
      sent: sentBubbles({ currentHp: 15 }),
    });

    const [after] = applyUpdates([token], p);
    expect(syncedOf(after!)[STAT_BUBBLES_METADATA_KEY]).toMatchObject({
      health: 12,
    });
    expect(bubblesOf(after!).health).toBe(15);
  });

  it("a plan after an answer with an unchanged store plans nothing", () => {
    const token = editedToken(inst(), { health: 15 });
    // The store clamped the edit to 12.
    const answer = inst({ currentHp: 12 });
    const first = plan([answer], [token], {
      answered: answeredWith(answer),
      sent: sentBubbles({ currentHp: 15 }),
    });
    const [settled] = applyUpdates([token], first);

    const later = plan([answer], [settled!], { sent: first.sent });

    expect(later.update).toEqual([]);
    expect(later.edits).toEqual([]);
    expect(later.rejected).toEqual([]);
    expect(later.rename).toEqual([]);
    expect(later.differs).toEqual([]);
  });

  it("an MCP change after an answered edit is pushed", () => {
    const token = editedToken(inst(), { health: 15 });
    const answer = inst({ currentHp: 12 });
    const first = plan([answer], [token], {
      answered: answeredWith(answer),
      sent: sentBubbles({ currentHp: 15 }),
    });
    const [settled] = applyUpdates([token], first);

    const later = plan([inst({ currentHp: 7 })], [settled!], {
      sent: first.sent,
    });

    const [after] = applyUpdates([settled!], later);
    expect(bubblesOf(after!).health).toBe(7);
    expect(later.edits).toEqual([]);
  });

  it("a typed value already sent is not planned as an edit again", () => {
    const token = editedToken(inst(), { health: 15, "max health": 20 });

    const p = plan([inst()], [token], {
      sent: sentBubbles({ currentHp: 15, maxHp: 20 }),
    });

    expect(p.edits).toEqual([]);
    expect(sentOf(p)).toEqual({ currentHp: 15, maxHp: 20 });
  });

  it("a different typed value is planned as an edit", () => {
    const token = editedToken(inst(), { health: 15, "max health": 20 });

    const p = plan([inst()], [token], {
      sent: sentBubbles({ currentHp: 12, maxHp: 20 }),
    });

    expect(p.edits).toEqual([{ instanceId: "i1", currentHp: 15 }]);
    expect(sentOf(p)).toEqual({ currentHp: 15, maxHp: 20 });
  });

  it("a value typed after an edit was sent but before its answer is still sent as an edit", () => {
    const token = editedToken(inst(), { health: 7, "max health": 20 });

    // 5 was sent and is awaiting its answer; the GM has typed 7 since.
    const p = plan([inst()], [token], { sent: sentBubbles({ currentHp: 5 }) });

    expect(p.edits).toEqual([{ instanceId: "i1", currentHp: 7, maxHp: 20 }]);
    expect(sentOf(p)).toEqual({ currentHp: 7, maxHp: 20 });
  });

  it("sent memory is cleared when the table matches the store", () => {
    const token = editedToken(inst());

    const p = plan([inst()], [token], {
      sent: sentBubbles({ currentHp: 15 }),
    });

    expect(sentOf(p)).toEqual({});
    expect(p.edits).toEqual([]);
  });

  it("sent memory is cleared when the MCP pushes a new value for the key", () => {
    const token = editedToken(inst(), { health: 15 });

    const p = plan([inst({ currentHp: 12 })], [token], {
      sent: sentBubbles({ currentHp: 15 }),
    });

    expect(sentOf(p)).toEqual({});
    const [after] = applyUpdates([token], p);
    expect(bubblesOf(after!).health).toBe(12);
  });

  it("an answered edit whose table value differs reports a message with the field, store value and table value", () => {
    const token = editedToken(inst(), { health: 15 });

    const p = plan([inst()], [token], {
      answered: answeredWith(inst()),
      sent: sentBubbles({ currentHp: 15 }),
    });

    expect(p.differs).toEqual([
      { instanceId: "i1", message: expect.any(String) },
    ]);
    const { message } = p.differs[0]!;
    expect(message).toContain("HP");
    expect(message).toContain("10");
    expect(message).toContain("15");
    expect(message).toContain("Goblin 2");

    // Several fields of one instance share one message.
    const many = editedToken(inst(), {
      health: 15,
      "max health": 20,
      "armor class": 14,
    });
    const all = plan([inst()], [many], {
      answered: answeredWith(inst()),
      sent: sentBubbles({ currentHp: 15, maxHp: 20, armorClass: 14 }),
    });
    expect(all.differs).toHaveLength(1);
    const text = all.differs[0]!.message;
    expect(text).toContain("max HP");
    expect(text).toContain("armor class");
    for (const value of ["16", "20", "12", "14"]) expect(text).toContain(value);
  });

  it("an answered edit that matches the store reports no difference", () => {
    const token = editedToken(inst(), { health: 5 });
    const answer = inst({ currentHp: 5 });

    const p = plan([answer], [token], {
      answered: answeredWith(answer),
      sent: sentBubbles({ currentHp: 5 }),
    });

    expect(p.differs).toEqual([]);
  });

  it("the initiative key follows its normal rule in an answer", () => {
    // The token holds initiative 14; the answer's snapshot has an MCP-changed 20.
    const token = editedToken(inst(), { health: 5 });
    const answer = inst({ currentHp: 5, initiative: 20 });

    const p = plan([answer], [token], {
      answered: answeredWith(answer),
      sent: sentBubbles({ currentHp: 5 }),
    });

    const [after] = applyUpdates([token], p);
    expect(after!.metadata[INITIATIVE_METADATA_KEY]).toMatchObject({
      count: "20",
    });
  });

  it("an answer for an instance with no token is ignored", () => {
    const other = inst({ id: "i2", displayName: "Goblin 3" });
    const token = editedToken(inst());

    const p = plan([inst(), other], [token], {
      placed: ["i1", "i2"],
      answered: answeredWith(other),
    });

    expect(p.deleted).toEqual(["i2"]);
    expect(p.differs).toEqual([]);
    expect(p.edits).toEqual([]);
    expect(p.update).toEqual([]);
  });

  it("planning an edit leaves the baseline as it was", () => {
    const token = editedToken(inst(), { health: 5, "armor class": 15 });

    const p = plan([inst()], [token]);

    expect(p.edits).toEqual([
      { instanceId: "i1", currentHp: 5, armorClass: 15 },
    ]);
    expect(sentOf(p)).toEqual({ currentHp: 5, armorClass: 15 });
    expect(p.update).toEqual([]);
    const [after] = applyUpdates([token], p);
    expect(syncedOf(after!)).toEqual(syncedOf(token));
  });
});
