import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { statBubblesProjector } from "./stat-bubbles.js";

const instance = makeTestInstance({ currentHp: 9, maxHp: 27, armorClass: 12 });
const invert = (value: unknown) =>
  statBubblesProjector.invert!(value, instance);

describe("statBubblesProjector.invert values", () => {
  it("statBubbles invert reports a fractional number and a string as invalid, each alone", () => {
    expect(invert({ health: 7.5 })).toEqual({ edit: {}, invalid: ["health"] });
    expect(invert({ "max health": "30" })).toEqual({
      edit: {},
      invalid: ["max health"],
    });
    expect(invert({ "armor class": NaN })).toEqual({
      edit: {},
      invalid: ["armor class"],
    });
  });
});
