import { describe, expect, it } from "vitest";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import {
  instanceEditErrorText,
  instanceEditMessage,
  splitEdit,
} from "./instance-edit.js";

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
    expect(request).toMatchObject({
      v: 1,
      type: "instance-edit",
      payload: { instanceId: "i7", currentHp: 5 },
    });
    expect(request.id).toEqual(expect.any(String));

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
        id: request.id,
        payload: {},
      }),
    ).toBe(undefined);
  });

  it("two instance-edit messages for one instance carry distinct ids", () => {
    const first = instanceEditMessage({ instanceId: "i7", currentHp: 5 });
    const second = instanceEditMessage({ instanceId: "i7", currentHp: 5 });

    expect(first.id).toEqual(expect.any(String));
    expect(second.id).not.toBe(first.id);
  });

  it("the error text of an instance-edit refusal names the instance from an id with a unique suffix", () => {
    expect(
      instanceEditErrorText(error("instance-edit:i7:3f2a9c1e-0b7d-4a55")),
    ).toBe("Could not apply the edit to i7: no such instance");
  });

  it("an edit of max HP, HP and armor class splits into single-field edits, max HP first", () => {
    expect(
      splitEdit({
        instanceId: "i7",
        currentHp: 5,
        maxHp: 20,
        armorClass: 14,
      }),
    ).toEqual([
      { instanceId: "i7", maxHp: 20 },
      { instanceId: "i7", currentHp: 5 },
      { instanceId: "i7", armorClass: 14 },
    ]);
    expect(
      splitEdit({ instanceId: "i7", armorClass: 14, currentHp: 5 }),
    ).toEqual([
      { instanceId: "i7", currentHp: 5 },
      { instanceId: "i7", armorClass: 14 },
    ]);
  });
});
