import {
  CONTACT_SHEET_LAYOUT,
  TOKEN_STYLE,
  TokeniserError,
} from "@ttrpg-agents/engine";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createSharpTokeniser, type SharpLoader } from "./sharp-tokeniser.js";

/** A flat PNG of the given size and colour, generated in memory. */
function flatPng(width: number, height: number, colour: string) {
  return sharp({
    create: { width, height, channels: 3, background: colour },
  })
    .png()
    .toBuffer();
}

/** The RGBA pixels of an image, row by row. */
async function rgba(bytes: Uint8Array) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    at(x: number, y: number): [number, number, number, number] {
      const i = (y * info.width + x) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    },
  };
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Within `tolerance` per channel: the WebP is lossy. */
function expectColour(
  pixel: [number, number, number, number],
  rgb: [number, number, number],
  label: string,
  tolerance = 16,
): void {
  for (let c = 0; c < 3; c++) {
    expect(
      Math.abs(pixel[c]! - rgb[c]!),
      `${label}: channel ${String(c)} of ${pixel.join(",")}`,
    ).toBeLessThanOrEqual(tolerance);
  }
  expect(pixel[3], `${label}: alpha`).toBeGreaterThanOrEqual(240);
}

describe("createSharpTokeniser", () => {
  it("renderToken turns a generated 1,000 by 600 PNG into a 512 by 512 WebP whose corner pixels are fully transparent and whose ring pixels have the ring colour", async () => {
    const source = await flatPng(1000, 600, "#3070c0");
    const tokeniser = createSharpTokeniser();
    const token = await tokeniser.renderToken(
      source,
      { left: 200, top: 0, side: 600 },
      TOKEN_STYLE,
    );
    const meta = await sharp(token).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 512, height: 512 });

    const pixels = await rgba(token);
    for (const [x, y] of [
      [0, 0],
      [511, 0],
      [0, 511],
      [511, 511],
    ] as const) {
      expect(pixels.at(x, y)[3], `corner ${String(x)},${String(y)}`).toBe(0);
    }
    // The ring is about 15 px wide in the outer band of the circle.
    const ring = hexRgb(TOKEN_STYLE.ringColour);
    expectColour(pixels.at(256, 7), ring, "ring, top");
    expectColour(pixels.at(7, 256), ring, "ring, left");
    expectColour(pixels.at(504, 256), ring, "ring, right");
    expectColour(pixels.at(256, 504), ring, "ring, bottom");
    // Control: inside the ring is the source image.
    expectColour(pixels.at(256, 256), hexRgb("#3070c0"), "centre");
  });

  it("focalPoint answers fractions of the width and height near a saturated patch drawn off-centre on a flat grey image", async () => {
    const patch = await flatPng(120, 120, "#ff0000");
    const source = await sharp({
      create: { width: 1000, height: 600, channels: 3, background: "#808080" },
    })
      .composite([{ input: patch, left: 650, top: 100 }])
      .png()
      .toBuffer();
    const focus = await createSharpTokeniser().focalPoint(source);
    // The patch spans x 650 to 770 and y 100 to 220.
    expect(focus.x).toBeGreaterThanOrEqual(650 / 1000);
    expect(focus.x).toBeLessThanOrEqual(770 / 1000);
    expect(focus.y).toBeGreaterThanOrEqual(100 / 600);
    expect(focus.y).toBeLessThanOrEqual(220 / 600);
  });

  it("creating the tokeniser loads nothing; when the loader fails, renderToken rejects with a TokeniserError naming the cause and check answers failed with it", async () => {
    const cause =
      'Could not load the "sharp" module using the linux-x64 runtime';
    const loadSharp = vi.fn<SharpLoader>(() =>
      Promise.reject(new Error(`${cause}\nPossible solutions:\n- npm ci`)),
    );
    const tokeniser = createSharpTokeniser({ loadSharp });
    expect(loadSharp).not.toHaveBeenCalled();

    const error = await tokeniser
      .renderToken(new Uint8Array(8), { left: 0, top: 0, side: 1 }, TOKEN_STYLE)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(TokeniserError);
    expect((error as Error).message).toContain(cause);

    const facts = await tokeniser.check();
    expect(facts).toMatchObject({ kind: "failed" });
    expect(facts.kind === "failed" ? facts.reason : "").toContain(cause);
  });

  it("check answers loaded when sharp loads", async () => {
    expect(await createSharpTokeniser().check()).toEqual({ kind: "loaded" });
    const loadSharp: SharpLoader = () => Promise.resolve(sharp);
    expect(await createSharpTokeniser({ loadSharp }).check()).toEqual({
      kind: "loaded",
    });
  });
});

/** Twenty colours far apart from each other and from white. */
const SHEET_COLOURS = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#42d4f4",
  "#f032e6",
  "#bfef45",
  "#000075",
  "#469990",
  "#9a6324",
  "#800000",
  "#808000",
  "#000000",
  "#a9a9a9",
  "#ff8080",
  "#008080",
  "#4b0082",
  "#556b2f",
];

/** The centre pixel of cell `i` in a 5-column grid of 128 px cells. */
function cellCentre(i: number): [number, number] {
  return [(i % 5) * 128 + 64, Math.floor(i / 5) * 128 + 64];
}

describe("createSharpTokeniser contactSheet", () => {
  it("contactSheet composes 20 generated 256 px images into one 640 by 512 WebP, each image's colour at the centre of its cell, left to right, top to bottom", async () => {
    const images = await Promise.all(
      SHEET_COLOURS.map((colour) => flatPng(256, 256, colour)),
    );

    const sheet = await createSharpTokeniser().contactSheet(
      images,
      CONTACT_SHEET_LAYOUT,
    );

    const meta = await sharp(sheet).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 640, height: 512 });
    const pixels = await rgba(sheet);
    SHEET_COLOURS.forEach((colour, i) => {
      const [x, y] = cellCentre(i);
      expectColour(pixels.at(x, y), hexRgb(colour), `cell ${String(i)}`);
    });
  });

  it("contactSheet leaves a null image's cell in the layout's background colour", async () => {
    const background = "#20a040";
    const images = [
      await flatPng(256, 256, "#e6194b"),
      null,
      await flatPng(256, 256, "#4363d8"),
    ];

    const sheet = await createSharpTokeniser().contactSheet(images, {
      ...CONTACT_SHEET_LAYOUT,
      background,
    });

    const meta = await sharp(sheet).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 640, height: 512 });
    const pixels = await rgba(sheet);
    expectColour(pixels.at(...cellCentre(0)), hexRgb("#e6194b"), "cell 0");
    expectColour(pixels.at(...cellCentre(1)), hexRgb(background), "cell 1");
    expectColour(pixels.at(...cellCentre(2)), hexRgb("#4363d8"), "cell 2");
    expectColour(pixels.at(...cellCentre(19)), hexRgb(background), "cell 19");
  });
});
