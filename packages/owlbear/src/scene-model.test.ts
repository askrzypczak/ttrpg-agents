import { describe, expect, it } from "vitest";
import { SceneModel, type SceneChange, type SceneItem } from "./scene-model.js";

const item = (id: string, over: Partial<SceneItem> = {}): SceneItem => ({
  id,
  type: "IMAGE",
  name: id,
  visible: true,
  position: { x: 0, y: 0 },
  metadata: {},
  ...over,
});

describe("SceneModel", () => {
  it("adds and gets items, with optional filter", () => {
    const m = new SceneModel();
    m.addItems([item("a"), item("b", { visible: false })]);
    expect(m.getItems().map((i) => i.id)).toEqual(["a", "b"]);
    expect(m.getItems((i) => !i.visible).map((i) => i.id)).toEqual(["b"]);
  });

  it("rejects duplicate ids", () => {
    const m = new SceneModel();
    m.addItems([item("a")]);
    expect(() => m.addItems([item("a")])).toThrow(/duplicate/);
  });

  it("returns copies so callers cannot mutate the scene", () => {
    const m = new SceneModel();
    m.addItems([item("a")]);
    m.getItems()[0]!.name = "changed";
    expect(m.getItems()[0]!.name).toBe("a");
  });

  it("updates only the listed items and ignores unknown ids", () => {
    const m = new SceneModel();
    m.addItems([item("a"), item("b")]);
    m.updateItems(["a", "zzz"], { name: "new", visible: false });
    expect(m.getItems().map((i) => [i.name, i.visible])).toEqual([
      ["new", false],
      ["b", true],
    ]);
  });

  it("ignores explicit-undefined patch keys", () => {
    const m = new SceneModel();
    m.addItems([item("a", { name: "keep" })]);
    m.updateItems(["a"], { name: undefined, visible: false });
    expect(m.getItems()[0]).toMatchObject({ name: "keep", visible: false });
  });

  it("emits item changes only when an item matched", () => {
    const m = new SceneModel();
    m.addItems([item("a")]);
    const seen: SceneChange[] = [];
    m.onChange((c) => seen.push(c));
    m.updateItems(["nope"], { name: "x" });
    m.deleteItems(["nope"]);
    expect(seen).toEqual([]);
    m.updateItems(["a"], { name: "x" });
    m.deleteItems(["a"]);
    expect(seen).toEqual([{ kind: "items" }, { kind: "items" }]);
  });

  it("deletes items", () => {
    const m = new SceneModel();
    m.addItems([item("a"), item("b")]);
    m.deleteItems(["a"]);
    expect(m.getItems().map((i) => i.id)).toEqual(["b"]);
  });

  describe("setItemMetadata", () => {
    const withMetadata = () => {
      const m = new SceneModel();
      m.addItems([
        item("a", { metadata: { "other.ext/x": { keep: 1 }, "our/k": 1 } }),
        item("b", { metadata: { "our/k": 2 } }),
      ]);
      return m;
    };

    it("keeps other keys", () => {
      const m = withMetadata();
      m.setItemMetadata([
        { id: "a", key: "our/k", value: { v: 10 } },
        { id: "a", key: "our/new", value: "n" },
      ]);
      expect(m.getItems().map((i) => i.metadata)).toEqual([
        { "other.ext/x": { keep: 1 }, "our/k": { v: 10 }, "our/new": "n" },
        { "our/k": 2 },
      ]);
    });

    it("`undefined` clears the key", () => {
      const m = withMetadata();
      m.setItemMetadata([{ id: "a", key: "our/k", value: undefined }]);
      const metadata = m.getItems()[0]!.metadata;
      expect(Object.keys(metadata)).toEqual(["other.ext/x"]);
      expect(metadata).toEqual({ "other.ext/x": { keep: 1 } });
    });

    it("ignores unknown ids", () => {
      const m = withMetadata();
      const before = m.getItems();
      const seen: SceneChange[] = [];
      m.onChange((c) => seen.push(c));
      m.setItemMetadata([{ id: "zzz", key: "our/k", value: 3 }]);
      expect(m.getItems()).toEqual(before);
      expect(seen).toEqual([]);
    });

    it("emits one items change", () => {
      const m = withMetadata();
      const seen: SceneChange[] = [];
      m.onChange((c) => seen.push(c));
      m.setItemMetadata([
        { id: "a", key: "our/k", value: 5 },
        { id: "b", key: "our/k", value: 6 },
        { id: "b", key: "our/j", value: 7 },
      ]);
      expect(seen).toEqual([{ kind: "items" }]);
      expect(m.getItems().map((i) => i.metadata["our/k"])).toEqual([5, 6]);
    });
  });

  it("sets scene metadata by shallow merge", () => {
    const m = new SceneModel();
    m.setMetadata({ a: 1, b: 1 });
    m.setMetadata({ b: 2 });
    expect(m.getMetadata()).toEqual({ a: 1, b: 2 });
  });

  it("holds the role and ready flag", () => {
    const m = new SceneModel("player", false);
    expect(m.role).toBe("player");
    expect(m.isReady()).toBe(false);
  });

  it("notifies listeners of changes until unsubscribed", () => {
    const m = new SceneModel("gm", false);
    const seen: SceneChange[] = [];
    const off = m.onChange((c) => seen.push(c));
    m.addItems([item("a")]);
    m.setMetadata({ x: 1 });
    m.setReady(true);
    m.setReady(true); // no-op
    expect(seen).toEqual([
      { kind: "items" },
      { kind: "metadata" },
      { kind: "ready", ready: true },
    ]);
    off();
    m.deleteItems(["a"]);
    expect(seen).toHaveLength(3);
  });
});
