import { describe, expect, it } from "vitest";
import { InvalidAmountError, InvalidArmorClassError } from "./errors.js";
import { clampArmorClass, clampHp, resizeMaxHp } from "./hp.js";

const NON_INTEGERS = [1.5, -0.5, Number.NaN, Infinity, -Infinity];

describe("clampHp", () => {
  it("clampHp keeps a value between 0 and max HP", () => {
    expect(clampHp(0, 16)).toBe(0);
    expect(clampHp(7, 16)).toBe(7);
    expect(clampHp(16, 16)).toBe(16);
  });

  it("clampHp raises a negative value to 0 and lowers a value above max HP to max HP", () => {
    expect(clampHp(-1, 16)).toBe(0);
    expect(clampHp(-40, 16)).toBe(0);
    expect(clampHp(17, 16)).toBe(16);
    expect(clampHp(500, 16)).toBe(16);
  });

  it("clampHp rejects fractional, NaN and infinite values with InvalidAmountError", () => {
    for (const bad of NON_INTEGERS) {
      expect(() => clampHp(bad, 16), String(bad)).toThrow(InvalidAmountError);
    }
  });
});

describe("resizeMaxHp", () => {
  it("resizeMaxHp keeps current HP when it still fits the new max", () => {
    expect(resizeMaxHp(10, 20)).toEqual({ maxHp: 20, currentHp: 10 });
    expect(resizeMaxHp(10, 10)).toEqual({ maxHp: 10, currentHp: 10 });
    expect(resizeMaxHp(0, 5)).toEqual({ maxHp: 5, currentHp: 0 });
  });

  it("resizeMaxHp lowers current HP to a smaller new max and never raises it", () => {
    expect(resizeMaxHp(16, 9)).toEqual({ maxHp: 9, currentHp: 9 });
    expect(resizeMaxHp(4, 30)).toEqual({ maxHp: 30, currentHp: 4 });
  });

  it("resizeMaxHp raises a zero or negative max HP to 1", () => {
    expect(resizeMaxHp(16, 0)).toEqual({ maxHp: 1, currentHp: 1 });
    expect(resizeMaxHp(16, -5)).toEqual({ maxHp: 1, currentHp: 1 });
    expect(resizeMaxHp(0, -5)).toEqual({ maxHp: 1, currentHp: 0 });
  });

  it("resizeMaxHp rejects fractional, NaN and infinite values with InvalidAmountError", () => {
    for (const bad of NON_INTEGERS) {
      expect(() => resizeMaxHp(10, bad), String(bad)).toThrow(
        InvalidAmountError,
      );
    }
  });
});

describe("clampArmorClass", () => {
  it("clampArmorClass keeps an integer from 0 up and raises a negative value to 0", () => {
    expect(clampArmorClass(0)).toBe(0);
    expect(clampArmorClass(13)).toBe(13);
    expect(clampArmorClass(30)).toBe(30);
    expect(clampArmorClass(-1)).toBe(0);
    expect(clampArmorClass(-12)).toBe(0);
  });

  it("clampArmorClass rejects fractional, NaN and infinite values with InvalidArmorClassError", () => {
    for (const bad of NON_INTEGERS) {
      expect(() => clampArmorClass(bad), String(bad)).toThrow(
        InvalidArmorClassError,
      );
    }
  });
});
