import { describe, expect, it } from "vitest";
import {
  PROJECT_NAME,
  TOKEN_IMAGE_MAX_BYTES,
  validateTokenImage,
} from "./index.js";

describe("index", () => {
  it("exports the project name", () => {
    expect(PROJECT_NAME).toBe("ttrpg-agents");
  });

  it("the engine exports validateTokenImage and TOKEN_IMAGE_MAX_BYTES", () => {
    expect(TOKEN_IMAGE_MAX_BYTES).toBe(1024 * 1024);
    expect(validateTokenImage(new Uint8Array(1024 * 1024 + 1))).toMatchObject({
      ok: false,
      code: "too_large",
    });
  });
});
