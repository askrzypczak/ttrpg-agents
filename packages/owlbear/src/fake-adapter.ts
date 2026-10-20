import type { ImagePick, ObrAdapter } from "./obr-adapter.js";
import { MissingSceneError, SceneModel, type Vec2 } from "./scene-model.js";

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
    addItems: (items) => whenReady(() => scene.addItems(items)),
    getItems: (filter) => whenReady(() => scene.getItems(filter)),
    updateItems: (ids, patch) => whenReady(() => scene.updateItems(ids, patch)),
    deleteItems: (ids) => whenReady(() => scene.deleteItems(ids)),
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
