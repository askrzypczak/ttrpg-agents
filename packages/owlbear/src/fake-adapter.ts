import type { ObrAdapter } from "./obr-adapter.js";
import { MissingSceneError, SceneModel, type Vec2 } from "./scene-model.js";

/** In-memory ObrAdapter over a SceneModel, for browser-free unit tests. */
export function createFakeObr(
  scene: SceneModel = new SceneModel(),
  viewportCenter: Vec2 = { x: 0, y: 0 },
): {
  obr: ObrAdapter;
  scene: SceneModel;
} {
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
    // Stub: never fires (#163 implements it over scene.onChange).
    onItemsChange: () => () => {},
    addItems: (items) => whenReady(() => scene.addItems(items)),
    getItems: (filter) => whenReady(() => scene.getItems(filter)),
    updateItems: (ids, patch) => whenReady(() => scene.updateItems(ids, patch)),
    setItemMetadata: (updates) =>
      whenReady(() => scene.setItemMetadata(updates)),
    deleteItems: (ids) => whenReady(() => scene.deleteItems(ids)),
    getSceneMetadata: () => Promise.resolve(scene.getMetadata()),
    setSceneMetadata: (update) => Promise.resolve(scene.setMetadata(update)),
    getViewportCenter: () => Promise.resolve({ ...viewportCenter }),
  };
  return { obr, scene };
}
