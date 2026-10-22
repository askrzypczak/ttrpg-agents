import { describe, expect, it } from "vitest";
import { INITIATIVE_METADATA_KEY, initiativeProjector } from "./initiative.js";
import type { EncounterInstance } from "./sync-plan.js";

const inst = (initiative: number | null): EncounterInstance => ({
  id: "i1",
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: "Shadow 1",
  maxHp: 16,
  currentHp: 16,
  initiative,
  groupId: null,
  createdAt: 1,
});

describe("initiativeProjector", () => {
  it("projects the count as a string with active false", () => {
    expect(initiativeProjector.project(inst(14))).toEqual({
      count: "14",
      active: false,
    });
  });

  it("count is a string for 0 and negative initiative", () => {
    expect(initiativeProjector.project(inst(0))).toEqual({
      count: "0",
      active: false,
    });
    expect(initiativeProjector.project(inst(-2))).toEqual({
      count: "-2",
      active: false,
    });
  });

  it("projects undefined for a null initiative", () => {
    expect(initiativeProjector.project(inst(null))).toBeUndefined();
  });

  it("the initiative projector keeps active true from the token's current value", () => {
    expect(
      initiativeProjector.project(inst(14), { count: "10", active: true }),
    ).toEqual({ count: "14", active: true });
  });

  it("the initiative projector gives active false when the token has no usable current value", () => {
    const unusable: [string, unknown][] = [
      ["absent", undefined],
      ["null", null],
      ["a string", "active"],
      ["an array", [true]],
      ["an empty object", {}],
      ["active false", { count: "10", active: false }],
      ["active as the string true", { count: "10", active: "true" }],
    ];
    for (const [label, current] of unusable) {
      expect(initiativeProjector.project(inst(14), current), label).toEqual({
        count: "14",
        active: false,
      });
    }
  });

  it("uses the tracker's exact metadata key", () => {
    expect(INITIATIVE_METADATA_KEY).toBe(
      "rodeo.owlbear.initiative-tracker/metadata",
    );
    expect(initiativeProjector.key).toBe(
      "rodeo.owlbear.initiative-tracker/metadata",
    );
    expect(initiativeProjector.mode).toBe("owned");
  });
});
