import { describe, expect, it } from "vitest";
import { encounterEventSchema } from "./events.js";
import { monsterInstanceSchema } from "./types.js";

const instance = {
  id: "i1",
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: "Shadow 1",
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  groupId: null,
  createdAt: 5,
};

describe("monsterInstanceSchema", () => {
  it("round-trips a full instance", () => {
    expect(monsterInstanceSchema.parse(instance)).toEqual(instance);
  });

  it("rejects an instance missing a field", () => {
    const withoutMaxHp: Record<string, unknown> = { ...instance };
    delete withoutMaxHp.maxHp;
    expect(monsterInstanceSchema.safeParse(withoutMaxHp).success).toBe(false);
  });

  it("rejects an instance with a wrong type", () => {
    const wrongType = { ...instance, maxHp: "16" };
    expect(monsterInstanceSchema.safeParse(wrongType).success).toBe(false);
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
