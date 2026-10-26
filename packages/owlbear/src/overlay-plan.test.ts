import { describe, expect, it } from "vitest";
import type { MapPlacement, SavedRoom } from "@ttrpg-agents/engine";
import {
  OVERLAY_METADATA_KEY,
  mapPlacementOf,
  planOverlay,
  type OverlayPart,
} from "./overlay-plan.js";
import type { SceneItem, TextSpec, Vec2 } from "./scene-model.js";

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

// The display grid is 32 columns (A..AF) by 24 rows from scene cell (0, -24):
// on the scene it spans x 0..4800 and y -3600..0.
const D = 150;
const LEFT = 0;
const TOP = -3600;
const COLS = 32;
const ROWS = 24;

/** T5:AB11 in image px; on the scene it is x 2850..4200, y -3000..-1950. */
const T5_AB11 = [
  { x: 1625, y: 2375 },
  { x: 2500, y: 2375 },
  { x: 2500, y: 3500 },
  { x: 1625, y: 3500 },
];
const T5_AB11_SCENE = [
  { x: 2850, y: -3000 },
  { x: 4200, y: -3000 },
  { x: 4200, y: -1950 },
  { x: 2850, y: -1950 },
];

const taproom: SavedRoom = {
  name: "Taproom",
  status: "confirmed",
  polygons: [T5_AB11],
};

const COLUMN_LETTERS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "AA",
  "AB",
  "AC",
  "AD",
  "AE",
  "AF",
];

const partOf = (item: SceneItem): OverlayPart | undefined =>
  (item.metadata[OVERLAY_METADATA_KEY] as { part?: OverlayPart } | undefined)
    ?.part;

const byPart = (items: SceneItem[], part: OverlayPart): SceneItem[] =>
  items.filter((item) => partOf(item) === part);

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

/** A line's ends on the scene. */
const lineEnds = (item: SceneItem): [Vec2, Vec2] => [
  add(item.position, item.line!.start),
  add(item.position, item.line!.end),
];

/** A curve's distinct points on the scene, rounded and sorted. */
const curveCorners = (item: SceneItem): string[] =>
  [
    ...new Set(
      item.curve!.points.map((p) => {
        const s = add(item.position, p);
        return `${Math.round(s.x)},${Math.round(s.y)}`;
      }),
    ),
  ].sort();

const corners = (points: Vec2[]): string[] =>
  points.map((p) => `${p.x},${p.y}`).sort();

/** A text box's centre on the scene. */
const boxCentre = (item: SceneItem): Vec2 => ({
  x: item.position.x + item.text!.width / 2,
  y: item.position.y + item.text!.height / 2,
});

const textOf = (item: SceneItem): TextSpec => item.text!;

