import { describe, expect, it } from "vitest";
import { changeOriginSchema, type ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";

/** Records the origin each mutation receives. */
function recordingRepository(received: unknown[]): EncounterRepository {
  const record = (origin: unknown): never => {
    received.push(origin);
    return undefined as never;
  };
  return {
    getOrCreateActiveEncounter: () => undefined as never,
    listInstances: () => [],
    addInstances: (_build, origin) => record(origin),
    applyDamage: (_id, _amount, origin) => record(origin),
    applyHealing: (_id, _amount, origin) => record(origin),
    removeInstances: (_ids, origin) => record(origin),
    listRemovedInstances: () => [],
    restoreInstances: (_ids, _name, origin) => record(origin),
    renameInstance: (_id, _name, origin) => record(origin),
    setInitiative: (_id, _initiative, origin) => record(origin),
    setHp: (_id, _hp, origin) => record(origin),
    setMaxHp: (_id, _maxHp, origin) => record(origin),
    setArmorClass: (_id, _armorClass, origin) => record(origin),
    setStatsVisible: (_id, _visible, origin) => record(origin),
    clearEncounter: (origin) => void record(origin),
  };
}

describe("EncounterRepository mutations", () => {
  it("a repository mutation called without an origin is a type error", () => {
    const received: unknown[] = [];
    const repo = recordingRepository(received);
    const origin: ChangeOrigin = { source: "mcp", commandId: "c1" };

    // The type half is checked by `npm run typecheck`: each call below must
    // be rejected by the compiler (an unused directive is itself an error).
    const withoutOrigin: (() => unknown)[] = [
      // @ts-expect-error origin is required
      () => repo.addInstances(() => []),
      // @ts-expect-error origin is required
      () => repo.applyDamage("i1", 1),
      // @ts-expect-error origin is required
      () => repo.applyHealing("i1", 1),
      // @ts-expect-error origin is required
      () => repo.removeInstances(["i1"]),
      // @ts-expect-error origin is required
      () => repo.restoreInstances(["i1"], (i) => i.displayName),
      // @ts-expect-error origin is required
      () => repo.renameInstance("i1", "Boss"),
      // @ts-expect-error origin is required
      () => repo.setInitiative("i1", 5),
      // @ts-expect-error origin is required
      () => repo.setHp("i1", 5),
      // @ts-expect-error origin is required
      () => repo.setMaxHp("i1", 5),
      // @ts-expect-error origin is required
      () => repo.setArmorClass("i1", 5),
      // @ts-expect-error origin is required
      () => repo.setStatsVisible("i1", true),
      // @ts-expect-error origin is required
      () => repo.clearEncounter(),
    ];
    expect(withoutOrigin).toHaveLength(12);

    // Runtime half: with an origin, every mutation hands it on unchanged.
    repo.addInstances(() => [], origin);
    repo.applyDamage("i1", 1, origin);
    repo.applyHealing("i1", 1, origin);
    repo.removeInstances(["i1"], origin);
    repo.restoreInstances(["i1"], (i) => i.displayName, origin);
    repo.renameInstance("i1", "Boss", origin);
    repo.setInitiative("i1", 5, origin);
    repo.setHp("i1", 5, origin);
    repo.setMaxHp("i1", 5, origin);
    repo.setArmorClass("i1", 5, origin);
    repo.setStatsVisible("i1", true, origin);
    repo.clearEncounter(origin);
    expect(received).toEqual(Array<ChangeOrigin>(12).fill(origin));
    expect(changeOriginSchema.safeParse(received[0]).success).toBe(true);
  });
});
