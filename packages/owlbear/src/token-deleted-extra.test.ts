import { describe, expect, it } from "vitest";
import { tokenDeletedErrorText } from "./token-deleted.js";

describe("tokenDeletedErrorText text", () => {
  it("names the instance without the envelope id prefix", () => {
    expect(
      tokenDeletedErrorText({
        v: 1,
        type: "error",
        id: "token-deleted:i7",
        payload: { code: "unknown-instance", message: "gone", fatal: false },
      }),
    ).toBe("Could not remove i7 from the encounter: gone");
  });
});
