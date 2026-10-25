import {
  PROTOCOL_VERSION,
  type BridgeMessage,
  type Query,
  type QueryResult,
} from "@ttrpg-agents/protocol";
import { isOurs, type EncounterSync } from "./encounter-sync.js";
import { describeError } from "./panel-state.js";
import type { ObrReader } from "./obr-adapter.js";

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
      throw new Error("not implemented");
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
