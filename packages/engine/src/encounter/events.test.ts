import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import {
  createEncounterEmitter,
  observeRepository,
  type EncounterEvent,
} from "./events.js";
import type { EncounterRepository } from "./repository.js";

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

describe("observeRepository", () => {
  it("observeRepository forwards setStatsVisible to the store and emits no event", () => {
    const calls: [string, boolean][] = [];
    const unexpected = () => {
      throw new Error("unexpected call");
    };
    const inner: EncounterRepository = {
      getOrCreateActiveEncounter: unexpected,
      addInstances: unexpected,
      applyDamage: unexpected,
      applyHealing: unexpected,
      removeInstances: unexpected,
      renameInstance: unexpected,
      setInitiative: unexpected,
      setHp: unexpected,
      setMaxHp: unexpected,
      setArmorClass: unexpected,
      clearEncounter: unexpected,
      listInstances: unexpected,
      setStatsVisible: (id, visible) => {
        calls.push([id, visible]);
        return makeTestInstance({ id, statsVisible: visible });
      },
    };
    const emitter = createEncounterEmitter();
    const events: EncounterEvent[] = [];
    emitter.subscribe((e) => events.push(e));
    const repo = observeRepository(inner, emitter);

    expect(repo.setStatsVisible("i7", true)).toEqual(
      makeTestInstance({ id: "i7", statsVisible: true }),
    );
    expect(repo.setStatsVisible("i7", false)).toEqual(
      makeTestInstance({ id: "i7", statsVisible: false }),
    );
    expect(calls).toEqual([
      ["i7", true],
      ["i7", false],
    ]);
    expect(events).toEqual([]);
  });
});
