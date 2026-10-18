import type { ImagePick, ObrAdapter } from "./obr-adapter.js";
import { SceneModel, type Vec2 } from "./scene-model.js";

/**
 * Scriptable asset picker: each `pickImage` call consumes the next entry of
 * `results` (an Error rejects; undefined or an exhausted queue is a cancel).
 */
export interface FakePicker {
  results: (ImagePick | Error | undefined)[];
  calls: number;
  /** The `search` argument of each call, in order. */
  searches: (string | undefined)[];
}

/** In-memory ObrAdapter over a SceneModel, for browser-free unit tests. */
export function createFakeObr(
  scene: SceneModel = new SceneModel(),
  viewportCenter: Vec2 = { x: 0, y: 0 },
): {
  obr: ObrAdapter;
  scene: SceneModel;
  picker: FakePicker;
} {
  const picker: FakePicker = {
    results: [],
    calls: 0,
    searches: [],
  };
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
    getViewportCenter: () => Promise.resolve({ ...viewportCenter }),
    pickImage: (search) => {
      picker.calls++;
      picker.searches.push(search);
      const next = picker.results.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
  };
  return { obr, scene, picker };
}
