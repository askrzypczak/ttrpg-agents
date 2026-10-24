import { describe, expect, it } from "vitest";
import { footprintForSize } from "./footprint.js";

describe("footprintForSize", () => {
  it("footprintForSize maps small and medium to 1 cell", () => {
    expect(footprintForSize("small")).toBe(1);
    expect(footprintForSize("medium")).toBe(1);
  });

  it("footprintForSize maps large to 2, huge to 3 and gargantuan to 4", () => {
    expect(footprintForSize("large")).toBe(2);
    expect(footprintForSize("huge")).toBe(3);
    expect(footprintForSize("gargantuan")).toBe(4);
  });

  it("footprintForSize maps tiny and unknown sizes to 1", () => {
    expect(footprintForSize("tiny")).toBe(1);
    expect(footprintForSize("colossal")).toBe(1);
    expect(footprintForSize("")).toBe(1);
  });
});
