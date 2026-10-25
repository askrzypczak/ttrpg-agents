import type { TableMapItem } from "@ttrpg-agents/engine";
import {
  PROTOCOL_VERSION,
  type BridgeMessage,
  type Query,
  type QueryResult,
} from "@ttrpg-agents/protocol";
import { isOurs, type EncounterSync } from "./encounter-sync.js";
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

/** Answers a bridge `query` from the scene and the encounter sync state. */
export async function handleQuery(
  obr: ObrReader,
  sync: Pick<EncounterSync, "appliedInstanceCount">,
  query: Query,
): Promise<QueryResult> {
  switch (query.name) {
    case "scene-status": {
      const sceneReady = await obr.isSceneReady();
      const tokenCount = sceneReady ? (await obr.getItems(isOurs)).length : 0;
      return {
        name: "scene-status",
        result: {
          sceneReady,
          tokenCount,
          appliedInstanceCount: sync.appliedInstanceCount(),
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
  sync: Pick<EncounterSync, "appliedInstanceCount">,
  id: string,
  query: Query,
): Promise<BridgeMessage> {
  try {
    return queryReply(id, await handleQuery(obr, sync, query));
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
