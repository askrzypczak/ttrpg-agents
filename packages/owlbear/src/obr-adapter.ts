// The ONLY module allowed to import @owlbear-rodeo/sdk (enforced by ESLint).
// Everything else depends on the narrow ObrAdapter interface so it can be
// unit-tested against the fake in fake-adapter.ts.
import OBR, { buildImage, type Item } from "@owlbear-rodeo/sdk";
import type {
  ItemPatch,
  Metadata,
  PlayerRole,
  SceneItem,
} from "./scene-model.js";

export interface ObrAdapter {
  onReady(callback: () => void | Promise<void>): void;
  getRole(): Promise<PlayerRole>;
  isSceneReady(): Promise<boolean>;
  /** Returns an unsubscribe function. */
  onSceneReadyChange(callback: (ready: boolean) => void): () => void;
  addItems(items: SceneItem[]): Promise<void>;
  getItems(filter?: (item: SceneItem) => boolean): Promise<SceneItem[]>;
  updateItems(ids: string[], patch: ItemPatch): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;
  getSceneMetadata(): Promise<Metadata>;
  /** Shallow-merges into existing scene metadata. */
  setSceneMetadata(update: Metadata): Promise<void>;
}

function toItem(item: SceneItem): Item {
  if (item.type !== "IMAGE")
    throw new Error(`adding ${item.type} items is not supported yet`);
  if (!item.image || !item.grid)
    throw new Error(`IMAGE item ${item.id} needs image and grid specs`);
  return buildImage(item.image, item.grid)
    .id(item.id)
    .name(item.name)
    .visible(item.visible)
    .position(item.position)
    .metadata(item.metadata)
    .layer(item.layer ?? "CHARACTER")
    .scale(item.scale ?? { x: 1, y: 1 })
    .build();
}

function fromItem(item: Item): SceneItem {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    visible: item.visible,
    position: { x: item.position.x, y: item.position.y },
    metadata: item.metadata,
  };
}

export function createObrAdapter(): ObrAdapter {
  return {
    onReady: (callback) => {
      OBR.onReady(callback);
    },
    getRole: async () =>
      (await OBR.player.getRole()) === "GM" ? "gm" : "player",
    isSceneReady: () => OBR.scene.isReady(),
    onSceneReadyChange: (callback) => OBR.scene.onReadyChange(callback),
    addItems: (items) => OBR.scene.items.addItems(items.map(toItem)),
    getItems: async (filter) => {
      const items = (await OBR.scene.items.getItems()).map(fromItem);
      return filter ? items.filter(filter) : items;
    },
    updateItems: (ids, patch) =>
      OBR.scene.items.updateItems(
        (item) => ids.includes(item.id),
        (drafts) => {
          for (const draft of drafts) {
            if (patch.name !== undefined) draft.name = patch.name;
            if (patch.visible !== undefined) draft.visible = patch.visible;
            if (patch.position !== undefined) draft.position = patch.position;
            if (patch.metadata !== undefined) draft.metadata = patch.metadata;
          }
        },
      ),
    deleteItems: (ids) => OBR.scene.items.deleteItems(ids),
    getSceneMetadata: () => OBR.scene.getMetadata(),
    setSceneMetadata: (update) => OBR.scene.setMetadata(update),
  };
}
