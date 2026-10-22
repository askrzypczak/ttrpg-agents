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
