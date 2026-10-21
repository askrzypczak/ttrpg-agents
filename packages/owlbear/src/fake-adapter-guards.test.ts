import { describe, expect, it } from "vitest";
import { createFakeObr } from "./fake-adapter.js";
import { SceneModel } from "./scene-model.js";

describe("createFakeObr guards", () => {
  it("defaults the viewport centre to the origin", async () => {
    const { obr } = createFakeObr();
    expect(await obr.getViewportCenter()).toEqual({ x: 0, y: 0 });
  });

  it("only calls ready listeners for ready changes", () => {
    const { obr, scene } = createFakeObr(new SceneModel("gm", true));
    const seen: boolean[] = [];
    obr.onSceneReadyChange((ready) => seen.push(ready));
    scene.addItems([
      {
        id: "a",
        type: "SHAPE",
        name: "a",
        visible: true,
        position: { x: 0, y: 0 },
        metadata: {},
      },
    ]);
    scene.setMetadata({ k: 1 });
    expect(seen).toEqual([]);
    scene.setReady(false);
    expect(seen).toEqual([false]);
  });
});
