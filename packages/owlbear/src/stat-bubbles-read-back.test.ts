import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { statBubblesProjector } from "./stat-bubbles.js";
import type { EncounterInstance } from "./sync-plan.js";

const inst = (over: Partial<EncounterInstance> = {}): EncounterInstance =>
  makeTestInstance({ currentHp: 9, maxHp: 27, armorClass: 12, ...over });

const readBack = (value: unknown, instance: EncounterInstance) =>
  statBubblesProjector.readBack!(value, instance);

describe("statBubblesProjector.readBack", () => {
  it("statBubbles readBack maps changed health, max health and armor class to an edit", () => {
    expect(
      readBack(
        { health: 5, "max health": 30, "armor class": 15, hide: true },
        inst(),
      ),
    ).toEqual({
      edit: { currentHp: 5, maxHp: 30, armorClass: 15 },
      invalid: [],
    });
    expect(
      readBack(
        { health: 0, "max health": 27, "armor class": 12, hide: true },
        inst(),
      ),
    ).toEqual({ edit: { currentHp: 0 }, invalid: [] });
  });

  it("statBubbles readBack ignores fields equal to the store and an armor class the instance lacks", () => {
    expect(
      readBack(
        {
          health: 9,
          "max health": 30,
          "armor class": 15,
          "temporary health": 4,
          hide: false,
        },
        inst({ armorClass: null }),
      ),
    ).toEqual({ edit: { maxHp: 30 }, invalid: [] });
    expect(
      readBack(
        { health: 9, "max health": 27, "armor class": 12, hide: false },
        inst(),
      ),
    ).toEqual({ edit: {}, invalid: [] });
  });

  it("statBubbles readBack reports a non-number or non-integer value as invalid", () => {
    const result = readBack(
      { health: "lots", "max health": 27.5, "armor class": 13, hide: true },
      inst(),
    );
    expect(result.edit).toEqual({ armorClass: 13 });
    expect([...result.invalid].sort()).toEqual(["health", "max health"]);

    const nothing = readBack(
      { health: null, "max health": 27, "armor class": "high", hide: true },
      inst(),
    );
    expect(nothing.edit).toEqual({});
    expect([...nothing.invalid].sort()).toEqual(["armor class", "health"]);
  });
});
