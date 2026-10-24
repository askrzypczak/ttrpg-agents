import { describe, expect, it } from "vitest";
import { InvalidNameError } from "./errors.js";
import { validateInstanceName } from "./rename.js";

describe("validateInstanceName", () => {
  it("trims the name", () => {
    expect(validateInstanceName("  Boss  ", ["Shadow 2"])).toBe("Boss");
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(() => validateInstanceName("", [])).toThrow(InvalidNameError);
    expect(() => validateInstanceName("  \t ", [])).toThrow(InvalidNameError);
  });

  it("rejects a name another instance has", () => {
    const others = ["Shadow 2", "Shadow 3"];
    expect(() => validateInstanceName("Shadow 2", others)).toThrow(
      InvalidNameError,
    );
    expect(() => validateInstanceName(" Shadow 3 ", others)).toThrow(
      InvalidNameError,
    );
  });

  it("allows the instance's own current name", () => {
    // The caller passes only the other instances' names.
    expect(validateInstanceName("Shadow 1", ["Shadow 2"])).toBe("Shadow 1");
  });
});
