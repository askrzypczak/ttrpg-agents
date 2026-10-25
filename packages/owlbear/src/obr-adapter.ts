// The ONLY module allowed to import @owlbear-rodeo/sdk (enforced by ESLint).
// Everything else depends on the narrow ObrAdapter interface so it can be
// unit-tested against the fake in fake-adapter.ts.
import OBR, {
  buildImage,
  buildImageUpload,
  buildShape,
  type Item,
} from "@owlbear-rodeo/sdk";
import type { TokenArt } from "@ttrpg-agents/engine";
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
  /** Fires on any change to the scene's items. Returns an unsubscribe function. */
  onItemsChange(callback: () => void): () => void;
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
  /**
   * Asks the GM to pick one image from their Owlbear asset library, with
   * `defaultSearch` filled into its search box when given; resolves with its
   * reference, or `undefined` when they cancel.
   */
  pickImage(defaultSearch?: string): Promise<TokenArt | undefined>;
  /**
   * Fetches the bytes of an image by url; rejects on a network error or a
   * non-2xx answer.
   */
  fetchImage(url: string): Promise<Uint8Array>;
  /**
   * Whether an image url still answers: true on 2xx, false on 4xx; rejects
   * on a network error or any other status (cannot tell).
   */
  isImageAlive(url: string): Promise<boolean>;
  /**
   * Uploads image bytes to the GM's Owlbear asset library under `name`.
   * Resolves once the upload is handed over, before the GM confirms the
   * folder dialog.
   */
  uploadImage(image: ImageUpload): Promise<void>;
  /** Opens the extension's panel (its action popover). */
  openPanel(): Promise<void>;
}

/** Image bytes to upload to the Owlbear asset library, with the asset name. */
export type ImageUpload = { bytes: Uint8Array; mime: string; name: string };

/**
 * The read-only view of the adapter that query handling gets. A query never
 * changes the table, so a write through it does not compile.
 */
export type ObrReader = Pick<
  ObrAdapter,
  "isSceneReady" | "getItems" | "getSceneMetadata" | "getViewportCenter"
>;

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
    onItemsChange: (callback) => OBR.scene.items.onChange(() => callback()),
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
    setItemMetadata: (updates) => {
      const byId = new Map<string, { key: string; value: unknown }[]>();
      for (const { id, key, value } of updates)
        byId.set(id, [...(byId.get(id) ?? []), { key, value }]);
      if (byId.size === 0) return Promise.resolve();
      return OBR.scene.items.updateItems(
        (item) => byId.has(item.id),
        (drafts) => {
          for (const draft of drafts)
            for (const { key, value } of byId.get(draft.id)!) {
              if (value === undefined) delete draft.metadata[key];
              else draft.metadata[key] = value as Metadata[string];
            }
        },
      );
    },
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
    pickImage: async (defaultSearch) => {
      const [picked] = await (defaultSearch === undefined
        ? OBR.assets.downloadImages(false)
        : OBR.assets.downloadImages(false, defaultSearch, "CHARACTER"));
      if (!picked) return undefined;
      const { image } = picked;
      return {
        url: image.url,
        mime: image.mime,
        width: image.width,
        height: image.height,
      };
    },
    fetchImage: async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(
          `fetching the image failed with HTTP ${String(response.status)}`,
        );
      return new Uint8Array(await response.arrayBuffer());
    },
    isImageAlive: async (url) => {
      const response = await fetch(url, { cache: "no-cache" });
      // Only the status matters: do not download the whole image.
      void response.body?.cancel();
      const { status } = response;
      if (status >= 200 && status <= 299) return true;
      if (status >= 400 && status <= 499) return false;
      throw new Error(`checking the image url answered HTTP ${String(status)}`);
    },
    uploadImage: ({ bytes, mime, name }) =>
      OBR.assets.uploadImages(
        [
          buildImageUpload(new Blob([new Uint8Array(bytes)], { type: mime }))
            .name(name)
            .build(),
        ],
        "CHARACTER",
      ),
    openPanel: () => OBR.action.open(),
  };
}
