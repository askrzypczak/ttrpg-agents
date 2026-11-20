import { describe, expect, it } from "vitest";
import {
  makeTestImageSource,
  makeTestTokeniser,
  pngDeclaring,
  webpDeclaring,
} from "../testing/index.js";
import {
  ImageUnavailableError,
  InvalidTokenRequestError,
  TokeniserError,
} from "./errors.js";
import { TOKEN_IMAGE_MAX_BYTES, validateTokenSource } from "./token-image.js";
import { TOKEN_STYLE, makeToken, tokenCrop } from "./tokeniser.js";

const WIDE = { width: 1000, height: 600 };
const PATH = "/home/dm/art/owlbear.png";

/** Errors a promise rejects with, or fails the test when it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

describe("tokenCrop", () => {
  it("tokenCrop at zoom 1 with the focus in the middle of a 1,000 by 600 image takes the middle 600 px square", () => {
    expect(tokenCrop(WIDE, { focus: { x: 0.5, y: 0.5 }, zoom: 1 })).toEqual({
      left: 200,
      top: 0,
      side: 600,
    });
  });

  it.each([
    ["left", { x: 0.05, y: 0.5 }, { left: 0, top: 150, side: 300 }],
    ["right", { x: 0.95, y: 0.5 }, { left: 700, top: 150, side: 300 }],
    ["top", { x: 0.5, y: 0.05 }, { left: 350, top: 0, side: 300 }],
    ["bottom", { x: 0.5, y: 0.95 }, { left: 350, top: 300, side: 300 }],
  ])(
    "tokenCrop clamps the square inside the image at the %s edge",
    (_edge, focus, crop) => {
      expect(tokenCrop(WIDE, { focus, zoom: 2 })).toEqual(crop);
    },
  );

  it("tokenCrop at zoom 8 takes a square one eighth of the shorter side, centred on the focus", () => {
    // 640 / 8 = 80; centred on (500, 256).
    expect(
      tokenCrop(
        { width: 1000, height: 640 },
        { focus: { x: 0.5, y: 0.4 }, zoom: 8 },
      ),
    ).toEqual({ left: 460, top: 216, side: 80 });
  });

  it("tokenCrop keeps a square of at least 1 px when the shorter side is below the zoom", () => {
    expect(
      tokenCrop(
        { width: 999, height: 5 },
        { focus: { x: 0.5, y: 0.5 }, zoom: 8 },
      ),
    ).toEqual({ left: 499, top: 2, side: 1 });
  });

  it.each([
    ["zoom 0.5", { x: 0.5, y: 0.5 }, 0.5],
    ["zoom 9", { x: 0.5, y: 0.5 }, 9],
    ["zoom NaN", { x: 0.5, y: 0.5 }, Number.NaN],
    ["focus x -0.1", { x: -0.1, y: 0.5 }, 1],
    ["focus y 1.1", { x: 0.5, y: 1.1 }, 1],
  ])(
    "tokenCrop refuses %s with an InvalidTokenRequestError",
    (_case, focus, zoom) => {
      expect(() => tokenCrop(WIDE, { focus, zoom })).toThrow(
        InvalidTokenRequestError,
      );
    },
  );
});

describe("makeToken", () => {
  it("makeToken loads the image, crops it at the given focus and zoom, renders it with TOKEN_STYLE and answers the token bytes, the source size, the focus, the zoom and the crop", async () => {
    expect(TOKEN_STYLE).toEqual({
      side: 512,
      ringWidth: 0.03,
      ringColour: "#6e4b2a",
    });
    const imageSource = makeTestImageSource({
      [PATH]: pngDeclaring(1000, 600),
    });
    const rendered = webpDeclaring(512, 512, 64);
    const tokeniser = makeTestTokeniser({
      renderToken: () => Promise.resolve(rendered),
    });
    const token = await makeToken({ imageSource, tokeniser }, PATH, {
      focus: { x: 0.5, y: 0.4 },
      zoom: 2,
    });
    const crop = { left: 350, top: 90, side: 300 };
    expect(token).toEqual({
      bytes: rendered,
      source: { mime: "image/png", width: 1000, height: 600 },
      focus: { x: 0.5, y: 0.4 },
      zoom: 2,
      crop,
    });
    expect(imageSource.loads).toEqual([{ path: PATH }]);
    expect(tokeniser.renders).toEqual([{ crop, style: TOKEN_STYLE }]);
  });

  it("makeToken with no focus centres the crop on the tokeniser's focal point, at zoom 1 when no zoom is given", async () => {
    const imageSource = makeTestImageSource({
      [PATH]: pngDeclaring(1000, 600),
    });
    const tokeniser = makeTestTokeniser({
      focalPoint: () => Promise.resolve({ x: 0.7, y: 0.5 }),
    });
    const deps = { imageSource, tokeniser };

    const atDefaultZoom = await makeToken(deps, PATH);
    expect(atDefaultZoom).toMatchObject({
      focus: { x: 0.7, y: 0.5 },
      zoom: 1,
      crop: { left: 400, top: 0, side: 600 },
    });

    const zoomed = await makeToken(deps, PATH, { zoom: 2 });
    expect(zoomed).toMatchObject({
      focus: { x: 0.7, y: 0.5 },
      zoom: 2,
      crop: { left: 550, top: 150, side: 300 },
    });
    expect(tokeniser.renders.map((r) => r.crop)).toEqual([
      { left: 400, top: 0, side: 600 },
      { left: 550, top: 150, side: 300 },
    ]);
  });

  it("makeToken refuses an out-of-range focus or zoom before loading the image", async () => {
    const imageSource = makeTestImageSource({
      [PATH]: pngDeclaring(1000, 600),
    });
    const tokeniser = makeTestTokeniser();
    const deps = { imageSource, tokeniser };
    for (const options of [
      { zoom: 9 },
      { zoom: 0.5 },
      { focus: { x: 1.5, y: 0.5 } },
      { focus: { x: 0.5, y: -0.2 } },
    ]) {
      const error = await rejectionOf(makeToken(deps, PATH, options));
      expect(error, JSON.stringify(options)).toBeInstanceOf(
        InvalidTokenRequestError,
      );
    }
    expect(imageSource.loads).toEqual([]);
    expect(tokeniser.renders).toEqual([]);
  });

  it("makeToken refuses a source that validateTokenSource refuses with an ImageUnavailableError carrying its message, and renders nothing", async () => {
    const tooWide = pngDeclaring(9000, 600);
    const imageSource = makeTestImageSource({ [PATH]: tooWide });
    const tokeniser = makeTestTokeniser();
    const error = await rejectionOf(
      makeToken({ imageSource, tokeniser }, PATH, {
        focus: { x: 0.5, y: 0.5 },
      }),
    );
    expect(error).toBeInstanceOf(ImageUnavailableError);
    const refusal = validateTokenSource(tooWide);
    if (refusal.ok) throw new Error("expected the source to be refused");
    expect((error as Error).message).toContain(refusal.message);
    expect(tokeniser.renders).toEqual([]);
  });

  it.each([
    [
      "fails validateTokenImage",
      () => webpDeclaring(512, 512, TOKEN_IMAGE_MAX_BYTES + 1),
    ],
    ["is not a TOKEN_STYLE.side square", () => webpDeclaring(512, 400)],
    ["is not WebP", () => pngDeclaring(512, 512)],
  ])(
    "makeToken refuses a rendered token that %s with a TokeniserError",
    async (_case, output) => {
      const imageSource = makeTestImageSource({
        [PATH]: pngDeclaring(1000, 600),
      });
      const tokeniser = makeTestTokeniser({
        renderToken: () => Promise.resolve(output()),
      });
      const error = await rejectionOf(
        makeToken({ imageSource, tokeniser }, PATH, {
          focus: { x: 0.5, y: 0.5 },
        }),
      );
      expect(error).toBeInstanceOf(TokeniserError);
    },
  );
});
