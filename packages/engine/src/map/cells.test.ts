import { describe, expect, it } from "vitest";
import { cellCenter, sceneToCell } from "../index.js";

describe("sceneToCell", () => {
  it("floors negative scene coordinates to negative cells", () => {
    expect(sceneToCell({ x: -1, y: -150.5 }, 150)).toEqual({
      col: -1,
      row: -2,
    });
    expect(sceneToCell({ x: -0.001, y: -149.999 }, 150)).toEqual({
      col: -1,
      row: -1,
    });
    expect(sceneToCell({ x: -151, y: 299 }, 150)).toEqual({ col: -2, row: 1 });
  });

  it("puts a point on a cell boundary in the cell it starts", () => {
    expect(sceneToCell({ x: 150, y: 300 }, 150)).toEqual({ col: 1, row: 2 });
    expect(sceneToCell({ x: -150, y: -300 }, 150)).toEqual({
      col: -1,
      row: -2,
    });
    expect(sceneToCell({ x: 0, y: 0 }, 150)).toEqual({ col: 0, row: 0 });
  });
});

describe("cellCenter", () => {
  it("returns the centre of a negative cell", () => {
    // (col + 0.5) * dpi: (-1 + 0.5) * 150 = -75, (-2 + 0.5) * 150 = -225.
    expect(cellCenter({ col: -1, row: -2 }, 150)).toEqual({ x: -75, y: -225 });
    expect(cellCenter({ col: -3, row: 0 }, 100)).toEqual({ x: -250, y: 50 });
  });
});
