import type { TableMapItem } from "@ttrpg-agents/engine";
import {
  PROTOCOL_VERSION,
  type BridgeMessage,
  type Query,
  type QueryResult,
} from "@ttrpg-agents/protocol";
import { isOurs, type EncounterSync } from "./encounter-sync.js";
import { drawMapImageOnCanvas } from "./map-image-canvas.js";
import {
  bytesToBase64,
  encodeWithinBudget,
  planMapImage,
  type DrawMapImage,
} from "./map-image.js";
import { sceneIdOf } from "./open-scene.js";
import { mapPlacementOf } from "./overlay-plan.js";
import { linkedEncounterOf } from "./sync-plan.js";
import { describeError } from "./panel-state.js";
import type { ObrReader } from "./obr-adapter.js";
import type { SceneItem } from "./scene-model.js";

/**
 * The table's entry for an image on the map layer, or `undefined` for any
 * other item, and for an image without its image or grid specs.
 */
function mapItemOf(item: SceneItem): TableMapItem | undefined {
  const { image, grid } = item;
  if (item.type !== "IMAGE" || item.layer !== "MAP" || !image || !grid)
    return undefined;
  const scale = item.scale ?? { x: 1, y: 1 };
  return {
    id: item.id,
    name: item.name,
    imageWidth: image.width,
    imageHeight: image.height,
    imageDpi: grid.dpi,
    imageOffset: { x: grid.offset.x, y: grid.offset.y },
    position: { x: item.position.x, y: item.position.y },
    rotation: item.rotation ?? 0,
    scale: { x: scale.x, y: scale.y },
  };
}

/** Whether an item sits on the CHARACTER or MOUNT layer, where tokens are. */
function isTokenItem(item: SceneItem): boolean {
  return item.layer === "CHARACTER" || item.layer === "MOUNT";
}

/**
 * Answers a bridge `query` from the scene and the encounter sync state. For
 * `scene-status`, the held encounter counts only when the held snapshot is for
 * the open scene; our tokens split into that encounter's (`tokenCount`) and
 * the rest (`unmanagedTokenCount`), and nothing is applied while none is held.
 */
export async function handleQuery(
  obr: ObrReader,
  sync: Pick<EncounterSync, "appliedInstanceCount" | "artWaits" | "heldScene">,
  query: Query,
  draw: DrawMapImage = drawMapImageOnCanvas,
): Promise<QueryResult> {
  switch (query.name) {
    case "scene-status": {
      const sceneReady = await obr.isSceneReady();
      const sceneId = sceneReady
        ? (sceneIdOf(await obr.getSceneMetadata()) ?? null)
        : null;
      const held = sync.heldScene();
      const heldEncounterId =
        sceneId !== null && held?.sceneId === sceneId ? held.encounterId : null;
      const ours = sceneReady ? await obr.getItems(isOurs) : [];
      const tokenCount =
        heldEncounterId === null
          ? 0
          : ours.filter((item) => linkedEncounterOf(item) === heldEncounterId)
              .length;
      return {
        name: "scene-status",
        result: {
          sceneReady,
          tokenCount,
          appliedInstanceCount:
            heldEncounterId === null ? 0 : sync.appliedInstanceCount(),
          artWaits: sync.artWaits(),
          roomId: obr.getRoomId(),
          sceneId,
          heldEncounterId,
          unmanagedTokenCount: ours.length - tokenCount,
        },
      };
    }
    case "scene-map": {
      const [sceneGrid, items] = await Promise.all([
        obr.getGrid(),
        obr.getItems(),
      ]);
      return {
        name: "scene-map",
        result: {
          grid: { dpi: sceneGrid.dpi, type: sceneGrid.type },
          maps: items.flatMap((item) => mapItemOf(item) ?? []),
        },
      };
    }
    case "scene-tokens": {
      const items = await obr.getItems(isTokenItem);
      const tokens = await Promise.all(
        items.map(async (item) => ({
          bounds: await obr.getItemBounds(item.id),
        })),
      );
      return { name: "scene-tokens", result: { tokens } };
    }
    case "map-image": {
      const [sceneGrid, items] = await Promise.all([
        obr.getGrid(),
        obr.getItems(),
      ]);
      const item = items.find((i) => i.id === query.itemId);
      const placement = item ? mapPlacementOf(item, sceneGrid) : undefined;
      if (!item?.image || !placement)
        throw new Error(`No map image with id "${query.itemId}" on the scene.`);
      const layout = planMapImage(placement);
      const bytes = await obr.fetchImage(item.image.url);
      const convert = await draw({ bytes, mime: item.image.mime }, layout);
      const encoded = await encodeWithinBudget(convert);
      return {
        name: "map-image",
        result: {
          mimeType: encoded.mimeType,
          data: bytesToBase64(encoded.bytes),
          width: layout.width,
          height: layout.height,
        },
      };
    }
  }
}

/** The `query-result` reply to the query with `id`. */
export function queryReply(id: string, result: QueryResult): BridgeMessage {
  return { v: PROTOCOL_VERSION, type: "query-result", id, payload: result };
}

/**
 * The message to send back for query `id`: its `query-result`, or a
 * non-fatal `query-failed` error with the same id if handling throws.
 */
export async function replyToQuery(
  obr: ObrReader,
  sync: Pick<EncounterSync, "appliedInstanceCount" | "artWaits" | "heldScene">,
  id: string,
  query: Query,
  draw: DrawMapImage = drawMapImageOnCanvas,
): Promise<BridgeMessage> {
  try {
    return queryReply(id, await handleQuery(obr, sync, query, draw));
  } catch (e) {
    return {
      v: PROTOCOL_VERSION,
      type: "error",
      id,
      payload: {
        code: "query-failed",
        message: describeError(e),
        fatal: false,
      },
    };
  }
}
