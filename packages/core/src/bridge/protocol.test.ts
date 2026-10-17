import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "./protocol.js";

const samples: BridgeMessage[] = [
  {
    v: 1,
    type: "hello",
    id: "a1",
    payload: { role: "gm", extensionVersion: "0.0.0", token: "t" },
  },
  { v: 1, type: "hello-ack", payload: { serverVersion: "1.2.3" } },
  { v: 1, type: "ping", payload: {} },
  { v: 1, type: "pong", id: "x", payload: {} },
  { v: 1, type: "error", payload: { code: "c", message: "m" } },
];

describe("protocol", () => {
  it("uses version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it.each(samples)("round-trips $type", (message) => {
    const decoded = decodeMessage(encodeMessage(message));
    expect(decoded).toEqual({ ok: true, message });
  });

  it("rejects malformed JSON", () => {
    const r = decodeMessage("{nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-json");
  });

  it.each(["null", "[]", "42", '{"type":"ping"}', '{"v":1}'])(
    "rejects bad envelope %s",
    (raw) => {
      const r = decodeMessage(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("malformed-envelope");
    },
  );

  it("rejects an unsupported version", () => {
    const r = decodeMessage('{"v":2,"type":"ping","payload":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported-version");
  });

  it("rejects an unknown type", () => {
    const r = decodeMessage('{"v":1,"type":"launch","payload":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-type");
  });

  it("rejects a bad payload", () => {
    const r = decodeMessage(
      '{"v":1,"type":"hello","payload":{"role":"wizard","extensionVersion":"1","token":"t"}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("requires a token in hello", () => {
    const r = decodeMessage(
      '{"v":1,"type":"hello","payload":{"role":"gm","extensionVersion":"1"}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("strips unknown extra fields", () => {
    const r = decodeMessage('{"v":1,"type":"ping","payload":{},"extra":true}');
    expect(r).toEqual({
      ok: true,
      message: { v: 1, type: "ping", payload: {} },
    });
  });
});
