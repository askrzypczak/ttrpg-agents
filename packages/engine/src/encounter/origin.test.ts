import { describe, expect, it } from "vitest";
import { changeOriginSchema } from "./origin.js";

describe("changeOriginSchema", () => {
  it("changeOriginSchema accepts mcp and table sources and rejects an empty commandId or unknown source", () => {
    expect(
      changeOriginSchema.safeParse({ source: "mcp", commandId: "c1" }).success,
    ).toBe(true);
    expect(
      changeOriginSchema.safeParse({ source: "table", commandId: "c2" })
        .success,
    ).toBe(true);

    expect(
      changeOriginSchema.safeParse({ source: "mcp", commandId: "" }).success,
    ).toBe(false);
    expect(
      changeOriginSchema.safeParse({ source: "agent", commandId: "c1" })
        .success,
    ).toBe(false);
    expect(changeOriginSchema.safeParse({ source: "mcp" }).success).toBe(false);
  });
});
