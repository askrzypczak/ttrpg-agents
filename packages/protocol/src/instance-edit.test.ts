import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage } from "./protocol.js";

const raw = (payload: Record<string, unknown>) =>
  JSON.stringify({
    v: 1,
    type: "instance-edit",
    id: "instance-edit:i1",
    payload,
  });

describe("instance-edit", () => {
  it("instance-edit message round-trips", () => {
    const full = {
      v: 1,
      type: "instance-edit",
      id: "instance-edit:i1",
      payload: { instanceId: "i1", currentHp: 5, maxHp: 20, armorClass: 14 },
    };
    const first = decodeMessage(JSON.stringify(full));
    expect(first).toEqual({ ok: true, message: full });
    if (!first.ok) return;
    expect(decodeMessage(encodeMessage(first.message))).toEqual({
      ok: true,
      message: full,
    });

    // One field alone is a valid edit too.
    expect(decodeMessage(raw({ instanceId: "i1", armorClass: 0 }))).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "instance-edit",
        id: "instance-edit:i1",
        payload: { instanceId: "i1", armorClass: 0 },
      },
    });
  });

  it("instance-edit rejects a non-integer value and an empty edit", () => {
    const bad = [
      { instanceId: "i1", currentHp: 1.5 },
      { instanceId: "i1", maxHp: "20" },
      { instanceId: "i1", armorClass: null },
      { instanceId: "i1", currentHp: 5, armorClass: 12.5 },
      { instanceId: "i1" },
      { currentHp: 5 },
    ];
    for (const payload of bad) {
      const r = decodeMessage(raw(payload));
      expect(r.ok, JSON.stringify(payload)).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-payload");
    }

    // Control: each field alone, as an integer, is accepted.
    for (const payload of [
      { instanceId: "i1", currentHp: 0 },
      { instanceId: "i1", maxHp: 20 },
      { instanceId: "i1", armorClass: -2 },
    ]) {
      expect(decodeMessage(raw(payload)).ok, JSON.stringify(payload)).toBe(
        true,
      );
    }
  });

  it("an initiative-only instance-edit payload is accepted", () => {
    expect(decodeMessage(raw({ instanceId: "i1", initiative: 14 }))).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "instance-edit",
        id: "instance-edit:i1",
        payload: { instanceId: "i1", initiative: 14 },
      },
    });
  });

  it("a null initiative is accepted and a decimal initiative is rejected", () => {
    expect(decodeMessage(raw({ instanceId: "i1", initiative: null }))).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "instance-edit",
        id: "instance-edit:i1",
        payload: { instanceId: "i1", initiative: null },
      },
    });

    const decimal = decodeMessage(raw({ instanceId: "i1", initiative: 1.5 }));
    expect(decimal.ok).toBe(false);
    if (!decimal.ok) expect(decimal.reason).toBe("invalid-payload");
  });
});
