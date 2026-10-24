import { describe, expect, it } from "vitest";
import {
  monsterInstanceSchema,
  type ChangeOrigin,
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
  const candidates: unknown[] = ["s", 1, null, true];
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
const origin: ChangeOrigin = { source: "mcp", commandId: "c1" };

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
    payload: { type: "added", instances: [instance], origin, seq: 1 },
  },
  {
    v: 1,
    type: "encounter-event",
    payload: { type: "removed", id: "i1", origin, seq: 2 },
  },
  {
    v: 1,
    type: "encounter-event",
    payload: { type: "cleared", origin, seq: 3 },
  },
  {
    v: 1,
    type: "encounter-event",
    payload: {
      type: "hp-changed",
      id: "i1",
      currentHp: 3,
      maxHp: 16,
      origin,
      seq: 4,
    },
  },
  {
    v: 1,
    type: "encounter-snapshot",
    payload: { instances: [instance], seq: 7 },
  },
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
        payload: { instances: [sample], seq: 0 },
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

  it("snapshot instances carry statsVisible", () => {
    const revealed = makeTestInstance({ id: "i1", statsVisible: true });
    const hidden = makeTestInstance({ id: "i2", statsVisible: false });
    const decoded = decodeMessage(
      encodeMessage({
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [revealed, hidden], seq: 0 },
      }),
    );
    expect(decoded).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [revealed, hidden], seq: 0 },
      },
    });

    const withoutFlag: Partial<MonsterInstance> = { ...revealed };
    delete withoutFlag.statsVisible;
    const missing = decodeMessage(
      JSON.stringify({
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [withoutFlag], seq: 0 },
      }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("invalid-payload");
  });

  it("a snapshot with a cause decodes", () => {
    const message: BridgeMessage = {
      v: 1,
      type: "encounter-snapshot",
      payload: {
        instances: [makeTestInstance({ id: "i1" })],
        cause: "instance-edit:i1",
        seq: 0,
      },
    };

    const decoded = decodeMessage(encodeMessage(message));

    expect(decoded).toEqual({ ok: true, message });
  });

  it("a snapshot without a cause decodes", () => {
    const decoded = decodeMessage(
      JSON.stringify({
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [makeTestInstance({ id: "i1" })], seq: 0 },
      }),
    );

    expect(decoded.ok).toBe(true);
    if (decoded.ok && decoded.message.type === "encounter-snapshot")
      expect(decoded.message.payload.cause).toBeUndefined();
    else throw new Error("expected a decoded encounter-snapshot");
  });

  it("an encounter-event round-trips the engine event's fields and its seq", () => {
    const message: BridgeMessage = {
      v: 1,
      type: "encounter-event",
      payload: {
        type: "hp-changed",
        id: "i1",
        currentHp: 3,
        maxHp: 16,
        origin: { source: "table", commandId: "instance-edit:i1" },
        seq: 7,
      },
    };

    const decoded = decodeMessage(JSON.stringify(message));

    expect(decoded).toEqual({ ok: true, message });
    expect(JSON.parse(encodeMessage(message))).toEqual(message);
  });

  it.each([
    [
      "encounter-event",
      { type: "cleared", origin: { source: "mcp", commandId: "c1" } },
    ],
    ["encounter-snapshot", { instances: [] }],
  ])(
    "an encounter-event or encounter-snapshot without seq is invalid-payload (%s)",
    (type, payload) => {
      const r = decodeMessage(JSON.stringify({ v: 1, type, payload }));

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-payload");
    },
  );

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
      '{"v":1,"type":"encounter-event","payload":{"type":"exploded","seq":1}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("rejects an encounter-snapshot with a malformed instance", () => {
    const r = decodeMessage(
      '{"v":1,"type":"encounter-snapshot","payload":{"instances":[{"id":"x"}],"seq":0}}',
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

  it("an added event and an encounter-snapshot message without footprint decode with footprint 1", () => {
    const withoutFootprint: Record<string, unknown> = { ...instance };
    delete withoutFootprint.footprint;
    const withFootprint = { ...instance, footprint: 1 };

    const event = decodeMessage(
      JSON.stringify({
        v: 1,
        type: "encounter-event",
        payload: {
          type: "added",
          instances: [withoutFootprint],
          origin: { source: "mcp", commandId: "c1" },
          seq: 1,
        },
      }),
    );
    expect(event).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "encounter-event",
        payload: {
          type: "added",
          instances: [withFootprint],
          origin: { source: "mcp", commandId: "c1" },
          seq: 1,
        },
      },
    });

    const snapshot = decodeMessage(
      JSON.stringify({
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [withoutFootprint], seq: 0 },
      }),
    );
    expect(snapshot).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "encounter-snapshot",
        payload: { instances: [withFootprint], seq: 0 },
      },
    });
  });
});
