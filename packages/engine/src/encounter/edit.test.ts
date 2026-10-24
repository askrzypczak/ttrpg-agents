import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import { applyInstanceEdit } from "./edit.js";
import { UnknownInstanceError } from "./errors.js";
import { clampArmorClass, clampHp, resizeMaxHp } from "./hp.js";
import type { EncounterRepository } from "./repository.js";
import type { MonsterInstance } from "./types.js";

/**
 * An in-memory repository whose HP, max HP and armor class setters follow the
 * documented rules (clamping, UnknownInstanceError for an unknown id).
 */
function memoryRepo(instances: MonsterInstance[]): EncounterRepository & {
  snapshot(): MonsterInstance[];
} {
  const byId = new Map(instances.map((i) => [i.id, { ...i }]));
  const find = (id: string): MonsterInstance => {
    const found = byId.get(id);
    if (!found) throw new UnknownInstanceError(`no instance ${id}`);
    return found;
  };
  const unexpected = () => {
    throw new Error("unexpected call");
  };
  return {
    getOrCreateActiveEncounter: unexpected,
    addInstances: unexpected,
    applyDamage: unexpected,
    applyHealing: unexpected,
    removeInstances: unexpected,
    renameInstance: unexpected,
    setInitiative: unexpected,
    clearEncounter: unexpected,
    setHp: (id, hp) => {
      const before = find(id);
      const after = { ...before, currentHp: clampHp(hp, before.maxHp) };
      byId.set(id, after);
      return { before, after };
    },
    setMaxHp: (id, maxHp) => {
      const before = find(id);
      const after = { ...before, ...resizeMaxHp(before.currentHp, maxHp) };
      byId.set(id, after);
      return { before, after };
    },
    setArmorClass: (id, armorClass) => {
      const after = { ...find(id), armorClass: clampArmorClass(armorClass) };
      byId.set(id, after);
      return after;
    },
    listInstances: () => [...byId.values()].map((i) => ({ ...i })),
    snapshot: () => [...byId.values()].map((i) => ({ ...i })),
  };
}

describe("applyInstanceEdit", () => {
  it("applyInstanceEdit raises max HP before HP so both rise together", () => {
    const repo = memoryRepo([
      makeTestInstance({ id: "i1", maxHp: 16, currentHp: 16 }),
    ]);

    const result = applyInstanceEdit(repo, {
      instanceId: "i1",
      currentHp: 25,
      maxHp: 30,
    });

    expect(result).toMatchObject({ id: "i1", maxHp: 30, currentHp: 25 });
    expect(repo.snapshot()[0]).toMatchObject({ maxHp: 30, currentHp: 25 });
  });

  it("applyInstanceEdit clamps HP above max and a negative armor class", () => {
    const repo = memoryRepo([
      makeTestInstance({
        id: "i1",
        maxHp: 16,
        currentHp: 10,
        armorClass: 12,
      }),
    ]);

    const result = applyInstanceEdit(repo, {
      instanceId: "i1",
      currentHp: 99,
      armorClass: -3,
    });

    expect(result).toMatchObject({
      id: "i1",
      maxHp: 16,
      currentHp: 16,
      armorClass: 0,
    });
    expect(repo.snapshot()[0]).toMatchObject({
      maxHp: 16,
      currentHp: 16,
      armorClass: 0,
    });
  });

  it("applyInstanceEdit throws UnknownInstanceError and changes nothing", () => {
    const repo = memoryRepo([
      makeTestInstance({ id: "i1", maxHp: 16, currentHp: 10, armorClass: 12 }),
    ]);
    const before = repo.snapshot();

    expect(() =>
      applyInstanceEdit(repo, {
        instanceId: "nope",
        currentHp: 5,
        maxHp: 20,
        armorClass: 14,
      }),
    ).toThrow(UnknownInstanceError);
    expect(repo.snapshot()).toEqual(before);
  });
});
