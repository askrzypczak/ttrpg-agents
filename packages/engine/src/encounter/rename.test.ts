import { describe, expect, it } from "vitest";
import { InvalidNameError } from "./errors.js";
import {
  createEncounterEmitter,
  observeRepository,
  type EncounterEvent,
} from "./events.js";
import { validateInstanceName } from "./rename.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

describe("validateInstanceName", () => {
  it("trims the name", () => {
    expect(validateInstanceName("  Boss  ", ["Shadow 2"])).toBe("Boss");
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(() => validateInstanceName("", [])).toThrow(InvalidNameError);
    expect(() => validateInstanceName("  \t ", [])).toThrow(InvalidNameError);
  });

  it("rejects a name another instance has", () => {
    const others = ["Shadow 2", "Shadow 3"];
    expect(() => validateInstanceName("Shadow 2", others)).toThrow(
      InvalidNameError,
    );
    expect(() => validateInstanceName(" Shadow 3 ", others)).toThrow(
      InvalidNameError,
    );
  });

  it("allows the instance's own current name", () => {
    // The caller passes only the other instances' names.
    expect(validateInstanceName("Shadow 1", ["Shadow 2"])).toBe("Shadow 1");
  });
});

describe("observeRepository", () => {
  it("`observeRepository.renameInstance` delegates and returns the repo's result without emitting", () => {
    const renamed: MonsterInstance = {
      id: "i1",
      encounterId: "e1",
      monsterKey: "shadow",
      displayName: "Boss",
      maxHp: 16,
      currentHp: 16,
      initiative: null,
      groupId: null,
      createdAt: 1,
    };
    const calls: [string, string][] = [];
    const unexpected = () => {
      throw new Error("unexpected call");
    };
    const inner: EncounterRepository = {
      getOrCreateActiveEncounter: unexpected,
      addInstances: unexpected,
      applyDamage: unexpected,
      applyHealing: unexpected,
      removeInstances: unexpected,
      clearEncounter: unexpected,
      listInstances: unexpected,
      renameInstance: (id, name) => {
        calls.push([id, name]);
        return renamed;
      },
    };
    const emitter = createEncounterEmitter();
    const events: EncounterEvent[] = [];
    emitter.subscribe((e) => events.push(e));

    const result = observeRepository(inner, emitter).renameInstance(
      "i1",
      "Boss",
    );

    expect(result).toBe(renamed);
    expect(calls).toEqual([["i1", "Boss"]]);
    expect(events).toEqual([]);
  });
});
