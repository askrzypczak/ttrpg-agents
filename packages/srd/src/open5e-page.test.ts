import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { open5ePageSchema } from "./open5e-page.js";

const shadow: unknown = JSON.parse(
  readFileSync(
    new URL("./fixtures/open5e-shadow.json", import.meta.url),
    "utf8",
  ),
);

describe("open5ePageSchema", () => {
  it("accepts a page with next null and a results array", () => {
    const result = open5ePageSchema.safeParse({
      next: null,
      results: [shadow],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a page with a next URL", () => {
    const result = open5ePageSchema.safeParse({
      next: "https://api.open5e.com/v2/creatures/?page=2",
      results: [shadow],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a page whose results is not an array", () => {
    const result = open5ePageSchema.safeParse({
      next: null,
      results: { key: "srd-2024_shadow" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a result with no string key", () => {
    for (const bad of [{ name: "Shadow" }, { key: 42, name: "Shadow" }]) {
      const result = open5ePageSchema.safeParse({
        next: null,
        results: [shadow, bad],
      });
      expect(result.success).toBe(false);
    }
  });
});
