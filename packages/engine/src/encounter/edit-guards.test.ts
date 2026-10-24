import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import { applyInstanceEdit } from "./edit.js";
import { UnknownInstanceError } from "./errors.js";
import type { EncounterRepository } from "./repository.js";

/** A repository of several instances that records which setters were called. */
function recordingRepo() {
  const calls: string[] = [];
  const instances = [
    makeTestInstance({ id: "i1", maxHp: 16, currentHp: 10, armorClass: 12 }),
    makeTestInstance({ id: "i2", maxHp: 20, currentHp: 20, armorClass: 14 }),
  ];
  const repo = {
    listInstances: () => instances,
    setHp: (id: string) => {
      calls.push(`hp:${id}`);
    },
    setMaxHp: (id: string) => {
      calls.push(`maxHp:${id}`);
    },
    setArmorClass: (id: string) => {
      calls.push(`ac:${id}`);
    },
  } as unknown as EncounterRepository;
  return { repo, calls };
}

describe("applyInstanceEdit guards", () => {
  it("applyInstanceEdit calls only the setters for the fields given", () => {
    const { repo, calls } = recordingRepo();

    applyInstanceEdit(repo, { instanceId: "i2", armorClass: 15 });
    expect(calls).toEqual(["ac:i2"]);

    calls.length = 0;
    applyInstanceEdit(repo, { instanceId: "i1", currentHp: 3 });
    expect(calls).toEqual(["hp:i1"]);

    calls.length = 0;
    applyInstanceEdit(repo, { instanceId: "i1", maxHp: 30 });
    expect(calls).toEqual(["maxHp:i1"]);
  });

  it("applyInstanceEdit with an unknown id among several instances throws before any setter runs", () => {
    const { repo, calls } = recordingRepo();

    expect(() =>
      applyInstanceEdit(repo, {
        instanceId: "nope",
        currentHp: 1,
        maxHp: 2,
        armorClass: 3,
      }),
    ).toThrow(UnknownInstanceError);
    expect(calls).toEqual([]);
  });

  it("applyInstanceEdit returns the edited instance, not another one", () => {
    const { repo } = recordingRepo();

    expect(applyInstanceEdit(repo, { instanceId: "i2", maxHp: 5 }).id).toBe(
      "i2",
    );
  });
});
