import {
  encounterEventSchema,
  monsterInstanceSchema,
} from "@ttrpg-agents/engine";
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

// `role` is self-reported by the client and must never be used for
// authorization; it only drives UI. The `token` is what authenticates a client.
const helloPayload = z.object({
  role: z.enum(["gm", "player"]),
  extensionVersion: z.string(),
  token: z.string(),
});
const helloAckPayload = z.object({ serverVersion: z.string() });
const emptyPayload = z.object({});
const errorPayload = z.object({
  code: z.string(),
  message: z.string(),
  fatal: z.boolean(),
});

// Monster instance and encounter event payloads are the engine's schemas, so
// the wire shape cannot drift from the domain types.
const encounterSnapshotPayload = z.object({
  instances: z.array(monsterInstanceSchema),
});

/** A request the agent can make of the table; also the `/agent/command` body. */
export const commandSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("scene-status") }),
]);

export const sceneStatusSchema = z.object({
  sceneReady: z.boolean(),
  tokenCount: z.number().int().min(0),
  appliedInstanceCount: z.number().int().min(0),
});

export const commandResultSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("scene-status"), result: sceneStatusSchema }),
]);

export const agentErrorCodeSchema = z.enum([
  "not-connected",
  "timeout",
  "command-failed",
  "bridge-unreachable",
  "unauthorized",
  "bad-request",
]);

export const agentCommandResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: commandResultSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: agentErrorCodeSchema, message: z.string() }),
  }),
]);

export type Command = z.infer<typeof commandSchema>;
export type SceneStatus = z.infer<typeof sceneStatusSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type AgentCommandResponse = z.infer<typeof agentCommandResponseSchema>;

function envelope<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    id: z.string().optional(),
    payload,
  });
}

export const bridgeMessageSchema = z.discriminatedUnion("type", [
  envelope("hello", helloPayload),
  envelope("hello-ack", helloAckPayload),
  envelope("ping", emptyPayload),
  envelope("pong", emptyPayload),
  envelope("error", errorPayload),
  envelope("encounter-event", encounterEventSchema),
  envelope("encounter-snapshot", encounterSnapshotPayload),
  envelope("command", commandSchema),
  envelope("command-result", commandResultSchema),
]);

export type BridgeMessage = z.infer<typeof bridgeMessageSchema>;
export type BridgeMessageType = BridgeMessage["type"];

const MESSAGE_TYPES: readonly string[] = bridgeMessageSchema.options.map(
  (o) => o.shape.type.value,
);

export type DecodeResult =
  | { ok: true; message: BridgeMessage }
  | {
      ok: false;
      reason:
        | "malformed-json"
        | "malformed-envelope"
        | "unsupported-version"
        | "unknown-type"
        | "invalid-payload";
      detail: string;
    };

export function encodeMessage(message: BridgeMessage): string {
  return JSON.stringify(bridgeMessageSchema.parse(message));
}

export function decodeMessage(raw: string): DecodeResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      reason: "malformed-json",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return {
      ok: false,
      reason: "malformed-envelope",
      detail: "message must be a JSON object",
    };
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.type !== "string" || !("v" in obj)) {
    return {
      ok: false,
      reason: "malformed-envelope",
      detail: "missing v or type",
    };
  }
  if (obj.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: "unsupported-version",
      detail: `expected v${PROTOCOL_VERSION}, got ${JSON.stringify(obj.v)}`,
    };
  }
  if (!MESSAGE_TYPES.includes(obj.type)) {
    return {
      ok: false,
      reason: "unknown-type",
      detail: `unknown message type "${obj.type}"`,
    };
  }
  const parsed = bridgeMessageSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid-payload",
      detail: parsed.error.message,
    };
  }
  return { ok: true, message: parsed.data };
}
