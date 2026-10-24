import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import { encounterEventSchema } from "./events.js";
import { monsterInstanceSchema } from "./types.js";

const instance = makeTestInstance({ createdAt: 5 });

describe("monsterInstanceSchema", () => {
  it("round-trips a full instance", () => {
    expect(monsterInstanceSchema.parse(instance)).toEqual(instance);
  });

  it("rejects an instance missing a field", () => {
    const withoutMaxHp: Record<string, unknown> = { ...instance };
    delete withoutMaxHp.maxHp;
    expect(monsterInstanceSchema.safeParse(withoutMaxHp).success).toBe(false);
  });

  it("monsterInstanceSchema requires armorClass and accepts null", () => {
    expect(
      monsterInstanceSchema.parse({ ...instance, armorClass: 13 }),
    ).toEqual({ ...instance, armorClass: 13 });
    expect(
      monsterInstanceSchema.parse({ ...instance, armorClass: null }),
    ).toEqual({ ...instance, armorClass: null });
    const withoutArmorClass: Record<string, unknown> = { ...instance };
    delete withoutArmorClass.armorClass;
    expect(monsterInstanceSchema.safeParse(withoutArmorClass).success).toBe(
      false,
    );
  });

  it("rejects an instance with a wrong type", () => {
    const wrongType = { ...instance, maxHp: "16" };
    expect(monsterInstanceSchema.safeParse(wrongType).success).toBe(false);
  });

  it("monsterInstanceSchema defaults a missing footprint to 1", () => {
    const withoutFootprint: Record<string, unknown> = { ...instance };
    delete withoutFootprint.footprint;
    expect(monsterInstanceSchema.parse(withoutFootprint)).toEqual({
      ...instance,
      footprint: 1,
    });
  });

  it("monsterInstanceSchema rejects a footprint below 1 or non-integer", () => {
    for (const footprint of [0, -1, 1.5]) {
      expect(
        monsterInstanceSchema.safeParse({ ...instance, footprint }).success,
      ).toBe(false);
    }
    expect(monsterInstanceSchema.parse({ ...instance, footprint: 2 })).toEqual({
      ...instance,
      footprint: 2,
    });
  });
});

describe("encounterEventSchema", () => {
  it.each([
    ["added", { type: "added", instances: [instance] }],
    ["removed", { type: "removed", id: "i1" }],
    ["cleared", { type: "cleared" }],
    ["hp-changed", { type: "hp-changed", id: "i1", currentHp: 3, maxHp: 16 }],
  ])("parses a %s event unchanged", (_kind, event) => {
    expect(encounterEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    ["an unknown type", { type: "exploded" }],
    [
      "an added with a malformed instance",
      { type: "added", instances: [{ id: "x" }] },
    ],
    ["a removed without id", { type: "removed" }],
    [
      "an hp-changed missing maxHp",
      { type: "hp-changed", id: "i1", currentHp: 3 },
    ],
  ])("rejects %s", (_name, event) => {
    expect(encounterEventSchema.safeParse(event).success).toBe(false);
  });
});
