import { describe, expect, it } from "vitest";
import { createEncounterEmitter } from "./events.js";

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
