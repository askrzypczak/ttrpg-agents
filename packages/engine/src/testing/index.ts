import type { MonsterInstance } from "../encounter/types.js";

/**
 * Test data only. The store generates real instances, so production code must
 * never import this module; the lint config enforces that.
 */
const DEFAULTS: MonsterInstance = {
  id: "i1",
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: "Shadow 1",
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: 1,
  footprint: 1,
};

/**
 * A full `MonsterInstance` for tests: the defaults, with `overrides` replacing
 * any of them. Each call returns a new object.
 */
export function makeTestInstance(
  overrides: Partial<MonsterInstance> = {},
): MonsterInstance {
  return { ...DEFAULTS, ...overrides };
}
