// The ONLY module allowed to import @owlbear-rodeo/sdk (enforced by ESLint).
// Everything else depends on the narrow ObrAdapter interface so it can be
// unit-tested against the fake in fake-adapter.ts.
import OBR, {
  buildCurve,
  buildImage,
  buildImageUpload,
  buildLine,
  buildShape,
  buildText,
  isImage,
  isShape,
  type Item,
} from "@owlbear-rodeo/sdk";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import type {
  ItemBounds,
  ItemPatch,
  Metadata,
  PlayerRole,
  SceneGrid,
  SceneItem,
  Vec2,
} from "./scene-model.js";

/** A liveness check unanswered for this long counts as cannot tell. */
const IMAGE_ALIVE_TIMEOUT_MS = 5000;

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
  /**
   * Writes the given top-level fields; `image` and `grid` apply to IMAGE
   * items only, `shape` to SHAPE items only.
   */
  updateItems(ids: string[], patch: Omit<ItemPatch, "metadata">): Promise<void>;
  /**
   * Key-level item metadata write: sets `key` on item `id` and keeps its other
   * keys; `undefined` clears the key. Grouped per item in one SDK call.
   */
  setItemMetadata(
    updates: { id: string; key: string; value: unknown }[],
  ): Promise<void>;
  deleteItems(ids: string[]): Promise<void>;
  /** Adds items only this tab sees (`OBR.scene.local`); nothing reaches the scene. */
  addLocalItems(items: SceneItem[]): Promise<void>;
  /** The local items of this tab, optionally filtered. */
  getLocalItems(filter?: (item: SceneItem) => boolean): Promise<SceneItem[]>;
  /** Deletes local items of this tab by id. */
  deleteLocalItems(ids: string[]): Promise<void>;
  getSceneMetadata(): Promise<Metadata>;
  /** Shallow-merges into existing scene metadata. */
  setSceneMetadata(update: Metadata): Promise<void>;
  /** Scene coordinates of the middle of the GM's current view. */
  getViewportCenter(): Promise<Vec2>;
  /** The scene grid's dpi and type. */
  getGrid(): Promise<SceneGrid>;
  /** The axis-aligned bounds of item `id`, in scene units. */
  getItemBounds(id: string): Promise<ItemBounds>;
  /**
   * Asks the GM to pick one image from their Owlbear asset library, with
   * `defaultSearch` filled into its search box when given; resolves with its
   * reference, or `undefined` when they cancel.
   */
  pickImage(defaultSearch?: string): Promise<PublishedTokenArt | undefined>;
  /**
   * Fetches the bytes of an image by url; rejects on a network error or a
   * non-2xx answer.
   */
  fetchImage(url: string): Promise<Uint8Array>;
  /**
   * Whether an image url still answers: true on 2xx, false on 4xx; rejects
   * on a network error, any other status, or no answer within the timeout
   * (cannot tell).
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
  | "isSceneReady"
  | "getItems"
  | "getSceneMetadata"
  | "getViewportCenter"
  | "getGrid"
  | "getItemBounds"
  | "fetchImage"
>;

function toItem(item: SceneItem): Item {
  const common = <
    B extends {
      id(id: string): B;
      name(name: string): B;
      visible(visible: boolean): B;
      position(position: Vec2): B;
      metadata(metadata: Metadata): B;
      layer(layer: NonNullable<SceneItem["layer"]>): B;
      rotation(rotation: number): B;
      locked(locked: boolean): B;
      disableHit(disableHit: boolean): B;
    },
  >(
    builder: B,
  ): B =>
    builder
      .id(item.id)
      .name(item.name)
      .visible(item.visible)
      .position(item.position)
      .metadata(item.metadata)
      .layer(item.layer ?? "CHARACTER")
      .rotation(item.rotation ?? 0)
      .locked(item.locked ?? false)
      .disableHit(item.disableHit ?? false);
  switch (item.type) {
    case "SHAPE": {
      if (!item.shape)
        throw new Error(`SHAPE item ${item.id} needs a shape spec`);
      return common(buildShape())
        .scale(item.scale ?? { x: 1, y: 1 })
        .shapeType(item.shape.shapeType)
        .width(item.shape.width)
        .height(item.shape.height)
        .build();
    }
    case "IMAGE": {
      if (!item.image || !item.grid)
        throw new Error(`IMAGE item ${item.id} needs image and grid specs`);
      return common(buildImage(item.image, item.grid))
        .scale(item.scale ?? { x: 1, y: 1 })
        .build();
    }
    case "TEXT": {
      const { text } = item;
      if (!text) throw new Error(`TEXT item ${item.id} needs a text spec`);
      return common(buildText())
        .textType("PLAIN")
        .plainText(text.plainText)
        .width(text.width)
        .height(text.height)
        .textAlign(text.align)
        .textAlignVertical(text.alignVertical)
        .fontSize(text.fontSize)
        .fillColor(text.fillColor)
        .strokeColor(text.strokeColor)
        .strokeWidth(text.strokeWidth)
        .build();
    }
    case "LINE": {
      const { line } = item;
      if (!line) throw new Error(`LINE item ${item.id} needs a line spec`);
      return common(buildLine())
        .startPosition(line.start)
        .endPosition(line.end)
        .strokeColor(line.stroke.color)
        .strokeWidth(line.stroke.width)
        .strokeDash(line.stroke.dash)
        .build();
    }
    case "CURVE": {
      const { curve } = item;
      if (!curve) throw new Error(`CURVE item ${item.id} needs a curve spec`);
      return common(buildCurve())
        .points(curve.points)
        .tension(0)
        .closed(true)
        .fillOpacity(0)
        .strokeColor(curve.stroke.color)
        .strokeWidth(curve.stroke.width)
        .strokeDash(curve.stroke.dash)
        .build();
    }
    default:
      throw new Error(`adding ${item.type} items is not supported yet`);
  }
}

// Read-side fields are copied as given, without reading into them: the e2e fake
// host serves items that may lack them, and copying an absent field is harmless.
function fromItem(item: Item): SceneItem {
  const read: SceneItem = {
    id: item.id,
    type: item.type,
    name: item.name,
    visible: item.visible,
    position: { x: item.position.x, y: item.position.y },
    metadata: item.metadata,
    layer: item.layer,
    rotation: item.rotation,
    scale: item.scale,
    locked: item.locked,
  };
  if (isImage(item)) {
    read.image = item.image;
    read.grid = item.grid;
  }
  return read;
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
            if (patch.scale !== undefined) draft.scale = patch.scale;
            if (isImage(draft)) {
              if (patch.image !== undefined) draft.image = patch.image;
              if (patch.grid !== undefined) draft.grid = patch.grid;
            }
            if (isShape(draft) && patch.shape !== undefined) {
              draft.shapeType = patch.shape.shapeType;
              draft.width = patch.shape.width;
              draft.height = patch.shape.height;
            }
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
    addLocalItems: (items) => OBR.scene.local.addItems(items.map(toItem)),
    getLocalItems: async (filter) => {
      const items = (await OBR.scene.local.getItems()).map(fromItem);
      return filter ? items.filter(filter) : items;
    },
    deleteLocalItems: (ids) => OBR.scene.local.deleteItems(ids),
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
    getGrid: async () => {
      const [dpi, type] = await Promise.all([
        OBR.scene.grid.getDpi(),
        OBR.scene.grid.getType(),
      ]);
      return { dpi, type };
    },
    getItemBounds: async (id) => {
      const { min, max } = await OBR.scene.items.getItemBounds([id]);
      return { min: { x: min.x, y: min.y }, max: { x: max.x, y: max.y } };
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
      const response = await fetch(url, {
        cache: "no-cache",
        signal: AbortSignal.timeout(IMAGE_ALIVE_TIMEOUT_MS),
      });
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
