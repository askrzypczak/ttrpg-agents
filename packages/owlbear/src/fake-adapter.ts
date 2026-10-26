import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import type { ImageUpload, ObrAdapter } from "./obr-adapter.js";
import {
  MissingSceneError,
  SceneModel,
  type ItemBounds,
  type SceneGrid,
  type Vec2,
} from "./scene-model.js";

/**
 * What the fake's image picker answers: art, a cancel (`undefined`), or a
 * function deciding per call from the default search it was opened with (it
 * may throw or reject).
 */
export type FakePick =
  | PublishedTokenArt
  | undefined
  | ((
      defaultSearch?: string,
    ) =>
      PublishedTokenArt | undefined | Promise<PublishedTokenArt | undefined>);

/** What the fake's image fetch answers: fixed bytes, or a function deciding per url (it may throw or reject). */
export type FakeFetch =
  Uint8Array | ((url: string) => Uint8Array | Promise<Uint8Array>);

/** In-memory ObrAdapter over a SceneModel, for browser-free unit tests. */
export function createFakeObr(
  scene: SceneModel = new SceneModel(),
  viewportCenter: Vec2 = { x: 0, y: 0 },
  options: {
    /** The image picker's answer. Default: the GM cancels. */
    pickImage?: FakePick;
    /** The image fetch's answer. Default: the fetch rejects. */
    fetchImage?: FakeFetch;
    /** Whether an image url answers, fixed or per url (it may throw or reject). Default: alive. */
    imageAlive?: boolean | ((url: string) => boolean | Promise<boolean>);
    /** The asset upload's outcome (it may throw or reject). Default: resolves. */
    uploadImage?: (image: ImageUpload) => void | Promise<void>;
    /** The scene grid the fake reports. Default: { dpi: 150, type: "SQUARE" }. */
    grid?: SceneGrid;
    /** The local items of this tab (`OBR.scene.local`). Default: a new, empty model. */
    local?: SceneModel;
    /** The bounds `getItemBounds` answers, per item id; an id without bounds rejects. */
    itemBounds?: Record<string, ItemBounds>;
  } = {},
): {
  obr: ObrAdapter;
  scene: SceneModel;
  /** The local items of this tab, apart from the scene's items. */
  local: SceneModel;
  /** How many times the image picker was opened. */
  pickImageCalls(): number;
  /** The images handed to the asset upload, in order (failed ones too). */
  uploads(): ImageUpload[];
} {
  let picks = 0;
  const uploaded: ImageUpload[] = [];
  // Like the real SDK, item calls reject while no scene is loaded.
  const whenReady = <T>(call: () => T): Promise<T> =>
    scene.isReady()
      ? Promise.resolve(call())
      : Promise.reject(new MissingSceneError());
  const grid: SceneGrid = options.grid ?? { dpi: 150, type: "SQUARE" };
  const local = options.local ?? new SceneModel();
  const obr: ObrAdapter = {
    onReady: (callback) => {
      void Promise.resolve().then(callback);
    },
    getRole: () => Promise.resolve(scene.role),
    isSceneReady: () => Promise.resolve(scene.isReady()),
    onSceneReadyChange: (callback) =>
      scene.onChange((change) => {
        if (change.kind === "ready") callback(change.ready);
      }),
    onItemsChange: (callback) =>
      scene.onChange((change) => {
        if (change.kind === "items") callback();
      }),
    addItems: (items) => whenReady(() => scene.addItems(items)),
    getItems: (filter) => whenReady(() => scene.getItems(filter)),
    updateItems: (ids, patch) => whenReady(() => scene.updateItems(ids, patch)),
    setItemMetadata: (updates) =>
      whenReady(() => scene.setItemMetadata(updates)),
    deleteItems: (ids) => whenReady(() => scene.deleteItems(ids)),
    addLocalItems: (items) => whenReady(() => local.addItems(items)),
    getLocalItems: (filter) => whenReady(() => local.getItems(filter)),
    deleteLocalItems: (ids) => whenReady(() => local.deleteItems(ids)),
    getSceneMetadata: () => Promise.resolve(scene.getMetadata()),
    setSceneMetadata: (update) => Promise.resolve(scene.setMetadata(update)),
    getViewportCenter: () => Promise.resolve({ ...viewportCenter }),
    getGrid: () => whenReady(() => ({ ...grid })),
    getItemBounds: (id) => {
      void id;
      return Promise.reject(new Error("not implemented"));
    },
    pickImage: async (defaultSearch) => {
      picks++;
      const pick = options.pickImage;
      return typeof pick === "function"
        ? await pick(defaultSearch)
        : structuredClone(pick);
    },
    fetchImage: async (url) => {
      const answer = options.fetchImage;
      if (answer === undefined)
        throw new Error(`fake fetch: no image configured for ${url}`);
      return typeof answer === "function" ? await answer(url) : answer.slice();
    },
    isImageAlive: async (url) => {
      const alive = options.imageAlive ?? true;
      return typeof alive === "function" ? await alive(url) : alive;
    },
    uploadImage: async (image) => {
      uploaded.push({ ...image, bytes: image.bytes.slice() });
      await options.uploadImage?.(image);
    },
    openPanel: () => Promise.resolve(),
  };
  return {
    obr,
    scene,
    local,
    pickImageCalls: () => picks,
    uploads: () => [...uploaded],
  };
}
