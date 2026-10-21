import type { BridgeMessage } from "@ttrpg-agents/protocol";
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

export const isOurs = (item: SceneItem): boolean =>
  instanceIdOf(item) !== undefined;

/** Pure mapping from an instance to a hidden SHAPE token at `position`. */
export function instanceToItem(
  instance: Pick<EncounterInstance, "id" | "displayName">,
  position: { x: number; y: number },
): SceneItem {
  return {
    id: `ttrpg-instance-${instance.id}`,
    type: "SHAPE",
    name: instance.displayName,
    visible: false,
    position,
    metadata: { [INSTANCE_METADATA_KEY]: { instanceId: instance.id } },
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
  instances: Pick<EncounterInstance, "id" | "displayName">[],
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
  /** Resolves once the message is applied, or deferred until the scene is ready. */
  handleMessage(message: BridgeMessage): Promise<void>;
  /** How many instances the successfully applied messages account for (held or failed ones do not count). */
  appliedInstanceCount(): number;
}

type SyncMessage = Extract<
  BridgeMessage,
  { type: "encounter-event" | "encounter-snapshot" }
>;

function applyMessage(obr: ObrAdapter, message: SyncMessage): Promise<void> {
  return message.type === "encounter-event"
    ? applyEvent(obr, message.payload)
    : applySnapshot(obr, message.payload.instances);
}

/**
 * Feeds bridge messages into the scene one at a time, in arrival order, so the
 * read-then-write idempotence checks never interleave. Messages that arrive
 * while the scene is not ready (e.g. right after a room reload) are held and
 * applied once it is; a snapshot supersedes anything still held. A failing
 * message on a ready scene is reported to `onError` and does not block later
 * ones. `onApplied` fires after each message is applied.
 */
export function createEncounterSync(
  obr: ObrAdapter,
  onError: (error: unknown) => void = () => {},
  onApplied: () => void = () => {},
): EncounterSync {
  const pending: SyncMessage[] = [];
  let tail: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    // Never let the chain reject, or every later message would be skipped.
    tail = tail.then(task).catch((error) => {
      try {
        onError(error);
      } catch {
        // A throwing handler must not stop later messages.
      }
    });
    return tail;
  };

  async function drain(): Promise<void> {
    while (pending.length > 0 && (await obr.isSceneReady())) {
      try {
        await applyMessage(obr, pending[0]!);
      } catch (error) {
        // The scene went away mid-apply: keep the message (replay is safe).
        // Known race: if it is ready again by now, this is reported as a
        // genuine failure and the message dropped; the next snapshot repairs it.
        if (!(await obr.isSceneReady())) return;
        pending.shift();
        onError(error);
        continue;
      }
      pending.shift();
      onApplied();
    }
  }

  obr.onSceneReadyChange((ready) => {
    if (ready) void enqueue(drain);
  });

  return {
    handleMessage(message) {
      if (
        message.type !== "encounter-event" &&
        message.type !== "encounter-snapshot"
      )
        return Promise.resolve();
      return enqueue(() => {
        if (message.type === "encounter-snapshot") pending.length = 0;
        pending.push(message);
        return drain();
      });
    },
    appliedInstanceCount() {
      throw new Error("not implemented");
    },
  };
}
