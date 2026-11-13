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
    v: PROTOCOL_VERSION,
    type: "hello",
    id: "a1",
    payload: { role: "gm", extensionVersion: "0.0.0" },
  },
  {
    v: PROTOCOL_VERSION,
    type: "hello-ack",
    payload: { serverVersion: "1.2.3" },
  },
  { v: PROTOCOL_VERSION, type: "ping", payload: {} },
  { v: PROTOCOL_VERSION, type: "pong", id: "x", payload: {} },
  {
    v: PROTOCOL_VERSION,
    type: "error",
    payload: { code: "c", message: "m", fatal: true },
  },
  {
    v: PROTOCOL_VERSION,
    type: "encounter-event",
    payload: {
      type: "added",
      instances: [instance],
      origin,
      seq: 1,
      encounterId: "e1",
    },
  },
  {
    v: PROTOCOL_VERSION,
    type: "encounter-event",
    payload: { type: "removed", id: "i1", origin, seq: 2, encounterId: "e1" },
  },
  {
    v: PROTOCOL_VERSION,
    type: "encounter-event",
    payload: { type: "cleared", origin, seq: 3, encounterId: "e1" },
  },
  {
    v: PROTOCOL_VERSION,
    type: "encounter-event",
    payload: {
      type: "hp-changed",
      id: "i1",
      currentHp: 3,
      maxHp: 16,
      origin,
      seq: 4,
      encounterId: "e1",
    },
  },
  {
    v: PROTOCOL_VERSION,
    type: "encounter-snapshot",
    payload: { instances: [instance], seq: 7, encounterId: "e1" },
  },
];