describe("planOverlay", () => {
  it("Trollskull at rotation 270 gets column labels A to AF, one per column, centred on its column above the grid's top edge", () => {
    const labels = byPart(planOverlay(TROLLSKULL, []), "column-label").sort(
      (a, b) => boxCentre(a).x - boxCentre(b).x,
    );

    expect(labels.map((l) => l.type)).toEqual(Array(COLS).fill("TEXT"));
    expect(labels.map((l) => textOf(l).plainText)).toEqual(COLUMN_LETTERS);
    labels.forEach((label, c) => {
      expect(boxCentre(label).x).toBeCloseTo(LEFT + (c + 0.5) * D);
      expect(label.position.y + textOf(label).height).toBeLessThanOrEqual(TOP);
      expect(textOf(label).align).toBe("CENTER");
    });
  });

  it("Trollskull at rotation 270 gets row labels 1 to 24, one per row, centred on its row left of the grid's left edge", () => {
    const labels = byPart(planOverlay(TROLLSKULL, []), "row-label").sort(
      (a, b) => boxCentre(a).y - boxCentre(b).y,
    );

    expect(labels.map((l) => l.type)).toEqual(Array(ROWS).fill("TEXT"));
    expect(labels.map((l) => textOf(l).plainText)).toEqual(
      Array.from({ length: ROWS }, (_, r) => String(r + 1)),
    );
    labels.forEach((label, r) => {
      expect(boxCentre(label).y).toBeCloseTo(TOP + (r + 0.5) * D);
      expect(label.position.x + textOf(label).width).toBeLessThanOrEqual(LEFT);
      expect(textOf(label).align).toBe("RIGHT");
      expect(textOf(label).alignVertical).toBe("MIDDLE");
    });
  });

  it("every column and row gets one tick from the grid edge outward at its centre", () => {
    const items = planOverlay(TROLLSKULL, []);
    const columnTicks = byPart(items, "column-tick")
      .map(lineEnds)
      .sort((a, b) => a[0].x - b[0].x);
    const rowTicks = byPart(items, "row-tick")
      .map(lineEnds)
      .sort((a, b) => a[0].y - b[0].y);

    expect(byPart(items, "column-tick").map((t) => t.type)).toEqual(
      Array(COLS).fill("LINE"),
    );
    expect(byPart(items, "row-tick").map((t) => t.type)).toEqual(
      Array(ROWS).fill("LINE"),
    );
    columnTicks.forEach(([start, end], c) => {
      expect(start.x).toBeCloseTo(LEFT + (c + 0.5) * D);
      expect(start.y).toBeCloseTo(TOP);
      expect(end.x).toBeCloseTo(start.x);
      expect(end.y).toBeLessThan(TOP);
    });
    rowTicks.forEach(([start, end], r) => {
      expect(start.x).toBeCloseTo(LEFT);
      expect(start.y).toBeCloseTo(TOP + (r + 0.5) * D);
      expect(end.y).toBeCloseTo(start.y);
      expect(end.x).toBeLessThan(LEFT);
    });
  });

  it("a room saved from T5:AB11 gets a closed outline on that rectangle and its name inside it", () => {
    const items = planOverlay(TROLLSKULL, [taproom]);
    const outlines = byPart(items, "room-outline");
    const names = byPart(items, "room-name");

    expect(outlines).toHaveLength(1);
    expect(outlines[0]!.type).toBe("CURVE");
    expect(curveCorners(outlines[0]!)).toEqual(corners(T5_AB11_SCENE));
    expect(names).toHaveLength(1);
    expect(names[0]!.type).toBe("TEXT");
    expect(textOf(names[0]!).plainText).toBe("Taproom");
    const centre = boxCentre(names[0]!);
    expect(centre.x).toBeCloseTo((2850 + 4200) / 2);
    expect(centre.y).toBeCloseTo((-3000 + -1950) / 2);
    expect(textOf(names[0]!).align).toBe("CENTER");
    expect(textOf(names[0]!).alignVertical).toBe("MIDDLE");
  });

  it("a proposed room's outline and name are styled differently from a confirmed room's", () => {
    const confirmed = planOverlay(TROLLSKULL, [taproom]);
    const proposed = planOverlay(TROLLSKULL, [
      { ...taproom, status: "proposed" },
    ]);
    const outline = (items: SceneItem[]) => byPart(items, "room-outline")[0]!;
    const name = (items: SceneItem[]) => textOf(byPart(items, "room-name")[0]!);

    expect(outline(confirmed).curve!.stroke.color).toBe("#3fb950");
    expect(outline(confirmed).curve!.stroke.dash).toEqual([]);
    expect(outline(proposed).curve!.stroke.color).toBe("#d29922");
    expect(outline(proposed).curve!.stroke.dash).toEqual([D / 6, D / 12]);
    expect(name(confirmed).plainText).toBe("Taproom");
    expect(name(proposed).plainText).toBe("Taproom (proposed)");
    expect(name(proposed).fillColor).not.toBe(name(confirmed).fillColor);
  });

  it("a room with two polygons gets an outline for each and one name", () => {
    const annex = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
      { x: 0, y: 500 },
    ];
    const items = planOverlay(TROLLSKULL, [
      { name: "Cellar", status: "confirmed", polygons: [T5_AB11, annex] },
    ]);
    const outlines = byPart(items, "room-outline");
    const names = byPart(items, "room-name");

    expect(outlines.map(curveCorners).sort()).toEqual(
      [
        corners(T5_AB11_SCENE),
        // Image (u, v) is scene (1.2v, -1.2u).
        corners([
          { x: 0, y: 0 },
          { x: 0, y: -600 },
          { x: 600, y: -600 },
          { x: 600, y: 0 },
        ]),
      ].sort(),
    );
    expect(names.map((n) => textOf(n).plainText)).toEqual(["Cellar"]);
    // Named in the first polygon.
    expect(boxCentre(names[0]!).x).toBeCloseTo((2850 + 4200) / 2);
    expect(boxCentre(names[0]!).y).toBeCloseTo((-3000 + -1950) / 2);
  });

  it("every planned item is a locked, unhittable item carrying the overlay metadata key", () => {
    const items = planOverlay(TROLLSKULL, [
      taproom,
      {
        name: "Kitchen",
        status: "proposed",
        polygons: [
          [
            { x: 0, y: 0 },
            { x: 500, y: 0 },
            { x: 500, y: 500 },
          ],
        ],
      },
    ]);
    const parts: OverlayPart[] = [
      "column-label",
      "column-tick",
      "row-label",
      "row-tick",
      "room-outline",
      "room-name",
    ];

    expect(items).toHaveLength(2 * COLS + 2 * ROWS + 4);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(planOverlay(TROLLSKULL, [taproom]).map((i) => i.id)).toEqual(
      planOverlay(TROLLSKULL, [taproom]).map((i) => i.id),
    );
    for (const item of items) {
      expect(item.id.startsWith("ttrpg-overlay-")).toBe(true);
      expect(item.layer).toBe("DRAWING");
      expect(item.locked).toBe(true);
      expect(item.disableHit).toBe(true);
      expect(item.visible).toBe(true);
      expect(Object.keys(item.metadata)).toEqual([OVERLAY_METADATA_KEY]);
      expect(parts).toContain(partOf(item));
      if (item.type === "LINE" || item.type === "CURVE")
        expect(item.position).toEqual({ x: 0, y: 0 });
    }
  });
});

describe("mapPlacementOf", () => {
  const trollskull: SceneItem = {
    id: "trollskull",
    type: "IMAGE",
    name: "Trollskull Manor",
    visible: true,
    position: { x: 0, y: 0 },
    metadata: {},
    layer: "MAP",
    rotation: 270,
    scale: { x: 1, y: 1 },
    image: {
      url: "https://example.test/trollskull.webp",
      mime: "image/webp",
      width: 3000,
      height: 4000,
    },
    grid: { dpi: 125, offset: { x: 0, y: 0 } },
  };
  const grid = { dpi: 150, type: "SQUARE" };

  it("mapPlacementOf builds the Trollskull placement from a Trollskull image on the map layer, and is undefined for any other item", () => {
    expect(mapPlacementOf(trollskull, grid)).toEqual(TROLLSKULL);

    const others: SceneItem[] = [
      { ...trollskull, layer: "CHARACTER" },
      { ...trollskull, layer: undefined },
      { ...trollskull, type: "SHAPE" },
      { ...trollskull, image: undefined },
      { ...trollskull, grid: undefined },
    ];
    for (const item of others)
      expect(mapPlacementOf(item, grid)).toBeUndefined();
  });
});
