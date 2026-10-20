import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { UnknownInstanceError } from "./errors.js";
import {
  createEncounterEmitter,
  observeRepository,
  type EncounterEvent,
} from "./events.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

function setup() {
  let n = 0;
  const inner = new SqliteEncounterRepository(openDatabase(":memory:"), {
    newId: () => `id-${++n}`,
    now: () => 1000,
  });
  const emitter = createEncounterEmitter();
  const events: EncounterEvent[] = [];
  emitter.subscribe((e) => events.push(e));
  return { repo: observeRepository(inner, emitter), events };
}

const shadow = (displayName = "Shadow 1") => ({
  monsterKey: "shadow",
  displayName,
  maxHp: 16,
});

describe("observeRepository", () => {
  it("emits added with the created instances", () => {
    const { repo, events } = setup();
    const created = repo.addInstances(() => [
      shadow("Shadow 1"),
      shadow("Shadow 2"),
    ]);
    expect(events).toEqual([{ type: "added", instances: created }]);
    expect(created.map((i) => i.displayName)).toEqual(["Shadow 1", "Shadow 2"]);
  });

  it("does not emit added for an empty batch", () => {
    const { repo, events } = setup();
    repo.addInstances(() => []);
    expect(events).toEqual([]);
  });

  it("observeRepository emits hp-changed from the after instance", () => {
    const { repo, events } = setup();
    const [a] = repo.addInstances(() => [shadow()]);
    events.length = 0;
    const hit = repo.applyDamage(a!.id, 6);
    const healed = repo.applyHealing(a!.id, 2);
    expect(hit.before.currentHp).toBe(16);
    expect(hit.after.currentHp).toBe(10);
    expect(healed.before.currentHp).toBe(10);
    expect(healed.after.currentHp).toBe(12);
    expect(events).toEqual([
      { type: "hp-changed", id: a!.id, currentHp: 10, maxHp: 16 },
      { type: "hp-changed", id: a!.id, currentHp: 12, maxHp: 16 },
    ]);
  });

  it("emits nothing when damage throws", () => {
    const { repo, events } = setup();
    expect(() => repo.applyDamage("nope", 3)).toThrow();
    expect(events).toEqual([]);
  });

  it("observeRepository emits removed for each id from removeInstances and nothing on failure", () => {
    const { repo, events } = setup();
    const [a, b, c] = repo.addInstances(() => [
      shadow("Shadow 1"),
      shadow("Shadow 2"),
      shadow("Shadow 3"),
    ]);
    events.length = 0;
    expect(() => repo.removeInstances([a!.id, "missing"])).toThrow(
      UnknownInstanceError,
    );
    expect(events).toEqual([]);
    expect(repo.removeInstances([a!.id, c!.id])).toEqual([a, c]);
    expect(events).toEqual([
      { type: "removed", id: a!.id },
      { type: "removed", id: c!.id },
    ]);
    expect(repo.listInstances()).toEqual([b]);
  });

  it("emits cleared and the underlying store is cleared", () => {
    const { repo, events } = setup();
    repo.addInstances(() => [shadow()]);
    events.length = 0;
    repo.clearEncounter();
    expect(events).toEqual([{ type: "cleared" }]);
    expect(repo.listInstances()).toEqual([]);
  });

  it("delegates reads without emitting", () => {
    const { repo, events } = setup();
    repo.addInstances(() => [shadow()]);
    events.length = 0;
    expect(repo.listInstances()).toHaveLength(1);
    repo.getOrCreateActiveEncounter();
    expect(events).toEqual([]);
  });
});

describe("createEncounterEmitter", () => {
  it("calls listeners in subscription order", () => {
    const emitter = createEncounterEmitter();
    const calls: string[] = [];
    emitter.subscribe(() => calls.push("a"));
    emitter.subscribe(() => calls.push("b"));
    emitter.emit({ type: "cleared" });
    expect(calls).toEqual(["a", "b"]);
  });

  it("stops calling a listener after unsubscribe", () => {
    const emitter = createEncounterEmitter();
    const calls: string[] = [];
    const off = emitter.subscribe(() => calls.push("a"));
    emitter.emit({ type: "cleared" });
    off();
    emitter.emit({ type: "cleared" });
    expect(calls).toEqual(["a"]);
  });

  it("isolates a throwing listener from the others", () => {
    const emitter = createEncounterEmitter();
    const calls: string[] = [];
    emitter.subscribe(() => {
      throw new Error("boom");
    });
    emitter.subscribe(() => calls.push("ok"));
    expect(() => emitter.emit({ type: "cleared" })).not.toThrow();
    expect(calls).toEqual(["ok"]);
  });
});
