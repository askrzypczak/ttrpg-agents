import { describe, expect, it } from "vitest";
import { bridgeMessageSchema } from "./protocol.js";

describe("instance-edit schema", () => {
  it("an edit with no field fails with a message naming the fields", () => {
    const result = bridgeMessageSchema.safeParse({
      v: 1,
      type: "instance-edit",
      payload: { instanceId: "i1" },
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("at least one of");
  });
});
