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
  it("tokenDeletedMessage carries the instance id in payload and a `token-deleted:` envelope id", () => {
    expect(tokenDeletedMessage("i7")).toEqual({
      v: 1,
      type: "token-deleted",
      id: "token-deleted:i7",
      payload: { instanceId: "i7" },
    });
  });

  it("tokenDeletedErrorText returns the text for a matching non-fatal error and undefined for others", () => {
    const text = tokenDeletedErrorText(error("token-deleted:i7"));
    expect(text).toContain("no such instance");
    expect(text).toContain("i7");

    expect(tokenDeletedErrorText(error("token-deleted:i7", true))).toBe(
      undefined,
    );
    expect(tokenDeletedErrorText(error("q1"))).toBe(undefined);
    expect(tokenDeletedErrorText(error(undefined))).toBe(undefined);
    expect(
      tokenDeletedErrorText({
        v: 1,
        type: "pong",
        id: "token-deleted:i7",
        payload: {},
      }),
    ).toBe(undefined);
  });
});
