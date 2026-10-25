import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { INITIATIVE_METADATA_KEY, initiativeProjector } from "./initiative.js";
import type { EncounterInstance } from "./sync-plan.js";

const inst = (initiative: number | null): EncounterInstance =>
  makeTestInstance({ initiative });

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

  describe("readBack", () => {
    const read = (value: unknown, initiative: number | null = 10) =>
      initiativeProjector.readBack!(value, inst(initiative));

    it('readBack maps count "14" to initiative 14', () => {
      expect(read({ count: "14", active: false })).toEqual({
        edit: { initiative: 14 },
        invalid: [],
      });
    });

    it("readBack trims and accepts a signed count", () => {
      expect(read({ count: " 14 " }).edit).toEqual({ initiative: 14 });
      expect(read({ count: "+14" }).edit).toEqual({ initiative: 14 });
      expect(read({ count: "-2" }).edit).toEqual({ initiative: -2 });
      expect(read({ count: "0" }).edit).toEqual({ initiative: 0 });
    });

    it("readBack reports an empty, non-numeric or decimal count as invalid and returns no edit", () => {
      const unreadable: unknown[] = [
        "",
        "   ",
        "abc",
        "1.5",
        "14a",
        "--2",
        14,
        null,
        undefined,
      ];
      for (const count of unreadable) {
        expect(read({ count, active: false }), String(count)).toEqual({
          edit: {},
          invalid: ["count"],
        });
      }
    });

    it("readBack returns no edit for a count equal to the stored initiative", () => {
      expect(read({ count: "10", active: true })).toEqual({
        edit: {},
        invalid: [],
      });
      expect(read({ count: "+10" })).toEqual({ edit: {}, invalid: [] });
    });

    it("readBack of an absent tracker value clears a stored initiative", () => {
      expect(read(undefined)).toEqual({
        edit: { initiative: null },
        invalid: [],
      });
      expect(read(null).edit).toEqual({ initiative: null });
      expect(read(undefined, 0).edit).toEqual({ initiative: null });

      // Control: nothing stored, nothing to clear.
      expect(read(undefined, null)).toEqual({ edit: {}, invalid: [] });
    });

    it("readBack adopts a count for an instance with no initiative", () => {
      expect(read({ count: "3", active: false }, null)).toEqual({
        edit: { initiative: 3 },
        invalid: [],
      });
      expect(read({ count: "0", active: false }, null).edit).toEqual({
        initiative: 0,
      });
    });
  });
});
