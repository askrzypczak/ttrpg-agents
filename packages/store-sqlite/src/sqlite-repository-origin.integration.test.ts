import { describe, expect, it } from "vitest";
import { changeOriginSchema, type ChangeOrigin } from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

describe("SqliteEncounterRepository mutations", () => {
  it("a repository mutation called without an origin is a type error", () => {
    const repo = new SqliteEncounterRepository(openDatabase(":memory:"));
    const origin: ChangeOrigin = { source: "table", commandId: "c1" };

    // The type half is checked by `npm run typecheck`: each call below must
    // be rejected by the compiler (an unused directive is itself an error).
    // The calls are never run.
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
    expect(withoutOrigin).toHaveLength(11);

    // Runtime half: the origin a caller passes is a valid one, and the store
    // accepts a mutation that carries it.
    expect(changeOriginSchema.safeParse(origin).success).toBe(true);
    const [created] = repo.addInstances(
      () => [{ monsterKey: "shadow", displayName: "Shadow 1", maxHp: 16 }],
      origin,
    );
    expect(repo.setHp(created!.id, 5, origin).after.currentHp).toBe(5);
  });
});

describe("SqliteEncounterRepository change log", () => {
  it("a change-log write that fails rolls the mutation back", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteEncounterRepository(db);
    const seed: ChangeOrigin = { source: "table", commandId: "seed" };
    const [, damaged] = repo.addInstances(
      () => [
        { monsterKey: "goblin", displayName: "Goblin 1", maxHp: 7 },
        { monsterKey: "goblin", displayName: "Goblin 2", maxHp: 7 },
      ],
      seed,
    );
    repo.applyDamage(damaged!.id, 3, seed);
    const before = repo.listInstances();
    db.exec("DROP TABLE encounter_events");

    expect(() => repo.applyDamage(damaged!.id, 1, seed)).toThrow();
    expect(() => repo.setHp(damaged!.id, 1, seed)).toThrow();
    expect(() => repo.clearEncounter(seed)).toThrow();

    expect(repo.listInstances()).toEqual(before);
    expect(repo.listInstances().map((i) => i.currentHp)).toEqual([7, 4]);
  });
});
