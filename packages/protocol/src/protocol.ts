import {
  encounterEventSchema,
  monsterInstanceSchema,
  publishedTokenArtSchema,
  tokenArtSchema,
  type TableSceneMap,
  type TableSceneTokens,
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
// Extension -> bridge: the GM deleted this instance's token on the table.
const tokenDeletedPayload = z.object({ instanceId: z.string() });
// Extension -> bridge: HP, max HP, armor class or initiative edited on the table.
const instanceEditPayload = z
  .object({
    instanceId: z.string(),
    currentHp: z.number().int().optional(),
    maxHp: z.number().int().optional(),
    armorClass: z.number().int().optional(),
    initiative: z.number().int().nullable().optional(),
  })
  .refine(
    (edit) =>
      edit.currentHp !== undefined ||
      edit.maxHp !== undefined ||
      edit.armorClass !== undefined ||
      edit.initiative !== undefined,
    {
      message:
        "an edit needs at least one of currentHp, maxHp, armorClass, initiative",
    },
  );
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
  /** Monster key -> the art new tokens of that type are created with. */
  art: z.record(z.string(), tokenArtSchema).optional(),
  /** The change-log position this snapshot is current as of (0 for an empty log). */
  seq: z.number().int().min(0),
});
// An engine event plus its position in the change log: the extension applies
// events in `seq` order and ignores one it already has.
const encounterEventPayload = encounterEventSchema.and(
  z.object({ seq: z.number().int().min(1) }),
);
// Extension -> bridge: the GM picked this art for a monster type.
const tokenArtSetPayload = z.object({
  monsterKey: z.string().min(1).max(200),
  art: publishedTokenArtSchema,
});

/**
 * A request the agent can make of the table; also the `/agent/query` body.
 *
 * Read-only: a query never changes the table. The agent changes the game
 * through the engine's encounter model, and the extension reconciles the scene
 * to it. Do not add a query that writes to the table.
 */
export const querySchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("scene-status") }),
  z.object({ name: z.literal("scene-map") }),
  z.object({ name: z.literal("scene-tokens") }),
]);

export const sceneStatusSchema = z.object({
  sceneReady: z.boolean(),
  tokenCount: z.number().int().min(0),
  appliedInstanceCount: z.number().int().min(0),
});

const vec2 = z.object({ x: z.number(), y: z.number() });

/**
 * The scene grid and, for each map image, its image size, image grid and
 * transform. The grid type is a string, not an enum, so a type the table adds
 * later still decodes.
 */
export const sceneMapSchema = z.object({
  grid: z.object({
    dpi: z.number().positive(),
    type: z.string().min(1),
  }),
  maps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      imageWidth: z.number().positive(),
      imageHeight: z.number().positive(),
      imageDpi: z.number().positive(),
      imageOffset: vec2,
      position: vec2,
      rotation: z.number(),
      scale: vec2,
    }),
  ),
}) satisfies z.ZodType<TableSceneMap>;

/**
 * The position, in scene units, of each item on the CHARACTER and MOUNT
 * layers. A token with no numeric position is rejected; an empty list is fine.
 */
export const sceneTokensSchema = z.object({
  tokens: z.array(z.object({ position: vec2 })),
}) satisfies z.ZodType<TableSceneTokens>;

export const queryResultSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("scene-status"), result: sceneStatusSchema }),
  z.object({ name: z.literal("scene-map"), result: sceneMapSchema }),
  z.object({ name: z.literal("scene-tokens"), result: sceneTokensSchema }),
]);

export const agentErrorCodeSchema = z.enum([
  "not-connected",
  "timeout",
  "query-failed",
  "bridge-unreachable",
  "unauthorized",
  "bad-request",
]);

export const agentQueryResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: queryResultSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: agentErrorCodeSchema, message: z.string() }),
  }),
]);

export type Query = z.infer<typeof querySchema>;
export type SceneStatus = z.infer<typeof sceneStatusSchema>;
export type SceneMap = z.infer<typeof sceneMapSchema>;
export type QueryResult = z.infer<typeof queryResultSchema>;
export type AgentQueryResponse = z.infer<typeof agentQueryResponseSchema>;

/** The bridge route that stores one token image: POST, raw bytes, extension token as bearer. */
export const TOKEN_IMAGE_UPLOAD_PATH = "/token-images";

export const tokenImageUploadResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    image: z.object({
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum([
        "unauthorized",
        "too_large",
        "svg",
        "unsupported_type",
        "unreadable",
        "dimensions_too_large",
        "store_failed",
      ]),
      message: z.string(),
    }),
  }),
]);

export type TokenImageUploadResponse = z.infer<
  typeof tokenImageUploadResponseSchema
>;

/** The bridge route that answers the stored bytes of one token image: GET, extension token as bearer. */
export function tokenImagePath(sha256: string): string {
  return `${TOKEN_IMAGE_UPLOAD_PATH}/${sha256}`;
}

/** The bridge's refusal of a token image read. */
export const tokenImageReadErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(["unauthorized", "not_found"]),
    message: z.string(),
  }),
});

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
  envelope("encounter-event", encounterEventPayload),
  envelope("encounter-snapshot", encounterSnapshotPayload),
  envelope("query", querySchema),
  envelope("query-result", queryResultSchema),
  envelope("token-deleted", tokenDeletedPayload),
  envelope("token-art-set", tokenArtSetPayload),
  envelope("instance-edit", instanceEditPayload),
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
