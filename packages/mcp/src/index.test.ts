import { describe, expect, it } from "vitest";
import { SERVER_NAME } from "./index.js";

describe("index", () => {
  it("derives the server name from the core project name", () => {
    expect(SERVER_NAME).toBe("ttrpg-agents-mcp");
  });
});
