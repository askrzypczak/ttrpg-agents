import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage } from "./protocol.js";

const instance = {
  id: "i1",
  encounterId: "e1",
  monsterKey: "shadow",
  displayName: "Shadow 1",
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: 5,
  footprint: 1,
  statsVisible: false,
};

const art = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

describe("token art on the wire", () => {
  it("a snapshot can carry an art map keyed by monster key", () => {
    const raw = {
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: [instance], art: { shadow: art } },
    };
    const decoded = decodeMessage(JSON.stringify(raw));
    expect(decoded).toEqual({ ok: true, message: raw });
    if (!decoded.ok) return;
    expect(decodeMessage(encodeMessage(decoded.message))).toEqual({
      ok: true,
      message: raw,
    });
  });

  it("a snapshot without an art map still decodes", () => {
    const raw = {
      v: 1,
      type: "encounter-snapshot",
      payload: { instances: [instance] },
    };
    expect(decodeMessage(JSON.stringify(raw))).toEqual({
      ok: true,
      message: raw,
    });
  });

  it("token-art-set round-trips a monster key and its art", () => {
    const raw = {
      v: 1,
      type: "token-art-set",
      payload: { monsterKey: "shadow", art },
    };
    const decoded = decodeMessage(JSON.stringify(raw));
    expect(decoded).toEqual({ ok: true, message: raw });
    if (!decoded.ok) return;
    expect(decodeMessage(encodeMessage(decoded.message))).toEqual({
      ok: true,
      message: raw,
    });
  });

  it("token-art-set with a non-https url is rejected", () => {
    const raw = {
      v: 1,
      type: "token-art-set",
      payload: {
        monsterKey: "shadow",
        art: { ...art, url: "http://evil.test/x.png" },
      },
    };
    const r = decodeMessage(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });
});
