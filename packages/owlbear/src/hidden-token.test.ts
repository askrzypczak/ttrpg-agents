import { describe, expect, it } from "vitest";
import { createFakeObr } from "./fake-adapter.js";
import { addHiddenToken } from "./hidden-token.js";

describe("addHiddenToken", () => {
  it("adds an invisible, named, positioned token retrievable from the scene", async () => {
    const { obr, scene } = createFakeObr();
    await addHiddenToken(obr, {
      id: "t1",
      name: "Goblin 1",
      position: { x: 120, y: 80 },
      image: {
        url: "https://example.test/goblin.png",
        mime: "image/png",
        width: 150,
        height: 150,
      },
      grid: { dpi: 150, offset: { x: 75, y: 75 } },
    });
    const [stored, ...rest] = await obr.getItems();
    expect(rest).toEqual([]);
    expect(stored).toMatchObject({
      id: "t1",
      name: "Goblin 1",
      visible: false,
      position: { x: 120, y: 80 },
      image: { url: "https://example.test/goblin.png", mime: "image/png" },
      grid: { dpi: 150 },
    });
    expect(scene.getItems((i) => i.visible)).toEqual([]);
  });
});
