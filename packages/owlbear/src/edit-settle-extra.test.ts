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

describe("createEditSettler edge cases", () => {
  it("an edit for an instance that is not in the encounter is ignored", () => {
    const { timers, sent, settler } = setup();
    settler.observe([{ instanceId: "gone", currentHp: 5 }], [inst("i1")]);

    expect(timers.pendingCount()).toBe(0);
    timers.advance(EDIT_SETTLE_MS);
    expect(sent).toEqual([]);
  });

  it("an edit is judged against its own instance's value", () => {
    const { timers, sent, settler } = setup();
    const other = makeTestInstance({ id: "i2", currentHp: 3, maxHp: 16 });
    settler.observe([{ instanceId: "i2", currentHp: 3 }], [inst("i1"), other]);

    expect(timers.pendingCount()).toBe(0);
    timers.advance(EDIT_SETTLE_MS);
    expect(sent).toEqual([]);
  });

  it("seeing the same edit again does not restart the period", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(300);
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(EDIT_SETTLE_MS - 300);

    expect(sent).toEqual([{ instanceId: "i1", currentHp: 5 }]);
  });

  it("an edit equal to the store's value changes nothing", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 10 }], desired);

    expect(timers.pendingCount()).toBe(0);
    timers.advance(EDIT_SETTLE_MS);
    expect(sent).toEqual([]);
  });

  it("putting one field back keeps the other and restarts the period", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5, maxHp: 20 }], desired);
    timers.advance(300);
    settler.observe([{ instanceId: "i1", currentHp: 10 }], desired);
    timers.advance(EDIT_SETTLE_MS - 100);
    expect(sent).toEqual([]);

    timers.advance(100);
    expect(sent).toEqual([{ instanceId: "i1", maxHp: 20 }]);
  });

  it("an edit judged against the sent value is dropped when it matches it", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(EDIT_SETTLE_MS);

    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    expect(timers.pendingCount()).toBe(0);
    timers.advance(EDIT_SETTLE_MS);
    expect(sent).toHaveLength(1);
  });

  it("the overlay keeps showing a pending edit on every call", () => {
    const { settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);

    expect(hpOf(settler.overlay(desired), "i1")).toBe(5);
    expect(hpOf(settler.overlay(desired), "i1")).toBe(5);
  });

  it("an instance that leaves after its edit was sent forgets it", () => {
    const { timers, settler } = setup();
    settler.observe([{ instanceId: "i1", currentHp: 5 }], [inst("i1")]);
    timers.advance(EDIT_SETTLE_MS);

    settler.overlay([]);
    expect(hpOf(settler.overlay([inst("i1")]), "i1")).toBe(10);
  });

  it("an answer while an edit still settles keeps it and its timer", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    settler.answered();

    expect(hpOf(settler.overlay(desired), "i1")).toBe(5);
    timers.advance(EDIT_SETTLE_MS);
    expect(sent).toEqual([{ instanceId: "i1", currentHp: 5 }]);
  });

  it("an edit put back after the answer leaves no timer", () => {
    const { timers, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(EDIT_SETTLE_MS);
    settler.answered();
    settler.observe([{ instanceId: "i1", currentHp: 7 }], desired);
    settler.observe([{ instanceId: "i1", currentHp: 10 }], desired);

    expect(timers.pendingCount()).toBe(0);
    expect(hpOf(settler.overlay(desired), "i1")).toBe(10);
  });

  it("an answered edit is forgotten even when a pending one is dropped later", () => {
    const { timers, sent, settler } = setup();
    const desired = [inst("i1")];
    settler.observe([{ instanceId: "i1", currentHp: 5 }], desired);
    timers.advance(EDIT_SETTLE_MS);
    settler.answered("i1");
    timers.advance(EDIT_SETTLE_MS);

    expect(sent).toHaveLength(1);
    expect(hpOf(settler.overlay(desired), "i1")).toBe(10);
  });
});
