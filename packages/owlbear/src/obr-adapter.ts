// The ONLY module allowed to import @owlbear-rodeo/sdk (enforced by ESLint).
// Everything else depends on the narrow ObrAdapter interface so it can be
// unit-tested against the fake in fake-adapter.ts.
import OBR, { buildImage, buildShape, type Item } from "@owlbear-rodeo/sdk";
import type {
  ItemPatch,
  Metadata,
  PlayerRole,
  SceneItem,
  Vec2,
} from "./scene-model.js";

export interface ObrAdapter {
  onReady(callback: () => void | Promise<void>): void;
  getRole(): Promise<PlayerRole>;
  isSceneReady(): Promise<boolean>;
  /** Returns an unsubscribe function. */
  onSceneReadyChange(callback: (ready: boolean) => void): () => void;
  addItems(items: SceneItem[]): Promise<void>;
  getItems(filter?: (item: SceneItem) => boolean): Promise<SceneItem[]>;
  updateItems(ids: string[], patch: Omit<ItemPatch, "metadata">): Promise<void>;
  /**
   * Key-level item metadata write: sets `key` on item `id` and keeps its other
   * keys; `undefined` clears the key. Grouped per item in one SDK call.
   */
  setItemMetadata(
    updates: { id: string; key: string; value: unknown }[],
  ): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;
  getSceneMetadata(): Promise<Metadata>;
  /** Shallow-merges into existing scene metadata. */
  setSceneMetadata(update: Metadata): Promise<void>;
  /** Scene coordinates of the middle of the GM's current view. */
  getViewportCenter(): Promise<Vec2>;
}

function toItem(item: SceneItem): Item {
  if (item.type === "SHAPE") {
    if (!item.shape)
      throw new Error(`SHAPE item ${item.id} needs a shape spec`);
    return buildShape()
      .id(item.id)
      .name(item.name)
      .visible(item.visible)
      .position(item.position)
      .metadata(item.metadata)
      .layer(item.layer ?? "CHARACTER")
      .scale(item.scale ?? { x: 1, y: 1 })
      .shapeType(item.shape.shapeType)
      .width(item.shape.width)
      .height(item.shape.height)
      .build();
  }
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
      // The SDK ignores the callback's return value; a rejection stays unhandled
      // exactly as before.
      OBR.onReady(() => void callback());
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
          }
        },
      ),
    setItemMetadata: () => Promise.reject(new Error("not implemented")),
    deleteItems: (ids) => OBR.scene.items.deleteItems(ids),
    getSceneMetadata: () => OBR.scene.getMetadata(),
    setSceneMetadata: (update) => OBR.scene.setMetadata(update),
    getViewportCenter: async () => {
      const [width, height] = await Promise.all([
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
      ]);
      return OBR.viewport.inverseTransformPoint({
        x: width / 2,
        y: height / 2,
      });
    },
  };
}
