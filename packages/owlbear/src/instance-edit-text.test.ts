import { describe, expect, it } from "vitest";
import { instanceEditErrorText } from "./instance-edit.js";

describe("instanceEditErrorText", () => {
  it("instanceEditErrorText names the bare instance id without the message id prefix", () => {
    expect(
      instanceEditErrorText({
        v: 1,
        type: "error",
        id: "instance-edit:i7",
        payload: { code: "x", message: "no such instance", fatal: false },
      }),
    ).toBe("Could not apply the edit to i7: no such instance");
  });
});
