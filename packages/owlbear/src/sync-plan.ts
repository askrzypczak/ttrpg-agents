import type { BridgeMessage } from "@ttrpg-agents/protocol";
import type { SceneItem, Vec2 } from "./scene-model.js";

export type EncounterInstance = Extract<
  BridgeMessage,
  { type: "encounter-snapshot" }
>["payload"]["instances"][number];

/** Our own item metadata namespace; value is `{ instanceId }`. */
export const INSTANCE_METADATA_KEY = "com.ttrpg-agents/instance";
/** Item metadata: the values we last wrote, `{ [projectorKey]: value }`. */
export const SYNCED_METADATA_KEY = "com.ttrpg-agents/synced";
/** Scene metadata: the instance ids already placed on this scene. */
export const PLACED_METADATA_KEY = "com.ttrpg-agents/placed";

/** Row of `count` positions centred horizontally on `center`. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function rowPositions(count: number, center: Vec2): Vec2[] {
  throw new Error("not implemented");
}

export type Projector = {
  key: string;
  mode: "owned" | "create-only";
  project(instance: EncounterInstance): unknown;
};

export type TokenKind = Pick<
  SceneItem,
  "type" | "layer" | "shape" | "image" | "grid"
>;

export type SyncConfig = {
  projectors: Projector[];
  tokenKind(instance: EncounterInstance): TokenKind;
};

export const defaultSyncConfig: SyncConfig = {
  projectors: [],
  tokenKind() {
    throw new Error("not implemented");
  },
};

export type SyncPlan = {
  add: SceneItem[];
  update: { id: string; key: string; value: unknown }[];
  delete: string[];
};

export function planSync(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  desired: EncounterInstance[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  observed: SceneItem[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: SyncConfig,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  context: { viewportCenter: Vec2; placed: ReadonlySet<string> },
): SyncPlan {
  throw new Error("not implemented");
}
