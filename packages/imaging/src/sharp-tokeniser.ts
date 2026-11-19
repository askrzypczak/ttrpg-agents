import {
  TokeniserError,
  type FocalPoint,
  type SquareCrop,
  type TokenStyle,
  type Tokeniser,
  type TokeniserFacts,
  type TokeniserProbe,
} from "@ttrpg-agents/engine";

type Sharp = (typeof import("sharp"))["default"];

/** Loads the sharp module; the default is a dynamic import of "sharp". */
export type SharpLoader = () => Promise<Sharp>;

const importSharp: SharpLoader = async () => (await import("sharp")).default;

/**
 * The sharp tokeniser, which is also the setup report's tokeniser probe.
 * Creating it loads nothing: sharp loads on the first call and is kept, a
 * failed load included (restart the process after fixing it).
 */
export function createSharpTokeniser(
  options: { loadSharp?: SharpLoader } = {},
): Tokeniser & TokeniserProbe {
  const loadSharp = options.loadSharp ?? importSharp;
  let loading: Promise<Sharp> | undefined;
  const sharpModule = (): Promise<Sharp> => (loading ??= loadSharp());

  async function withSharp<T>(
    task: string,
    run: (sharp: Sharp) => Promise<T>,
  ): Promise<T> {
    let sharp: Sharp;
    try {
      sharp = await sharpModule();
    } catch (error) {
      throw new TokeniserError(`Cannot load sharp: ${firstLine(error)}`);
    }
    try {
      return await run(sharp);
    } catch (error) {
      throw new TokeniserError(`Cannot ${task}: ${firstLine(error)}`);
    }
  }

  return {
    focalPoint(bytes) {
      return withSharp("find the image's focal point", (sharp) =>
        attentionPoint(sharp, bytes),
      );
    },
    renderToken(bytes, crop, style) {
      return withSharp("render the token", (sharp) =>
        render(sharp, bytes, crop, style),
      );
    },
    async check(): Promise<TokeniserFacts> {
      try {
        await sharpModule();
        return { kind: "loaded" };
      } catch (error) {
        return { kind: "failed", reason: firstLine(error) };
      }
    },
  };
}

/**
 * The centre of the region sharp's attention strategy keeps, as fractions of
 * the source's width and height. Cropping to half the height forces a crop on
 * every image, square ones included; at that size the image is not scaled, so
 * the point is in source pixels.
 */
async function attentionPoint(
  sharp: Sharp,
  bytes: Uint8Array,
): Promise<FocalPoint> {
  const { width, height } = await sharp(bytes).metadata();
  const { info } = await sharp(bytes)
    .resize(width, Math.ceil(height / 2), {
      fit: "cover",
      position: "attention",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    x: fraction(info.attentionX, width),
    y: fraction(info.attentionY, height),
  };
}

/** `at` as a fraction of `length`, kept within 0..1; the middle when sharp gave no point. */
function fraction(at: number | undefined, length: number): number {
  if (at === undefined || !Number.isFinite(at)) return 0.5;
  return Math.min(Math.max(at / length, 0), 1);
}

/**
 * The crop scaled to a `style.side` square, cut to a circle (transparent
 * outside) with a ring of `style.ringColour` in its outer band, as WebP.
 */
function render(
  sharp: Sharp,
  bytes: Uint8Array,
  crop: SquareCrop,
  style: TokenStyle,
): Promise<Uint8Array> {
  const { side } = style;
  return sharp(bytes)
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.side,
      height: crop.side,
    })
    .resize(side, side)
    .ensureAlpha()
    .composite([
      { input: circleMask(side), blend: "dest-in" },
      { input: ring(style) },
    ])
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer();
}

function svg(side: number, body: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(side)}" height="${String(side)}">${body}</svg>`,
  );
}

function circleMask(side: number): Buffer {
  const r = side / 2;
  return svg(
    side,
    `<circle cx="${String(r)}" cy="${String(r)}" r="${String(r)}" fill="#fff"/>`,
  );
}

/** A stroke `round(ringWidth * side)` px wide whose outer edge is the circle's edge. */
function ring({ side, ringWidth, ringColour }: TokenStyle): Buffer {
  const width = Math.round(ringWidth * side);
  const centre = side / 2;
  return svg(
    side,
    `<circle cx="${String(centre)}" cy="${String(centre)}" r="${String(centre - width / 2)}" fill="none" stroke="${escapeAttribute(ringColour)}" stroke-width="${String(width)}"/>`,
  );
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

/** The first line of an error's message: sharp's load error goes on with install advice. */
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? message;
}
