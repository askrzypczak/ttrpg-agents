import type { ObrAdapter } from "./obr-adapter.js";
import { SceneModel } from "./scene-model.js";

/** In-memory ObrAdapter over a SceneModel, for browser-free unit tests. */
export function createFakeObr(scene: SceneModel = new SceneModel()): {
  obr: ObrAdapter;
  scene: SceneModel;
} {
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
    addItems: (items) => Promise.resolve(scene.addItems(items)),
    getItems: (filter) => Promise.resolve(scene.getItems(filter)),
    updateItems: (ids, patch) => Promise.resolve(scene.updateItems(ids, patch)),
    deleteItems: (ids) => Promise.resolve(scene.deleteItems(ids)),
    getSceneMetadata: () => Promise.resolve(scene.getMetadata()),
    setSceneMetadata: (update) => Promise.resolve(scene.setMetadata(update)),
  };
  return { obr, scene };
}
