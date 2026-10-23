import { describe, expect, it } from "vitest";
import { monsterInstanceSchema } from "../encounter/types.js";
import { makeTestInstance } from "./index.js";

describe("makeTestInstance", () => {
  it("makeTestInstance returns an instance that parses with monsterInstanceSchema", () => {
    const instance = makeTestInstance();
    expect(monsterInstanceSchema.parse(instance)).toEqual(instance);
  });

  it("makeTestInstance lets overrides replace defaults and leaves other keys at their defaults", () => {
    expect(makeTestInstance({ displayName: "Boss", maxHp: 30 })).toEqual({
      id: "i1",
      encounterId: "e1",
      monsterKey: "shadow",
      displayName: "Boss",
      maxHp: 30,
      currentHp: 16,
      initiative: null,
      armorClass: null,
      groupId: null,
      createdAt: 1,
    });
  });
});
