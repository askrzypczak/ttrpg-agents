import { describe, expect, it } from "vitest";
import type { InstanceEdit } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { EDIT_SETTLE_MS, createEditSettler } from "./edit-settle.js";
import type { Timers } from "./reconnecting-socket.js";
import type { EncounterInstance } from "./sync-plan.js";

/** Timers on a fake clock that only moves when `advance` is called. */
class FakeTimers implements Timers {
  private now = 0;
  private next = 1;
  private readonly pending = new Map<number, { fn: () => void; at: number }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, at: this.now + ms });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  /** Moves the clock forward, firing due timers in order. */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (due === undefined) break;
      const [id, t] = due;
      this.pending.delete(id);
      this.now = t.at;
      t.fn();
    }
    this.now = end;
  }
  pendingCount(): number {
    return this.pending.size;
  }
}

const inst = (id: string): EncounterInstance =>
  makeTestInstance({ id, maxHp: 16, currentHp: 10, armorClass: 12 });

function setup() {
  const timers = new FakeTimers();
  const sent: InstanceEdit[] = [];
  const settler = createEditSettler({
    timers,
    settleMs: EDIT_SETTLE_MS,
    send: (edit) => sent.push(edit),
  });
  return { timers, sent, settler };
}

const hpOf = (instances: EncounterInstance[], id: string) =>
  instances.find((i) => i.id === id)?.currentHp;

describe("createEditSettler", () => {
  it("an edit put back to the store's value sends nothing", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    expect(hpOf(settler.overlay(desired), "i1")).toBe(5);

    settler.observe([{ instanceId: "i1", currentHp: 10 }], desired);
    timers.advance(EDIT_SETTLE_MS * 2);

    expect(sent).toEqual([]);
    expect(hpOf(settler.overlay(desired), "i1")).toBe(10);
    expect(timers.pendingCount()).toBe(0);
  });

  it("each edit restarts the period", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(EDIT_SETTLE_MS - 100);
    settler.observe([{ instanceId: "i1", currentHp: 7 }], desired);
    timers.advance(EDIT_SETTLE_MS - 100);
    expect(sent).toEqual([]);

    timers.advance(100);
    expect(sent).toEqual([{ instanceId: "i1", currentHp: 7 }]);
  });

  it("different fields of one instance are sent together", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(100);
    settler.observe([{ instanceId: "i1", maxHp: 20 }], desired);
    timers.advance(EDIT_SETTLE_MS);

    expect(sent).toEqual([{ instanceId: "i1", currentHp: 5, maxHp: 20 }]);
  });

  it("instances settle separately", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1"), inst("i2")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(300);
    settler.observe([{ instanceId: "i2", currentHp: 3 }], desired);
    timers.advance(EDIT_SETTLE_MS - 300);
    expect(sent).toEqual([{ instanceId: "i1", currentHp: 5 }]);

    timers.advance(300);
    expect(sent).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i2", currentHp: 3 },
    ]);
  });

  it("an answer for an unrelated instance leaves the sent edit shown", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1"), inst("i2")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(EDIT_SETTLE_MS);
    expect(sent).toHaveLength(1);

    settler.answered("i2");
    expect(hpOf(settler.overlay(desired), "i1")).toBe(5);

    settler.answered("i1");
    expect(hpOf(settler.overlay(desired), "i1")).toBe(10);
  });

  it("a new edit after a send sends only the new fields", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(EDIT_SETTLE_MS);
    settler.observe([{ instanceId: "i1", maxHp: 20 }], desired);
    timers.advance(EDIT_SETTLE_MS);

    expect(sent).toEqual([
      { instanceId: "i1", currentHp: 5 },
      { instanceId: "i1", maxHp: 20 },
    ]);
  });

  it("an instance that leaves the encounter drops its pending edit and timer", () => {
    const { timers, sent, settler } = setup();
    settler.observe([{ instanceId: "i1", currentHp: 5 }], [inst("i1")]);

    expect(settler.overlay([])).toEqual([]);
    expect(timers.pendingCount()).toBe(0);
    timers.advance(EDIT_SETTLE_MS * 2);
    expect(sent).toEqual([]);
    expect(hpOf(settler.overlay([inst("i1")]), "i1")).toBe(10);
  });
});
