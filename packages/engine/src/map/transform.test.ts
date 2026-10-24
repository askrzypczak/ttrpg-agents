import { describe, expect, it } from "vitest";
import { mapTransform, type MapPlacement, type Point } from "../index.js";

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const TROLLSKULL: MapPlacement = {
  position: { x: 0, y: 0 },
  rotation: 270,
  scale: { x: 1, y: 1 },
  imageOffset: { x: 0, y: 0 },
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  sceneDpi: 150,
};

/** A placement with arbitrary non-trivial values, overridden per test. */
function placement(overrides: Partial<MapPlacement>): MapPlacement {
  return {
    position: { x: 321, y: -77 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    imageOffset: { x: 0, y: 0 },
    imageWidth: 3000,
    imageHeight: 4000,
    imageDpi: 125,
    sceneDpi: 150,
    ...overrides,
  };
}

const SAMPLE_POINTS: Point[] = [
  { x: 0, y: 0 },
  { x: 3000, y: 4000 },
  { x: 123.4, y: -56.7 },
  { x: 1500, y: 2000 },
  { x: -250, y: 3333.3 },
];

function expectPointClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

/** Image -> scene -> image and scene -> image -> scene both return the start. */
function expectRoundTrips(p: MapPlacement): void {
  const t = mapTransform(p);
  for (const point of SAMPLE_POINTS) {
    expectPointClose(t.sceneToImage(t.imageToScene(point)), point);
    expectPointClose(t.imageToScene(t.sceneToImage(point)), point);
  }
}

describe("mapTransform", () => {
  it("maps Trollskull's image corners to exact scene corners (and asserts the exact bounds 0..4800 by -3600..0)", () => {
    // k = 150 / 125 = 1.2; rotation 270 maps (x, y) to (y, -x).
    // (3000, 0) -> (0, -3600); (0, 4000) -> (4800, 0); (3000, 4000) -> (4800, -3600).
    const t = mapTransform(TROLLSKULL);
    expect(t.corners).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: -3600 },
      bottomLeft: { x: 4800, y: 0 },
      bottomRight: { x: 4800, y: -3600 },
    });
    expect(t.bounds).toEqual({
      min: { x: 0, y: -3600 },
      max: { x: 4800, y: 0 },
    });
    expect(t.imageToScene({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(t.imageToScene({ x: 3000, y: 0 })).toEqual({ x: 0, y: -3600 });
    expect(t.imageToScene({ x: 0, y: 4000 })).toEqual({ x: 4800, y: 0 });
    expect(t.imageToScene({ x: 3000, y: 4000 })).toEqual({
      x: 4800,
      y: -3600,
    });
  });

  it("is the identity when dpis match and the map is unrotated and unscaled", () => {
    const t = mapTransform(
      placement({ position: { x: 0, y: 0 }, imageDpi: 100, sceneDpi: 100 }),
    );
    for (const point of SAMPLE_POINTS) {
      expectPointClose(t.imageToScene(point), point);
      expectPointClose(t.sceneToImage(point), point);
    }
  });

  it("anchors the image offset point at the placement position", () => {
    const p = placement({
      position: { x: 500, y: -300 },
      imageOffset: { x: 40, y: 60 },
      rotation: 33.3,
      scale: { x: 2, y: 0.5 },
      imageDpi: 100,
      sceneDpi: 150,
    });
    const t = mapTransform(p);
    expectPointClose(t.imageToScene({ x: 40, y: 60 }), { x: 500, y: -300 });
    expectPointClose(t.sceneToImage({ x: 500, y: -300 }), { x: 40, y: 60 });
  });

  it("round-trips image px through scene units for rotations 0, 90, 180, 270 and 33.3", () => {
    for (const rotation of [0, 90, 180, 270, 33.3]) {
      expectRoundTrips(placement({ rotation }));
    }
  });

  it("round-trips with uniform and non-uniform scale", () => {
    for (const scale of [
      { x: 1.05, y: 1.05 },
      { x: 2, y: 2 },
      { x: 2, y: 0.5 },
      { x: 0.75, y: 1.3 },
    ]) {
      expectRoundTrips(placement({ rotation: 33.3, scale }));
      expectRoundTrips(placement({ rotation: 270, scale }));
    }
  });

  it("round-trips with non-zero image offsets", () => {
    for (const imageOffset of [
      { x: 50, y: 0 },
      { x: 0, y: -75 },
      { x: 1500, y: 2000 },
    ]) {
      expectRoundTrips(
        placement({ rotation: 33.3, scale: { x: 1.5, y: 0.8 }, imageOffset }),
      );
    }
  });

  it("uses exact sine and cosine for multiples of 90 degrees (270 gives no float noise)", () => {
    // Matching dpis, no scale, origin position: clockwise with y down,
    // 90 maps (x, y) to (-y, x), 180 to (-x, -y), 270 to (y, -x).
    const at = (rotation: number) =>
      mapTransform(
        placement({
          position: { x: 0, y: 0 },
          rotation,
          imageDpi: 100,
          sceneDpi: 100,
        }),
      );
    expect(at(90).imageToScene({ x: 1000, y: 0 })).toEqual({ x: 0, y: 1000 });
    expect(at(180).imageToScene({ x: 1000, y: 0 })).toEqual({ x: -1000, y: 0 });
    expect(at(270).imageToScene({ x: 1000, y: 0 })).toEqual({ x: 0, y: -1000 });
    expect(at(90).imageToScene({ x: 0, y: 500 })).toEqual({ x: -500, y: 0 });
    expect(at(180).imageToScene({ x: 0, y: 500 })).toEqual({ x: 0, y: -500 });
    expect(at(270).imageToScene({ x: 0, y: 500 })).toEqual({ x: 500, y: 0 });
    expect(at(270).sceneToImage({ x: 0, y: -1000 })).toEqual({ x: 1000, y: 0 });
  });

  it("normalises negative and over-360 rotations", () => {
    const trollskullCorners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: -3600 },
      bottomLeft: { x: 4800, y: 0 },
      bottomRight: { x: 4800, y: -3600 },
    };
    // -90 and 630 are both 270.
    expect(mapTransform({ ...TROLLSKULL, rotation: -90 }).corners).toEqual(
      trollskullCorners,
    );
    expect(mapTransform({ ...TROLLSKULL, rotation: 630 }).corners).toEqual(
      trollskullCorners,
    );
    // 450 and -270 are both 90, which maps (x, y) to (-y, x):
    // (3000, 0) -> (0, 3600); (0, 4000) -> (-4800, 0).
    const ninetyCorners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: 3600 },
      bottomLeft: { x: -4800, y: 0 },
      bottomRight: { x: -4800, y: 3600 },
    };
    expect(mapTransform({ ...TROLLSKULL, rotation: 450 }).corners).toEqual(
      ninetyCorners,
    );
    expect(mapTransform({ ...TROLLSKULL, rotation: -270 }).corners).toEqual(
      ninetyCorners,
    );
    // 393.3 is 33.3.
    const reference = mapTransform(placement({ rotation: 33.3 }));
    const wrapped = mapTransform(placement({ rotation: 393.3 }));
    for (const point of SAMPLE_POINTS) {
      expectPointClose(
        wrapped.imageToScene(point),
        reference.imageToScene(point),
      );
    }
  });
});
