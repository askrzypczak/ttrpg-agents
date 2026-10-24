import { describe, expect, it } from "vitest";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { instanceEditErrorText, instanceEditMessage } from "./instance-edit.js";

const error = (
  id: string | undefined,
  fatal = false,
  message = "no such instance",
): BridgeMessage => ({
  v: 1,
  type: "error",
  ...(id !== undefined ? { id } : {}),
  payload: { code: "unknown_instance", message, fatal },
});

describe("instance-edit", () => {
  it("instanceEditMessage and instanceEditErrorText share the message id", () => {
    const request = instanceEditMessage({ instanceId: "i7", currentHp: 5 });
    expect(request).toEqual({
      v: 1,
      type: "instance-edit",
      id: "instance-edit:i7",
      payload: { instanceId: "i7", currentHp: 5 },
    });

    const text = instanceEditErrorText(error(request.id));
    expect(text).toContain("no such instance");
    expect(text).toContain("i7");

    expect(instanceEditErrorText(error(request.id, true))).toBe(undefined);
    expect(instanceEditErrorText(error("token-deleted:i7"))).toBe(undefined);
    expect(instanceEditErrorText(error("q1"))).toBe(undefined);
    expect(instanceEditErrorText(error(undefined))).toBe(undefined);
    expect(
      instanceEditErrorText({
        v: 1,
        type: "pong",
        id: "instance-edit:i7",
        payload: {},
      }),
    ).toBe(undefined);
  });
});
