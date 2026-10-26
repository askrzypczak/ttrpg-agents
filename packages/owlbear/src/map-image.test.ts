import { describe, expect, it } from "vitest";
import {
  displayGrid,
  mapTransform,
  parseCellLabel,
  type MapPlacement,
} from "@ttrpg-agents/engine";
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  encodeMessage,
} from "@ttrpg-agents/protocol";
import {
  MAP_IMAGE_MAX_BYTES,
  bytesToBase64,
  encodeWithinBudget,
  planMapImage,
  type ConvertMapImage,
  type MapImageLayout,
} from "./map-image.js";

/** Trollskull Manor: 3000x4000 px at 125 dpi on a 150-unit grid, rotated 270. */
const trollskull: MapPlacement = {
  position: { x: 0, y: 0 },
  rotation: 270,
  scale: { x: 1, y: 1 },
  imageOffset: { x: 0, y: 0 },
  imageWidth: 3000,
  imageHeight: 4000,
  imageDpi: 125,
  sceneDpi: 150,
};

/** Unrotated and stretched twice as wide, off the scene origin. */
const stretched: MapPlacement = {
  position: { x: 75, y: 30 },
  rotation: 0,
  scale: { x: 2, y: 1 },
  imageOffset: { x: 10, y: 20 },
  imageWidth: 1000,
  imageHeight: 600,
  imageDpi: 100,
  sceneDpi: 150,
};

const COLUMNS = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "AA",
  "AB",
  "AC",
  "AD",
  "AE",
  "AF",
];
const ROWS = Array.from({ length: 24 }, (_, i) => String(i + 1));

type Label = MapImageLayout["labels"][number];

const isColumnLabel = (label: Label) => /^[A-Z]+$/.test(label.text);
const isRowLabel = (label: Label) => /^[0-9]+$/.test(label.text);

/** Labels grouped by `key`, each group sorted by `along`. */
function edges(
  labels: Label[],
  key: (label: Label) => number,
  along: (label: Label) => number,
): Map<number, string[]> {
  const groups = new Map<number, Label[]>();
  for (const label of labels) {
    const k = Math.round(key(label) * 1000) / 1000;
    groups.set(k, [...(groups.get(k) ?? []), label]);
  }
  return new Map(
    [...groups].map(([k, group]) => [
      k,
      [...group].sort((a, b) => along(a) - along(b)).map((l) => l.text),
    ]),
  );
}

/** A fake encoder: each call answers by its type and quality and is recorded. */
function fakeConvert(
  answer: (
    type: "image/webp" | "image/jpeg",
    quality: number,
  ) => { type: string; size: number },
): { convert: ConvertMapImage; calls: [string, number][] } {
  const calls: [string, number][] = [];
  return {
    calls,
    convert: (type, quality) => {
      calls.push([type, quality]);
      const { type: answered, size } = answer(type, quality);
      // A marker byte per call, so a test can tell which call's bytes came back.
      return Promise.resolve({
        type: answered,
        bytes: new Uint8Array(size).fill(calls.length),
      });
    },
  };
}

