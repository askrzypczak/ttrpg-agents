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
  spawnPosition: null,
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
      payload: { instances: [instance], art: { shadow: art }, seq: 0 },
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
      payload: { instances: [instance], seq: 0 },
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

  it("a snapshot can carry art with an image hash and no url", () => {
    const sha256 = "ab".repeat(32);
    const raw = {
      v: 1,
      type: "encounter-snapshot",
      payload: {
        instances: [instance],
        art: { shadow: { sha256 }, ghoul: { ...art, sha256: "cd".repeat(32) } },
        seq: 0,
      },
    };
    const decoded = decodeMessage(JSON.stringify(raw));
    expect(decoded).toEqual({ ok: true, message: raw });
    if (!decoded.ok) return;
    expect(decodeMessage(encodeMessage(decoded.message))).toEqual({
      ok: true,
      message: raw,
    });
  });

  it("token-art-set with art that has no url is rejected", () => {
    const sha256 = "ab".repeat(32);
    const raw = {
      v: 1,
      type: "token-art-set",
      payload: { monsterKey: "shadow", art: { sha256 } },
    };
    const r = decodeMessage(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
    // Control: the same hash with a published reference is accepted.
    const published = {
      ...raw,
      payload: { monsterKey: "shadow", art: { ...art, sha256 } },
    };
    expect(decodeMessage(JSON.stringify(published)).ok).toBe(true);
  });
});
