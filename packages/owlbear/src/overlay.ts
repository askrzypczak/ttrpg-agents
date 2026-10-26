import type { MapRooms } from "@ttrpg-agents/protocol";
import type { ObrAdapter } from "./obr-adapter.js";
import {
  OVERLAY_METADATA_KEY,
  mapPlacementOf,
  planOverlay,
} from "./overlay-plan.js";
import type { SceneItem } from "./scene-model.js";

/** The map overlay of this tab: grid labels and room outlines as local items. */
export interface MapOverlay {
  /** The active map's rooms, from the bridge's `map-rooms`. */
  setRooms(rooms: MapRooms): Promise<void>;
  /** Shows (true) or removes (false) the overlay. */
  setEnabled(enabled: boolean): Promise<void>;
}

const isOverlayItem = (item: SceneItem): boolean =>
  item.metadata[OVERLAY_METADATA_KEY] !== undefined;

/** Creates the overlay, on; it draws once the first rooms arrive and the scene is ready. */
export function createMapOverlay(
  obr: ObrAdapter,
  options?: { onError?: (error: unknown) => void },
): MapOverlay {
  let rooms: MapRooms | undefined;
  let enabled = true;
  // JSON of the items last written, or undefined when the next draw must
  // delete and add from scratch (first draw, scene ready again, a failure).
  let drawn: string | undefined;
  let dirty = false;
  let loop: Promise<void> | undefined;

  const desiredItems = async (current: MapRooms): Promise<SceneItem[]> => {
    const { itemId } = current;
    if (!enabled || itemId === null) return [];
    const [mapItem] = await obr.getItems((item) => item.id === itemId);
    if (!mapItem) return [];
    const grid = await obr.getGrid();
    if (grid.type !== "SQUARE") return [];
    const placement = mapPlacementOf(mapItem, grid);
    return placement ? planOverlay(placement, current.rooms) : [];
  };

  const reconcileOnce = async (): Promise<void> => {
    const current = rooms;
    if (current === undefined) return;
    try {
      if (!(await obr.isSceneReady())) {
        drawn = undefined;
        return;
      }
      const desired = await desiredItems(current);
      const key = JSON.stringify(desired);
      if (key === drawn) return;
      drawn = undefined;
      const stale = await obr.getLocalItems(isOverlayItem);
      if (stale.length > 0)
        await obr.deleteLocalItems(stale.map((item) => item.id));
      if (desired.length > 0) await obr.addLocalItems(desired);
      drawn = key;
    } catch (e) {
      drawn = undefined;
      options?.onError?.(e);
    }
  };

  // Serialised and coalesced: triggers during a run cause one more run.
  const reconcile = (): Promise<void> => {
    dirty = true;
    loop ??= (async () => {
      while (dirty) {
        dirty = false;
        await reconcileOnce();
      }
      loop = undefined;
    })();
    return loop;
  };

  obr.onItemsChange(() => void reconcile());
  obr.onSceneReadyChange(() => {
    drawn = undefined;
    void reconcile();
  });

  return {
    setRooms: (next) => {
      rooms = structuredClone(next);
      return reconcile();
    },
    setEnabled: (next) => {
      enabled = next;
      return reconcile();
    },
  };
}
