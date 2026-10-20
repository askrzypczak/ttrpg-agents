import { describe, expect, it } from "vitest";
import { nextDelay } from "./backoff.js";

const noJitter = { random: () => 0 };

describe("nextDelay", () => {
  it("grows exponentially", () => {
    const d = [0, 1, 2, 3].map((a) => nextDelay(a, noJitter));
    expect(d).toEqual([500, 1000, 2000, 4000]);
  });

  it("caps at maxMs", () => {
    expect(nextDelay(20, { ...noJitter, maxMs: 3000 })).toBe(3000);
    expect(nextDelay(1000, noJitter)).toBe(15000);
  });

  it("applies jitter within bounds", () => {
    const opts = { baseMs: 1000, jitter: 0.5 };
    expect(nextDelay(0, { ...opts, random: () => 0 })).toBe(1000);
    expect(nextDelay(0, { ...opts, random: () => 0.999 })).toBe(500);
    expect(nextDelay(0, { ...opts, random: () => 0.5 })).toBe(750);
  });

  it("restarts from the base when the attempt resets to 0", () => {
    expect(nextDelay(5, noJitter)).toBeGreaterThan(nextDelay(0, noJitter));
    expect(nextDelay(0, noJitter)).toBe(500);
  });

  it("treats negative attempts as 0", () => {
    expect(nextDelay(-3, noJitter)).toBe(500);
  });
});