describe("planMapImage", () => {
  it("for the Trollskull placement (3000 x 4000 px at 125 dpi, rotation 270, 150-unit grid) the column labels read A to AF and the row labels 1 to 24, along both edges", () => {
    const layout = planMapImage(trollskull);
    const { clip } = layout;

    const columns = edges(
      layout.labels.filter(isColumnLabel),
      (l) => l.y,
      (l) => l.x,
    );
    expect([...columns.values()]).toEqual([COLUMNS, COLUMNS]);
    const [top, bottom] = [...columns.keys()].sort((a, b) => a - b);
    expect(top).toBeLessThan(clip.y);
    expect(bottom).toBeGreaterThan(clip.y + clip.height);

    const rows = edges(
      layout.labels.filter(isRowLabel),
      (l) => l.x,
      (l) => l.y,
    );
    expect([...rows.values()]).toEqual([ROWS, ROWS]);
    const [left, right] = [...rows.keys()].sort((a, b) => a - b);
    expect(left).toBeLessThan(clip.x);
    expect(right).toBeGreaterThan(clip.x + clip.width);

    expect(layout.labels).toHaveLength(2 * COLUMNS.length + 2 * ROWS.length);
  });

  it("each column label with each row label, read with the engine's parseCellLabel, names the display cell whose column and row the two labels are centred on", () => {
    const layout = planMapImage(trollskull);
    const { clip, cellPx } = layout;
    const columns = layout.labels.filter(isColumnLabel);
    const rows = layout.labels.filter(isRowLabel);
    expect(columns).toHaveLength(2 * COLUMNS.length);
    expect(rows).toHaveLength(2 * ROWS.length);

    for (const column of columns) {
      for (const row of rows) {
        const cell = parseCellLabel(`${column.text}${row.text}`);
        const where = `${column.text}${row.text}`;
        expect(column.x, where).toBeCloseTo(clip.x + (cell.col + 0.5) * cellPx);
        expect(row.y, where).toBeCloseTo(clip.y + (cell.row + 0.5) * cellPx);
      }
    }
  });

  it("the Trollskull image is 1598 x 1222 px with 47 px cells, a long side of at most 1600 px for the 3000 x 4000 source", () => {
    const layout = planMapImage(trollskull);
    expect(layout.cellPx).toBe(47);
    expect(layout.width).toBe(1598);
    expect(layout.height).toBe(1222);
    expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(1600);
    expect(layout.clip).toEqual({ x: 47, y: 47, width: 1504, height: 1128 });
    expect(layout.image.width).toBe(3000);
    expect(layout.image.height).toBe(4000);
    expect(layout.fontSize).toBeGreaterThan(0);
    expect(layout.lineWidth).toBeGreaterThan(0);
  });

  it("the cell lines lie on every display cell boundary inside the clip rectangle: 33 vertical and 25 horizontal for Trollskull", () => {
    const layout = planMapImage(trollskull);
    const { clip, cellPx } = layout;
    const top = clip.y;
    const bottom = clip.y + clip.height;
    const left = clip.x;
    const right = clip.x + clip.width;

    const vertical = layout.lines
      .filter((l) => l.x1 === l.x2)
      .map((l) => ({
        x: l.x1,
        from: Math.min(l.y1, l.y2),
        to: Math.max(l.y1, l.y2),
      }))
      .sort((a, b) => a.x - b.x);
    const horizontal = layout.lines
      .filter((l) => l.y1 === l.y2)
      .map((l) => ({
        y: l.y1,
        from: Math.min(l.x1, l.x2),
        to: Math.max(l.x1, l.x2),
      }))
      .sort((a, b) => a.y - b.y);

    expect(layout.lines).toHaveLength(33 + 25);
    expect(vertical).toEqual(
      Array.from({ length: 33 }, (_, i) => ({
        x: left + i * cellPx,
        from: top,
        to: bottom,
      })),
    );
    expect(horizontal).toEqual(
      Array.from({ length: 25 }, (_, i) => ({
        y: top + i * cellPx,
        from: left,
        to: right,
      })),
    );
  });

  it("the image transform puts the source image's four corners where the engine's mapTransform puts them, at rotation 270 and at rotation 0 with scale (2, 1)", () => {
    for (const placement of [trollskull, stretched]) {
      const layout = planMapImage(placement);
      const [a, b, c, d, e, f] = layout.image.transform;
      const grid = displayGrid(placement);
      const transform = mapTransform(placement);
      const { sceneDpi } = placement;
      const k = layout.cellPx / sceneDpi;
      const { imageWidth: w, imageHeight: h } = placement;
      for (const p of [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: w, y: h },
      ]) {
        const scene = transform.imageToScene(p);
        const where = `rotation ${String(placement.rotation)} corner ${JSON.stringify(p)}`;
        // The grid's top-left corner is the clip rectangle's top-left corner.
        expect(a * p.x + c * p.y + e, where).toBeCloseTo(
          layout.clip.x + (scene.x - grid.origin.col * sceneDpi) * k,
        );
        expect(b * p.x + d * p.y + f, where).toBeCloseTo(
          layout.clip.y + (scene.y - grid.origin.row * sceneDpi) * k,
        );
      }
    }
    // Trollskull's top-left image pixel lands on the grid's bottom-left corner.
    const [, , , , e, f] = planMapImage(trollskull).image.transform;
    expect(e).toBeCloseTo(47);
    expect(f).toBeCloseTo(1175);
  });
});

