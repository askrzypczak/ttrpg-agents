import { describe, expect, it } from "vitest";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { tokenDeletedErrorText, tokenDeletedMessage } from "./token-deleted.js";

const error = (
  id: string | undefined,
  fatal = false,
  message = "no such instance",
): BridgeMessage => ({
  v: 1,
  type: "error",
  ...(id !== undefined ? { id } : {}),
  payload: { code: "unknown-instance", message, fatal },
});

describe("token-deleted", () => {
  it("tokenDeletedMessage carries the instance id in payload", () => {
    expect(tokenDeletedMessage("i7")).toMatchObject({
      v: 1,
      type: "token-deleted",
      payload: { instanceId: "i7" },
    });
  });

  it("two token-deleted messages for one instance carry distinct ids", () => {
    const first = tokenDeletedMessage("i7");
    const second = tokenDeletedMessage("i7");

    expect(first.id).toEqual(expect.any(String));
    expect(second.id).not.toBe(first.id);
  });

  it("tokenDeletedErrorText returns the text for a matching non-fatal error and undefined for others", () => {
    const request = tokenDeletedMessage("i7");
    expect(tokenDeletedErrorText(error(request.id))).toBe(
      "Could not remove i7 from the encounter: no such instance",
    );

    expect(tokenDeletedErrorText(error(request.id, true))).toBe(undefined);
    expect(tokenDeletedErrorText(error("instance-edit:i7:abc"))).toBe(
      undefined,
    );
    expect(tokenDeletedErrorText(error("q1"))).toBe(undefined);
    expect(tokenDeletedErrorText(error(undefined))).toBe(undefined);
    expect(
      tokenDeletedErrorText({
        v: 1,
        type: "pong",
        id: request.id,
        payload: {},
      }),
    ).toBe(undefined);
  });
});
