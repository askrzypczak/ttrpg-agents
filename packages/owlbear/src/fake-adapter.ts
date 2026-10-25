import type { TokenArt } from "@ttrpg-agents/engine";
import type { ObrAdapter } from "./obr-adapter.js";
import { MissingSceneError, SceneModel, type Vec2 } from "./scene-model.js";

/** What the fake's image picker answers: art, a cancel (`undefined`), or a function deciding per call (it may throw or reject). */
export type FakePick =
  | TokenArt
  | undefined
  | (() => TokenArt | undefined | Promise<TokenArt | undefined>);

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
  } = {},
): {
  obr: ObrAdapter;
  scene: SceneModel;
  /** How many times the image picker was opened. */
  pickImageCalls(): number;
} {
  let picks = 0;
  // Like the real SDK, item calls reject while no scene is loaded.
  const whenReady = <T>(call: () => T): Promise<T> =>
    scene.isReady()
      ? Promise.resolve(call())
      : Promise.reject(new MissingSceneError());
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
    getSceneMetadata: () => Promise.resolve(scene.getMetadata()),
    setSceneMetadata: (update) => Promise.resolve(scene.setMetadata(update)),
    getViewportCenter: () => Promise.resolve({ ...viewportCenter }),
    pickImage: async () => {
      picks++;
      const pick = options.pickImage;
      return typeof pick === "function" ? await pick() : structuredClone(pick);
    },
    fetchImage: async (url) => {
      const answer = options.fetchImage;
      if (answer === undefined)
        throw new Error(`fake fetch: no image configured for ${url}`);
      return typeof answer === "function" ? await answer(url) : answer.slice();
    },
  };
  return { obr, scene, pickImageCalls: () => picks };
}
