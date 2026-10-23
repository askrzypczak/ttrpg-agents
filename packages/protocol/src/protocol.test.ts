import { describe, expect, it } from "vitest";
import {
  monsterInstanceSchema,
  type MonsterInstance,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import {
  PROTOCOL_VERSION,
  agentQueryResponseSchema,
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "./protocol.js";

// One value per schema key, the first of these that its field accepts. A new
// field type needs a new candidate here.
function sampleInstance(): MonsterInstance {
  const candidates: unknown[] = ["s", 1, null];
  const instance: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(monsterInstanceSchema.shape)) {
    const value = candidates.find((c) => field.safeParse(c).success);
    if (value === undefined) {
      throw new Error(`no sample value for ${key}; extend the generator`);
    }
    instance[key] = value;
  }
  return instance as MonsterInstance;
}

const instance = makeTestInstance({ createdAt: 5 });

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
  {
    v: 1,
    type: "error",
    payload: { code: "c", message: "m", fatal: true },
  },
  {
    v: 1,
    type: "encounter-event",
    payload: { type: "added", instances: [instance] },
  },
  { v: 1, type: "encounter-event", payload: { type: "removed", id: "i1" } },
  { v: 1, type: "encounter-event", payload: { type: "cleared" } },
  {
    v: 1,
    type: "encounter-event",
    payload: { type: "hp-changed", id: "i1", currentHp: 3, maxHp: 16 },
  },
  { v: 1, type: "encounter-snapshot", payload: { instances: [instance] } },
];

describe("protocol", () => {
  it("uses version 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it.each(samples)("round-trips $type", (message) => {
    const decoded = decodeMessage(encodeMessage(message));
    expect(decoded).toEqual({ ok: true, message });
  });

  it("an encounter-snapshot round-trips every key of the engine's instance schema", () => {
    const sample = sampleInstance();
    const decoded = decodeMessage(
      encodeMessage({
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [sample] },
      }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.message.type !== "encounter-snapshot") {
      throw new Error("expected a decoded encounter-snapshot");
    }
    const [decodedInstance] = decoded.message.payload.instances;
    expect(decodedInstance).toEqual(sample);
    expect(Object.keys(decodedInstance ?? {}).sort()).toEqual(
      Object.keys(monsterInstanceSchema.shape).sort(),
    );
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

  it("an error without `fatal` is rejected as invalid-payload", () => {
    const r = decodeMessage(
      '{"v":1,"type":"error","payload":{"code":"c","message":"m"}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
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

  it("rejects an encounter-event with an unknown event type", () => {
    const r = decodeMessage(
      '{"v":1,"type":"encounter-event","payload":{"type":"exploded"}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("rejects an encounter-snapshot with a malformed instance", () => {
    const r = decodeMessage(
      '{"v":1,"type":"encounter-snapshot","payload":{"instances":[{"id":"x"}]}}',
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

  it("`query` and `query-result` messages round-trip through encode/decode", () => {
    const messages: BridgeMessage[] = [
      { v: 1, type: "query", id: "c1", payload: { name: "scene-status" } },
      {
        v: 1,
        type: "query-result",
        id: "c1",
        payload: {
          name: "scene-status",
          result: { sceneReady: true, tokenCount: 3, appliedInstanceCount: 2 },
        },
      },
    ];
    for (const message of messages) {
      expect(decodeMessage(encodeMessage(message))).toEqual({
        ok: true,
        message,
      });
    }
  });

  it("`agentQueryResponseSchema` accepts the ok and error shapes and rejects an unknown error code", () => {
    const okResponse = {
      ok: true,
      result: {
        name: "scene-status",
        result: { sceneReady: false, tokenCount: 0, appliedInstanceCount: 0 },
      },
    };
    expect(agentQueryResponseSchema.safeParse(okResponse)).toEqual({
      success: true,
      data: okResponse,
    });
    for (const code of [
      "not-connected",
      "timeout",
      "query-failed",
      "bridge-unreachable",
      "unauthorized",
      "bad-request",
    ]) {
      const errorResponse = { ok: false, error: { code, message: "m" } };
      expect(agentQueryResponseSchema.safeParse(errorResponse), code).toEqual({
        success: true,
        data: errorResponse,
      });
    }
    expect(
      agentQueryResponseSchema.safeParse({
        ok: false,
        error: { code: "exploded", message: "m" },
      }).success,
    ).toBe(false);
  });

  it("token-deleted round-trips through encode/decode", () => {
    const raw = {
      v: 1,
      type: "token-deleted",
      id: "token-deleted:i1",
      payload: { instanceId: "i1" },
    };
    const first = decodeMessage(JSON.stringify(raw));
    expect(first).toEqual({ ok: true, message: raw });
    if (!first.ok) return;
    expect(decodeMessage(encodeMessage(first.message))).toEqual({
      ok: true,
      message: raw,
    });
  });

  it("token-deleted without an instanceId is invalid-payload", () => {
    const r = decodeMessage('{"v":1,"type":"token-deleted","payload":{}}');
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