describe("protocol", () => {
  it("uses version 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it("a hello without a token decodes", () => {
    const r = decodeMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "hello",
        id: "h1",
        payload: { role: "gm", extensionVersion: "1" },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message.type).toBe("hello");
      expect(r.message.payload).toEqual({ role: "gm", extensionVersion: "1" });
    }
  });

  it.each(samples)("round-trips $type", (message) => {
    const decoded = decodeMessage(encodeMessage(message));
    expect(decoded).toEqual({ ok: true, message });
  });

  it("an encounter-snapshot round-trips every key of the engine's instance schema", () => {
    const sample = sampleInstance();
    const decoded = decodeMessage(
      encodeMessage({
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [sample], seq: 0, encounterId: "e1" },
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
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [revealed, hidden], seq: 0, encounterId: "e1" },
      }),
    );
    expect(decoded).toEqual({
      ok: true,
      message: {
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [revealed, hidden], seq: 0, encounterId: "e1" },
      },
    });

    const withoutFlag: Partial<MonsterInstance> = { ...revealed };
    delete withoutFlag.statsVisible;
    const missing = decodeMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [withoutFlag], seq: 0, encounterId: "e1" },
      }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("invalid-payload");
  });

  it("an encounter-event round-trips the engine event's fields and its seq", () => {
    const message: BridgeMessage = {
      v: PROTOCOL_VERSION,
      type: "encounter-event",
      payload: {
        type: "hp-changed",
        id: "i1",
        currentHp: 3,
        maxHp: 16,
        origin: { source: "table", commandId: "instance-edit:i1" },
        seq: 7,
        encounterId: "e1",
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
      const r = decodeMessage(
        JSON.stringify({ v: PROTOCOL_VERSION, type, payload }),
      );

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-payload");
    },
  );

  it("rejects malformed JSON", () => {
    const r = decodeMessage("{nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-json");
  });

  it.each(["null", "[]", "42", '{"type":"ping"}', '{"v":2}'])(
    "rejects bad envelope %s",
    (raw) => {
      const r = decodeMessage(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("malformed-envelope");
    },
  );

  it("rejects the previous version 1", () => {
    const r = decodeMessage('{"v":1,"type":"ping","payload":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported-version");
  });

  it("an error without `fatal` is rejected as invalid-payload", () => {
    const r = decodeMessage(
      '{"v":2,"type":"error","payload":{"code":"c","message":"m"}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("rejects an unknown type", () => {
    const r = decodeMessage('{"v":2,"type":"launch","payload":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-type");
  });

  it("rejects a bad payload", () => {
    const r = decodeMessage(
      '{"v":2,"type":"hello","payload":{"role":"wizard","extensionVersion":"1"}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("rejects an encounter-event with an unknown event type", () => {
    const r = decodeMessage(
      '{"v":2,"type":"encounter-event","payload":{"type":"exploded","seq":1}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("rejects an encounter-snapshot with a malformed instance", () => {
    const r = decodeMessage(
      '{"v":2,"type":"encounter-snapshot","payload":{"instances":[{"id":"x"}],"seq":0}}',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("`query` and `query-result` messages round-trip through encode/decode", () => {
    const messages: BridgeMessage[] = [
      {
        v: PROTOCOL_VERSION,
        type: "query",
        id: "c1",
        payload: { name: "scene-status" },
      },
      {
        v: PROTOCOL_VERSION,
        type: "query-result",
        id: "c1",
        payload: {
          name: "scene-status",
          result: {
            sceneReady: true,
            tokenCount: 3,
            appliedInstanceCount: 2,
            artWaits: [],
          },
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
        result: {
          sceneReady: false,
          tokenCount: 0,
          appliedInstanceCount: 0,
          artWaits: [],
        },
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
      v: PROTOCOL_VERSION,
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
    const r = decodeMessage('{"v":2,"type":"token-deleted","payload":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("strips unknown extra fields", () => {
    const r = decodeMessage('{"v":2,"type":"ping","payload":{},"extra":true}');
    expect(r).toEqual({
      ok: true,
      message: { v: PROTOCOL_VERSION, type: "ping", payload: {} },
    });
  });

  it("an added event and an encounter-snapshot message without footprint decode with footprint 1", () => {
    const withoutFootprint: Record<string, unknown> = { ...instance };
    delete withoutFootprint.footprint;
    const withFootprint = { ...instance, footprint: 1 };

    const event = decodeMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "encounter-event",
        payload: {
          type: "added",
          instances: [withoutFootprint],
          origin: { source: "mcp", commandId: "c1" },
          seq: 1,
          encounterId: "e1",
        },
      }),
    );
    expect(event).toEqual({
      ok: true,
      message: {
        v: PROTOCOL_VERSION,
        type: "encounter-event",
        payload: {
          type: "added",
          instances: [withFootprint],
          origin: { source: "mcp", commandId: "c1" },
          seq: 1,
          encounterId: "e1",
        },
      },
    });

    const snapshot = decodeMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [withoutFootprint], seq: 0, encounterId: "e1" },
      }),
    );
    expect(snapshot).toEqual({
      ok: true,
      message: {
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [withFootprint], seq: 0, encounterId: "e1" },
      },
    });
  });

  it("an encounter-snapshot with the restore seqs of restored instances round-trips, and one without them still decodes", () => {
    const withSeqs = {
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: {
        instances: [instance],
        restoreSeqs: { i1: 5 },
        seq: 7,
        encounterId: "e1",
      },
    };
    expect(decodeMessage(JSON.stringify(withSeqs))).toEqual({
      ok: true,
      message: withSeqs,
    });

    const withoutSeqs = {
      v: PROTOCOL_VERSION,
      type: "encounter-snapshot",
      payload: { instances: [instance], seq: 7, encounterId: "e1" },
    };
    expect(decodeMessage(JSON.stringify(withoutSeqs))).toStrictEqual({
      ok: true,
      message: withoutSeqs,
    });
  });

  it("an encounter-snapshot whose instances have no spawnPosition decodes them with none", () => {
    const withoutSpawn: Record<string, unknown> = { ...instance };
    delete withoutSpawn.spawnPosition;
    const decoded = decodeMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [withoutSpawn], seq: 0, encounterId: "e1" },
      }),
    );
    if (!decoded.ok || decoded.message.type !== "encounter-snapshot") {
      throw new Error("expected a decoded encounter-snapshot");
    }
    expect(decoded.message.payload.instances[0]?.spawnPosition).toBeNull();
  });

  it("an encounter-event round-trips its encounterId, a string or null", () => {
    for (const encounterId of ["e1", null]) {
      const message = {
        v: PROTOCOL_VERSION,
        type: "encounter-event",
        payload: {
          type: "cleared",
          origin: { source: "mcp", commandId: "c1" },
          seq: 3,
          encounterId,
        },
      };

      expect(decodeMessage(JSON.stringify(message))).toEqual({
        ok: true,
        message,
      });
    }
  });

  it("an encounter-snapshot round-trips its encounterId, a string or null", () => {
    for (const encounterId of ["e1", null]) {
      const message = {
        v: PROTOCOL_VERSION,
        type: "encounter-snapshot",
        payload: { instances: [instance], seq: 4, encounterId },
      };

      expect(decodeMessage(JSON.stringify(message))).toEqual({
        ok: true,
        message,
      });
    }
  });

  it.each([
    [
      "encounter-event",
      { type: "cleared", origin: { source: "mcp", commandId: "c1" }, seq: 1 },
    ],
    ["encounter-snapshot", { instances: [], seq: 1 }],
  ])(
    "an encounter-event or encounter-snapshot without encounterId is invalid-payload (%s)",
    (type, payload) => {
      const r = decodeMessage(
        JSON.stringify({ v: PROTOCOL_VERSION, type, payload }),
      );

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-payload");
    },
  );

  it("decodeMessage accepts a scene-open whose scene id is a string or null", () => {
    for (const sceneId of ["s1", null]) {
      const message = {
        v: PROTOCOL_VERSION,
        type: "scene-open",
        id: "r1",
        payload: { sceneId },
      };

      expect(decodeMessage(JSON.stringify(message))).toEqual({
        ok: true,
        message,
      });
    }
  });

  it("decodeMessage rejects a scene-open whose scene id is empty or longer than 200 characters", () => {
    for (const sceneId of ["", "x".repeat(201)]) {
      const r = decodeMessage(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "scene-open",
          payload: { sceneId },
        }),
      );

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-payload");
    }
    // A 200-character id is still a scene id.
    expect(
      decodeMessage(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "scene-open",
          payload: { sceneId: "x".repeat(200) },
        }),
      ).ok,
    ).toBe(true);
  });

  it("decodeMessage rejects an encounter-snapshot without sceneId or encounterName", () => {
    for (const fields of [
      { encounterName: "Encounter 1" },
      { sceneId: "s1" },
    ]) {
      const r = decodeMessage(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "encounter-snapshot",
          payload: { instances: [], seq: 0, encounterId: "e1", ...fields },
        }),
      );

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-payload");
    }
  });

  it("decodeMessage refuses a version-2 envelope as unsupported-version", () => {
    const r = decodeMessage('{"v":2,"type":"ping","payload":{}}');

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported-version");
  });
});