describe("encodeWithinBudget", () => {
  it("encodeWithinBudget returns the first encoding within the budget, trying quality 0.85, then 0.7, then 0.5", async () => {
    const sizes = new Map([
      [0.85, MAP_IMAGE_MAX_BYTES + 1],
      [0.7, MAP_IMAGE_MAX_BYTES],
      [0.5, 10],
    ]);
    const { convert, calls } = fakeConvert((type, q) => ({
      type,
      size: sizes.get(q) ?? 0,
    }));
    const encoded = await encodeWithinBudget(convert);
    expect(calls).toEqual([
      ["image/webp", 0.85],
      ["image/webp", 0.7],
    ]);
    expect(encoded.mimeType).toBe("image/webp");
    expect(encoded.bytes).toEqual(new Uint8Array(MAP_IMAGE_MAX_BYTES).fill(2));

    const lowest = fakeConvert((type, q) => ({
      type,
      size: q === 0.5 ? 10 : MAP_IMAGE_MAX_BYTES + 1,
    }));
    expect(await encodeWithinBudget(lowest.convert)).toEqual({
      mimeType: "image/webp",
      bytes: new Uint8Array(10).fill(3),
    });
    expect(lowest.calls).toEqual([
      ["image/webp", 0.85],
      ["image/webp", 0.7],
      ["image/webp", 0.5],
    ]);

    const first = fakeConvert((type) => ({ type, size: 10 }));
    expect(await encodeWithinBudget(first.convert)).toEqual({
      mimeType: "image/webp",
      bytes: new Uint8Array(10).fill(1),
    });
    expect(first.calls).toEqual([["image/webp", 0.85]]);
  });

  it("encodeWithinBudget re-encodes as image/jpeg at the same quality when the browser answers another type for image/webp", async () => {
    const { convert, calls } = fakeConvert((type, q) =>
      type === "image/webp"
        ? { type: "image/png", size: 10 }
        : { type, size: q === 0.85 ? MAP_IMAGE_MAX_BYTES + 1 : 20 },
    );
    const encoded = await encodeWithinBudget(convert);
    expect(encoded.mimeType).toBe("image/jpeg");
    expect(encoded.bytes).toHaveLength(20);
    // The bytes are the last call's: the JPEG at 0.7, not a fitting non-WEBP answer.
    expect(encoded.bytes[0]).toBe(calls.length);
    expect(calls[calls.length - 1]).toEqual(["image/jpeg", 0.7]);
    const jpegQualities = calls
      .filter(([type]) => type === "image/jpeg")
      .map(([, q]) => q);
    expect(jpegQualities).toEqual([0.85, 0.7]);
    calls.forEach(([type, q], i) => {
      if (type !== "image/jpeg") return;
      expect(calls[i - 1], `call ${String(i)}`).toEqual(["image/webp", q]);
    });
  });

  it("encodeWithinBudget fails naming the smallest size and the budget when no quality fits", async () => {
    const sizes = new Map([
      [0.85, MAP_IMAGE_MAX_BYTES + 200],
      [0.7, MAP_IMAGE_MAX_BYTES + 100],
      [0.5, MAP_IMAGE_MAX_BYTES + 300],
    ]);
    const { convert } = fakeConvert((type, q) => ({
      type,
      size: sizes.get(q) ?? 0,
    }));
    let caught: unknown;
    try {
      await encodeWithinBudget(convert);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain(String(MAP_IMAGE_MAX_BYTES + 100));
    expect(message).toContain(String(MAP_IMAGE_MAX_BYTES));
  });
});

describe("the map image budget", () => {
  it("a `query-result` carrying MAP_IMAGE_MAX_BYTES bytes of image as base64 encodes to at most MAX_MESSAGE_BYTES characters", () => {
    expect(MAX_MESSAGE_BYTES).toBe(1024 * 1024);
    expect(MAP_IMAGE_MAX_BYTES).toBe(783_360);
    const data = Buffer.from(
      new Uint8Array(MAP_IMAGE_MAX_BYTES).fill(0xff),
    ).toString("base64");
    const encoded = encodeMessage({
      v: PROTOCOL_VERSION,
      type: "query-result",
      id: crypto.randomUUID(),
      payload: {
        name: "map-image",
        result: { mimeType: "image/jpeg", data, width: 1598, height: 1222 },
      },
    });
    expect(encoded.length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
  });

  it("bytesToBase64 matches Buffer's base64 for 0, 1, 2, 3 and 100 000 bytes", () => {
    for (const length of [0, 1, 2, 3, 100_000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(bytesToBase64(bytes), String(length)).toBe(
        Buffer.from(bytes).toString("base64"),
      );
    }
  });
});
