import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { statBubblesProjector } from "./stat-bubbles.js";

const instance = makeTestInstance({ currentHp: 9, maxHp: 27, armorClass: 12 });
const readBack = (value: unknown) =>
  statBubblesProjector.readBack!(value, instance);

describe("statBubblesProjector.readBack values", () => {
  it("statBubbles readBack reports a fractional number and a string as invalid, each alone", () => {
    expect(readBack({ health: 7.5 })).toEqual({
      edit: {},
      invalid: ["health"],
    });
    expect(readBack({ "max health": "30" })).toEqual({
      edit: {},
      invalid: ["max health"],
    });
    expect(readBack({ "armor class": NaN })).toEqual({
      edit: {},
      invalid: ["armor class"],
    });
  });

  it("statBubbles readBack reports a whole number beyond the safe integer range as invalid", () => {
    expect(readBack({ health: 1e20 })).toEqual({
      edit: {},
      invalid: ["health"],
    });
    // Control: the largest safe integer is read back.
    expect(readBack({ health: Number.MAX_SAFE_INTEGER })).toEqual({
      edit: { currentHp: Number.MAX_SAFE_INTEGER },
      invalid: [],
    });
  });
});
