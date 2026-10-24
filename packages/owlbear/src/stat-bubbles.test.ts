import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { statBubblesProjector } from "./stat-bubbles.js";
import type { EncounterInstance } from "./sync-plan.js";

const inst = (over: Partial<EncounterInstance> = {}): EncounterInstance =>
  makeTestInstance({ currentHp: 9, maxHp: 27, armorClass: 12, ...over });

describe("statBubblesProjector", () => {
  it("projects current HP, max HP and armor class as numbers", () => {
    expect(statBubblesProjector.project(inst())).toEqual({
      health: 9,
      "max health": 27,
      "armor class": 12,
      hide: true,
    });
  });

  it("sets hide true when the token has no stat bubbles value", () => {
    const value = statBubblesProjector.project(inst(), undefined) as Record<
      string,
      unknown
    >;
    expect(value.hide).toBe(true);
  });

  it("omits armor class when neither the instance nor the token has one", () => {
    const value = statBubblesProjector.project(inst({ armorClass: null }), {
      health: 3,
    });
    expect(value).toEqual({ health: 9, "max health": 27, hide: true });
    expect(Object.hasOwn(value as object, "armor class")).toBe(false);
  });

  it("keeps the token's armor class when the instance has none", () => {
    expect(
      statBubblesProjector.project(inst({ armorClass: null }), {
        health: 3,
        "max health": 27,
        "armor class": 15,
        hide: true,
      }),
    ).toEqual({ health: 9, "max health": 27, "armor class": 15, hide: true });
  });

  it("keeps temporary health and unknown fields from the current value", () => {
    expect(
      statBubblesProjector.project(inst(), {
        health: 3,
        "max health": 20,
        "armor class": 10,
        "temporary health": 5,
        hide: true,
        name: "Boss",
        group: 2,
        index: 7,
      }),
    ).toEqual({
      health: 9,
      "max health": 27,
      "armor class": 12,
      "temporary health": 5,
      hide: true,
      name: "Boss",
      group: 2,
      index: 7,
    });
  });

  it("keeps a hide flag the GM changed at the table", () => {
    expect(
      statBubblesProjector.project(inst(), {
        health: 9,
        "max health": 27,
        "armor class": 12,
        hide: false,
      }),
    ).toEqual({ health: 9, "max health": 27, "armor class": 12, hide: false });
  });

  it("falls back to hide true when the current hide is not a boolean", () => {
    for (const hide of ["false", 0, null, {}]) {
      const value = statBubblesProjector.project(inst(), {
        health: 9,
        hide,
      }) as Record<string, unknown>;
      expect(value.hide, JSON.stringify(hide)).toBe(true);
    }
  });

  it("treats an unusable current value as absent", () => {
    const unusable: [string, unknown][] = [
      ["absent", undefined],
      ["null", null],
      ["a string", "hide"],
      ["an array", [false, 15]],
    ];
    for (const [label, current] of unusable) {
      expect(statBubblesProjector.project(inst(), current), label).toEqual({
        health: 9,
        "max health": 27,
        "armor class": 12,
        hide: true,
      });
      expect(
        statBubblesProjector.project(inst({ armorClass: null }), current),
        label,
      ).toEqual({ health: 9, "max health": 27, hide: true });
    }
  });
});
