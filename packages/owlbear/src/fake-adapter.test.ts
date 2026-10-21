import { describe, expect, it } from "vitest";
import { createFakeObr } from "./fake-adapter.js";
import { SceneModel } from "./scene-model.js";

describe("createFakeObr", () => {
  it("rejects item calls with MissingDataError while the scene is not ready", async () => {
    const { obr, scene } = createFakeObr(new SceneModel("gm", false), {
      x: 5,
      y: 6,
    });
    const item = {
      id: "a",
      type: "SHAPE",
      name: "A",
      visible: true,
      position: { x: 0, y: 0 },
      metadata: {},
    };
    const calls = [
      () => obr.getItems(),
      () => obr.addItems([item]),
      () => obr.updateItems(["a"], { name: "B" }),
      () => obr.deleteItems(["a"]),
    ];
    for (const call of calls)
      await expect(call()).rejects.toMatchObject({
        name: "MissingDataError",
        message: "No scene found",
      });
    expect(await obr.getRole()).toBe("gm");
    expect(await obr.isSceneReady()).toBe(false);
    expect(await obr.getViewportCenter()).toEqual({ x: 5, y: 6 });
    scene.setReady(true);
    await obr.addItems([item]);
    expect((await obr.getItems()).map((i) => i.id)).toEqual(["a"]);
  });

  it("runs the onReady callback", async () => {
    const { obr } = createFakeObr();
    await new Promise<void>((resolve) => obr.onReady(resolve));
  });

  it("reports the role of the underlying scene", async () => {
    const { obr } = createFakeObr(new SceneModel("player"));
    expect(await obr.getRole()).toBe("player");
  });

  it("notifies scene-ready changes and supports unsubscribe", async () => {
    const { obr, scene } = createFakeObr(new SceneModel("gm", false));
    expect(await obr.isSceneReady()).toBe(false);
    const seen: boolean[] = [];
    const off = obr.onSceneReadyChange((r) => seen.push(r));
    scene.setReady(true);
    off();
    scene.setReady(false);
    expect(seen).toEqual([true]);
    expect(await obr.isSceneReady()).toBe(false);
  });

  describe("setItemMetadata", () => {
    const withMetadata = () => {
      const fake = createFakeObr();
      fake.scene.addItems([
        {
          id: "a",
          type: "SHAPE",
          name: "A",
          visible: false,
          position: { x: 0, y: 0 },
          metadata: { "other.ext/x": { keep: 1 }, "our/k": 1 },
        },
      ]);
      return fake;
    };

    it("keeps other keys", async () => {
      const { obr, scene } = withMetadata();
      await obr.setItemMetadata([{ id: "a", key: "our/k", value: { v: 2 } }]);
      expect(scene.getItems()[0]!.metadata).toEqual({
        "other.ext/x": { keep: 1 },
        "our/k": { v: 2 },
      });
    });

    it("`undefined` clears the key", async () => {
      const { obr, scene } = withMetadata();
      await obr.setItemMetadata([{ id: "a", key: "our/k", value: undefined }]);
      const metadata = scene.getItems()[0]!.metadata;
      expect(Object.keys(metadata)).toEqual(["other.ext/x"]);
    });

    it("ignores unknown ids", async () => {
      const { obr, scene } = withMetadata();
      const before = scene.getItems();
      await obr.setItemMetadata([{ id: "zzz", key: "our/k", value: 3 }]);
      expect(scene.getItems()).toEqual(before);
    });

    it("emits one items change", async () => {
      const { obr, scene } = withMetadata();
      const seen: string[] = [];
      scene.onChange((c) => seen.push(c.kind));
      await obr.setItemMetadata([
        { id: "a", key: "our/k", value: 5 },
        { id: "a", key: "our/j", value: 6 },
      ]);
      expect(seen).toEqual(["items"]);
      expect(scene.getItems()[0]!.metadata).toMatchObject({
        "our/k": 5,
        "our/j": 6,
      });
    });
  });

  it("round-trips items and metadata through the scene model", async () => {
    const { obr, scene } = createFakeObr();
    await obr.addItems([
      {
        id: "a",
        type: "IMAGE",
        name: "A",
        visible: true,
        position: { x: 1, y: 2 },
        metadata: {},
      },
    ]);
    await obr.updateItems(["a"], { name: "B" });
    expect((await obr.getItems())[0]?.name).toBe("B");
    await obr.setSceneMetadata({ k: 1 });
    expect(scene.getMetadata()).toEqual({ k: 1 });
    await obr.deleteItems(["a"]);
    expect(scene.getItems()).toEqual([]);
  });
});
