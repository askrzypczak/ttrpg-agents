import { describe, expect, it } from "vitest";
import { PROJECT_NAME } from "./index.js";

describe("index", () => {
  it("exports the project name", () => {
    expect(PROJECT_NAME).toBe("ttrpg-agents");
  });
});
