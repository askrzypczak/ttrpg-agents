import type { BridgeMessage } from "@ttrpg-agents/core/bridge";
import { initiativeMetadata } from "./initiative.js";
import type { ObrAdapter } from "./obr-adapter.js";
import type { SceneItem } from "./scene-model.js";

export type EncounterEventPayload = Extract<
  BridgeMessage,
  { type: "encounter-event" }
>["payload"];
export type EncounterInstance = Extract<
  BridgeMessage,
  { type: "encounter-snapshot" }
>["payload"]["instances"][number];

/** Our own metadata namespace; value is `{ instanceId }`. */
export const INSTANCE_METADATA_KEY = "com.ttrpg-agents/instance";
/** One grid cell at Owlbear's default 150 dpi. */
export const TOKEN_SIZE = 150;
const TOKEN_SPACING = TOKEN_SIZE;

function instanceIdOf(item: SceneItem): string | undefined {
  const value = item.metadata[INSTANCE_METADATA_KEY];
  if (typeof value !== "object" || value === null) return undefined;
  const id = (value as { instanceId?: unknown }).instanceId;
  return typeof id === "string" ? id : undefined;
}

const isOurs = (item: SceneItem): boolean => instanceIdOf(item) !== undefined;

/**
 * Pure mapping from an instance to a hidden SHAPE token at `position`. The
 * token also carries Initiative Tracker metadata for the instance's initiative.
 */
export function instanceToItem(
  instance: Pick<EncounterInstance, "id" | "displayName" | "initiative">,
  position: { x: number; y: number },
): SceneItem {
  return {
    id: `ttrpg-instance-${instance.id}`,
    type: "SHAPE",
    name: instance.displayName,
    visible: false,
    position,
    metadata: {
      [INSTANCE_METADATA_KEY]: { instanceId: instance.id },
      ...initiativeMetadata(instance.initiative),
    },
    shape: { shapeType: "CIRCLE", width: TOKEN_SIZE, height: TOKEN_SIZE },
  };
}

/** Row of `count` positions centred horizontally on `center`. */
export function rowPositions(
  count: number,
  center: { x: number; y: number },
): { x: number; y: number }[] {
  const startX = center.x - ((count - 1) * TOKEN_SPACING) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * TOKEN_SPACING,
    y: center.y,
  }));
}

async function addMissing(
  obr: ObrAdapter,
  instances: Pick<EncounterInstance, "id" | "displayName" | "initiative">[],
): Promise<void> {
  const existing = new Set(
    (await obr.getItems(isOurs)).map((item) => instanceIdOf(item)),
  );
  const missing = instances.filter((i) => !existing.has(i.id));
  if (missing.length === 0) return;
  const positions = rowPositions(missing.length, await obr.getViewportCenter());
  await obr.addItems(missing.map((i, n) => instanceToItem(i, positions[n]!)));
}

async function deleteWhere(
  obr: ObrAdapter,
  predicate: (instanceId: string) => boolean,
): Promise<void> {
  const doomed = await obr.getItems((item) => {
    const id = instanceIdOf(item);
    return id !== undefined && predicate(id);
  });
  if (doomed.length > 0) await obr.deleteItems(doomed.map((i) => i.id));
}

/**
 * Applies one event to the scene. Idempotent: replaying an event never
 * duplicates tokens. `hp-changed` is intentionally a no-op in v1 (tokens carry
 * only name, hidden flag and instance link). Not safe to call concurrently;
 * use `createEncounterSync` for that.
 */
export async function applyEvent(
  obr: ObrAdapter,
  event: EncounterEventPayload,
): Promise<void> {
  switch (event.type) {
    case "added":
      return addMissing(obr, event.instances);
    case "removed":
      return deleteWhere(obr, (id) => id === event.id);
    case "cleared":
      return deleteWhere(obr, () => true);
    case "hp-changed":
      return;
  }
}

/** Makes the scene's instance tokens match `instances` exactly (ours only). */
export async function applySnapshot(
  obr: ObrAdapter,
  instances: EncounterInstance[],
): Promise<void> {
  const wanted = new Set(instances.map((i) => i.id));
  await deleteWhere(obr, (id) => !wanted.has(id));
  await addMissing(obr, instances);
}

export interface EncounterSync {
  handleMessage(message: BridgeMessage): Promise<void>;
}

/**
 * Feeds bridge messages into the scene one at a time, in arrival order, so the
 * read-then-write idempotence checks never interleave. A failing message is
 * reported to `onError` and does not block later ones.
 */
export function createEncounterSync(
  obr: ObrAdapter,
  onError: (error: unknown) => void = () => {},
): EncounterSync {
  let tail: Promise<void> = Promise.resolve();
  return {
    handleMessage(message) {
      let task: (() => Promise<void>) | undefined;
      if (message.type === "encounter-event") {
        task = () => applyEvent(obr, message.payload);
      } else if (message.type === "encounter-snapshot") {
        task = () => applySnapshot(obr, message.payload.instances);
      }
      if (!task) return Promise.resolve();
      const run = tail.then(task);
      tail = run.catch(onError);
      return tail;
    },
  };
}
