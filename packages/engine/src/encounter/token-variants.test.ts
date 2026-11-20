import { describe, expect, it } from "vitest";
import {
  makeTestImageSource,
  makeTestMonster,
  makeTestMonsterIndex,
  makeTestTokeniser,
  makeTestTooManyTokensIndex,
  pngDeclaring,
  webpDeclaring,
} from "../testing/index.js";
import {
  ImageUnavailableError,
  InvalidTokenRequestError,
  UnknownMonsterError,
} from "./errors.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository } from "./repository.js";
import type {
  StoredTokenArt,
  TokenArt,
  TokenArtRepository,
  TokenArtSource,
} from "./token-art.js";
import type { NewTokenImage, TokenImageRepository } from "./token-image.js";
import { CONTACT_SHEET_LAYOUT } from "./tokeniser.js";
import {
  setTooManyTokensVariant,
  tooManyTokensSheet,
  type SetTooManyTokensVariantDeps,
  type TooManyTokensSheetDeps,
} from "./token-variants.js";
import { tooManyTokensUrls } from "./too-many-tokens.js";
import type { Encounter } from "./types.js";

const KEY = "homebrew_mossling";
const BARE_KEY = "homebrew_bramble";
const TOTAL = 45;
/** The hash the fake image store answers for any saved image. */
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const origin: ChangeOrigin = {
  source: "mcp",
  commandId: "command-1",
  command: "set_token_art",
};

const mossling = makeTestMonster();
/** A monster no folder of the index covers. */
const bramble = makeTestMonster({ key: BARE_KEY, name: "Bramble" });

/** "Mossling_01.webp" to "Mossling_45.webp", listed out of order. */
const files = Array.from(
  { length: TOTAL },
  (_, i) => `Mossling_${String(TOTAL - i).padStart(2, "0")}.webp`,
);
const tooManyTokens = makeTestTooManyTokensIndex([
  { name: "Mossling", key: KEY, files },
]);

/** Variant `n` (1-based, in file-name order). */
function variantOf(n: number) {
  return {
    folder: "Mossling",
    file: `Mossling_${String(n).padStart(2, "0")}.webp`,
  };
}

function urlsOf(n: number) {
  return tooManyTokensUrls(tooManyTokens, variantOf(n));
}

/** Distinct, valid bytes for variant `n`: a PNG header declaring (100 + n) by 100 px. */
function bytesOf(n: number): Uint8Array {
  return pngDeclaring(100 + n, 100);
}

/** Bytes validateTokenImage refuses: wider than the stored-image cap. */
const refused = pngDeclaring(4096, 4096);

/** Every variant's bytes at its jsDelivr url. */
function allAtJsdelivr(): Record<string, Uint8Array> {
  const images: Record<string, Uint8Array> = {};
  for (let n = 1; n <= TOTAL; n++) images[urlsOf(n).jsdelivr] = bytesOf(n);
  return images;
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

function sheetSetup(
  options: {
    images?: Record<string, Uint8Array>;
    art?: StoredTokenArt;
  } = {},
) {
  const imageSource = makeTestImageSource(options.images ?? allAtJsdelivr());
  const tokeniser = makeTestTokeniser();
  const art = options.art;
  const deps: TooManyTokensSheetDeps = {
    monsters: makeTestMonsterIndex([mossling, bramble]),
    art: { getTokenArt: (key) => (key === KEY ? art : undefined) },
    imageSource,
    tokeniser,
    tooManyTokens,
  };
  return { deps, imageSource, tokeniser };
}

type Write =
  | "begin"
  | "commit"
  | "rollback"
  | { kind: "saveTokenImage"; image: NewTokenImage }
  | {
      kind: "setTokenArt";
      monsterKey: string;
      art: TokenArt;
      source: TokenArtSource;
      origin: ChangeOrigin;
    }
  | { kind: "noteCommand"; encounterId: string; origin: ChangeOrigin };

/**
 * In-memory art and image stores and a directory with one current encounter,
 * all recording, in one list and in order, the outermost art transaction's
 * start and end and every write.
 */
function setSetup(
  options: {
    images?: Record<string, Uint8Array>;
    stored?: Record<string, StoredTokenArt>;
  } = {},
) {
  const writes: Write[] = [];
  const stored: Record<string, StoredTokenArt> = { ...options.stored };
  let depth = 0;
  const art: TokenArtRepository = {
    listTokenArt: () =>
      Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, v.art])),
    getTokenArt: (monsterKey) =>
      Object.hasOwn(stored, monsterKey) ? stored[monsterKey] : undefined,
    setTokenArt(monsterKey, value, source, at) {
      writes.push({
        kind: "setTokenArt",
        monsterKey,
        art: value,
        source,
        origin: at,
      });
      stored[monsterKey] = { art: value, source };
    },
    transaction<T>(fn: () => T): T {
      const outer = depth === 0;
      if (outer) writes.push("begin");
      depth += 1;
      try {
        const result = fn();
        if (outer) writes.push("commit");
        return result;
      } catch (error) {
        if (outer) writes.push("rollback");
        throw error;
      } finally {
        depth -= 1;
      }
    },
  };
  const images: TokenImageRepository = {
    saveTokenImage(image) {
      writes.push({ kind: "saveTokenImage", image });
      return HASH;
    },
    getTokenImage: () => undefined,
  };
  const current: Encounter = { id: "enc-1", name: "Encounter 1", createdAt: 0 };
  const directory: SetTooManyTokensVariantDeps["directory"] = {
    getOpenScene: () => undefined,
    getCurrentEncounter: () => current,
    repositoryFor: (encounterId) =>
      ({
        noteCommand: (at: ChangeOrigin) => {
          writes.push({ kind: "noteCommand", encounterId, origin: at });
        },
      }) as unknown as EncounterRepository,
  };
  const imageSource = makeTestImageSource(options.images ?? allAtJsdelivr());
  const deps: SetTooManyTokensVariantDeps = {
    monsters: makeTestMonsterIndex([mossling, bramble]),
    art,
    images,
    imageSource,
    tooManyTokens,
    directory,
  };
  return { deps, writes, stored, imageSource };
}

const tablePick: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/mossling.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: OTHER_HASH,
};

describe("tooManyTokensSheet", () => {
  it("tooManyTokensSheet of a monster with 45 variants passes the tokeniser variants 1-20 in variant order for page 1 and 41-45 for page 3, with CONTACT_SHEET_LAYOUT (5 columns, 4 rows, 128 px cells, white), and answers the sheet's bytes, first, last and total", async () => {
    const { deps, tokeniser } = sheetSetup();

    const page1 = await tooManyTokensSheet(deps, KEY, 1);
    const page3 = await tooManyTokensSheet(deps, KEY, 3);

    expect(CONTACT_SHEET_LAYOUT).toEqual({
      columns: 5,
      rows: 4,
      cell: 128,
      background: "#ffffff",
    });
    expect(tokeniser.sheets).toHaveLength(2);
    const [sheet1, sheet3] = tokeniser.sheets;
    expect(sheet1?.layout).toEqual(CONTACT_SHEET_LAYOUT);
    expect(sheet1?.images).toEqual(range(1, 20).map(bytesOf));
    expect(sheet3?.layout).toEqual(CONTACT_SHEET_LAYOUT);
    expect(sheet3?.images.slice(0, 5)).toEqual(range(41, 45).map(bytesOf));
    expect(sheet3?.images.slice(5).every((cell) => cell === null)).toBe(true);
    expect(sheet3?.images.length).toBeLessThanOrEqual(20);
    expect(page1).toMatchObject({
      monster: mossling,
      bytes: webpDeclaring(640, 512),
      first: 1,
      last: 20,
      total: TOTAL,
      failed: 0,
    });
    expect(page3).toMatchObject({
      monster: mossling,
      bytes: webpDeclaring(640, 512),
      first: 41,
      last: 45,
      total: TOTAL,
      failed: 0,
    });
  });

  it("tooManyTokensSheet refuses page 0, a fractional page and page 4 of 45 variants with InvalidTokenRequestError naming the pages, loading nothing", async () => {
    for (const page of [0, 1.5, 4]) {
      const { deps, imageSource, tokeniser } = sheetSetup();

      const error = await rejection(tooManyTokensSheet(deps, KEY, page));

      expect(error, `page ${String(page)}`).toBeInstanceOf(
        InvalidTokenRequestError,
      );
      const message = (error as Error).message;
      expect(message).toContain(`Page ${String(page)}`);
      expect(message).toContain("pages 1 to 3");
      expect(imageSource.loads).toEqual([]);
      expect(tokeniser.sheets).toEqual([]);
    }
  });

  it("tooManyTokensSheet loads each variant from its jsDelivr url, else its raw url, and leaves a variant whose two loads fail or whose bytes are refused as a blank cell, counted in failed", async () => {
    const images = allAtJsdelivr();
    // Variant 2: jsDelivr fails, raw answers.
    delete images[urlsOf(2).jsdelivr];
    images[urlsOf(2).raw] = bytesOf(2);
    // Variant 3: both loads fail.
    delete images[urlsOf(3).jsdelivr];
    // Variant 4: jsDelivr bytes refused, raw fails.
    images[urlsOf(4).jsdelivr] = refused;
    // Variant 5: jsDelivr bytes refused, raw answers.
    images[urlsOf(5).jsdelivr] = refused;
    images[urlsOf(5).raw] = bytesOf(5);
    // Variant 6: both answer refused bytes.
    images[urlsOf(6).jsdelivr] = refused;
    images[urlsOf(6).raw] = refused;
    const { deps, imageSource, tokeniser } = sheetSetup({ images });

    const sheet = await tooManyTokensSheet(deps, KEY, 1);

    const expected = range(1, 20).map((n) =>
      n === 3 || n === 4 || n === 6 ? null : bytesOf(n),
    );
    expect(tokeniser.sheets[0]?.images).toEqual(expected);
    expect(sheet).toMatchObject({ first: 1, last: 20, failed: 3 });
    const loaded = imageSource.loads.map((l) => ("url" in l ? l.url : l.path));
    expect(loaded).toContain(urlsOf(1).jsdelivr);
    expect(loaded).not.toContain(urlsOf(1).raw);
    for (const n of [2, 3, 4, 5, 6]) {
      expect(loaded).toContain(urlsOf(n).jsdelivr);
      expect(loaded).toContain(urlsOf(n).raw);
    }
  });

  it("tooManyTokensSheet rejects with ImageUnavailableError naming the cause when no image of the page loads, and builds no sheet", async () => {
    const { deps, tokeniser } = sheetSetup({ images: {} });

    const error = await rejection(tooManyTokensSheet(deps, KEY, 1));

    expect(error).toBeInstanceOf(ImageUnavailableError);
    expect((error as Error).message).toContain(
      `No test image at ${urlsOf(1).jsdelivr}`,
    );
    expect(tokeniser.sheets).toEqual([]);
  });

  it("tooManyTokensSheet answers the current art's variant number when the type's art url is a variant's jsDelivr or raw url, on another page included, and null for other art or none", async () => {
    const cases: { art: StoredTokenArt | undefined; current: number | null }[] =
      [
        {
          art: {
            art: { ...tablePick, url: urlsOf(25).jsdelivr },
            source: "agent",
          },
          current: 25,
        },
        {
          art: { art: { ...tablePick, url: urlsOf(3).raw }, source: "default" },
          current: 3,
        },
        { art: { art: tablePick, source: "table" }, current: null },
        { art: { art: { sha256: HASH }, source: "agent" }, current: null },
        { art: undefined, current: null },
      ];
    for (const { art, current } of cases) {
      const { deps } = sheetSetup({ art });

      const sheet = await tooManyTokensSheet(deps, KEY, 1);

      expect(sheet.current, JSON.stringify(art)).toBe(current);
    }
  });

  it("tooManyTokensSheet refuses an unknown key with UnknownMonsterError and a monster with no variants with InvalidTokenRequestError, loading nothing", async () => {
    const { deps, imageSource, tokeniser } = sheetSetup();

    const unknown = await rejection(
      tooManyTokensSheet(deps, "homebrew_nothing", 1),
    );
    const bare = await rejection(tooManyTokensSheet(deps, BARE_KEY, 1));

    expect(unknown).toBeInstanceOf(UnknownMonsterError);
    expect((unknown as Error).message).toContain('"homebrew_nothing"');
    expect(bare).toBeInstanceOf(InvalidTokenRequestError);
    expect((bare as Error).message).toContain(
      `Bramble (${BARE_KEY}) has no TooManyTokens variants`,
    );
    expect(imageSource.loads).toEqual([]);
    expect(tokeniser.sheets).toEqual([]);
  });
});

describe("setTooManyTokensVariant", () => {
  it("setTooManyTokensVariant stores the variant's bytes, sets { url, mime, width, height, sha256 } with the jsDelivr url and source agent on a type with no art, and notes its command on the current encounter, in one art transaction, answering replaced null", async () => {
    const { deps, writes, stored } = setSetup();

    const result = await setTooManyTokensVariant(deps, KEY, 7, origin);

    const art: TokenArt = {
      url: urlsOf(7).jsdelivr,
      mime: "image/png",
      width: 107,
      height: 100,
      sha256: HASH,
    };
    expect(writes).toEqual([
      "begin",
      {
        kind: "saveTokenImage",
        image: {
          mime: "image/png",
          width: 107,
          height: 100,
          bytes: bytesOf(7),
        },
      },
      { kind: "setTokenArt", monsterKey: KEY, art, source: "agent", origin },
      { kind: "noteCommand", encounterId: "enc-1", origin },
      "commit",
    ]);
    expect(stored[KEY]).toEqual({ art, source: "agent" });
    expect(result).toEqual({
      outcome: "set",
      monster: mossling,
      variant: 7,
      image: variantOf(7),
      sha256: HASH,
      replaced: null,
    });
  });

  it.each<TokenArtSource>(["table", "agent", "default"])(
    "setTooManyTokensVariant replaces %s art with source agent and answers the replaced art and its source",
    async (source) => {
      const prior: StoredTokenArt = { art: tablePick, source };
      const { deps, stored } = setSetup({ stored: { [KEY]: prior } });

      const result = await setTooManyTokensVariant(deps, KEY, 7, origin);

      expect(result).toMatchObject({
        outcome: "set",
        variant: 7,
        sha256: HASH,
        replaced: prior,
      });
      expect(stored[KEY]).toEqual({
        art: {
          url: urlsOf(7).jsdelivr,
          mime: "image/png",
          width: 107,
          height: 100,
          sha256: HASH,
        },
        source: "agent",
      });
    },
  );

  it("setTooManyTokensVariant stores the raw url when the jsDelivr load fails, and rejects with ImageUnavailableError naming both tries and writes nothing when both fail", async () => {
    const images = allAtJsdelivr();
    delete images[urlsOf(7).jsdelivr];
    images[urlsOf(7).raw] = bytesOf(7);
    const fallback = setSetup({ images });

    await setTooManyTokensVariant(fallback.deps, KEY, 7, origin);

    expect(fallback.stored[KEY]?.art.url).toBe(urlsOf(7).raw);

    const failing = setSetup({ images: {} });

    const error = await rejection(
      setTooManyTokensVariant(failing.deps, KEY, 7, origin),
    );

    expect(error).toBeInstanceOf(ImageUnavailableError);
    const message = (error as Error).message;
    expect(message).toContain(`No test image at ${urlsOf(7).jsdelivr}`);
    expect(message).toContain(`No test image at ${urlsOf(7).raw}`);
    expect(failing.writes).toEqual([]);
    expect(failing.stored).toEqual({});
  });

  it("setTooManyTokensVariant of the variant whose hash the type's art already has keeps that art and its url, writes no art, notes no command and answers unchanged with the kept art", async () => {
    const kept: StoredTokenArt = {
      art: { ...tablePick, sha256: HASH },
      source: "table",
    };
    const { deps, writes, stored } = setSetup({ stored: { [KEY]: kept } });

    const result = await setTooManyTokensVariant(deps, KEY, 7, origin);

    expect(result).toEqual({
      outcome: "unchanged",
      monster: mossling,
      variant: 7,
      image: variantOf(7),
      sha256: HASH,
      kept,
    });
    expect(
      writes.filter(
        (w) =>
          typeof w !== "string" &&
          (w.kind === "setTokenArt" || w.kind === "noteCommand"),
      ),
    ).toEqual([]);
    expect(stored[KEY]).toEqual(kept);
  });

  it("setTooManyTokensVariant refuses an unknown key (UnknownMonsterError), a monster with no variants, variant 0, a fractional variant and one past the total (InvalidTokenRequestError), loading and writing nothing", async () => {
    const cases: {
      key: string;
      variant: number;
      error: new (message: string) => Error;
      words?: string;
    }[] = [
      { key: "homebrew_nothing", variant: 1, error: UnknownMonsterError },
      {
        key: BARE_KEY,
        variant: 1,
        error: InvalidTokenRequestError,
        words: "has no TooManyTokens variants",
      },
      {
        key: KEY,
        variant: 0,
        error: InvalidTokenRequestError,
        words: "variants 1 to 45",
      },
      {
        key: KEY,
        variant: 2.5,
        error: InvalidTokenRequestError,
        words: "variants 1 to 45",
      },
      {
        key: KEY,
        variant: 46,
        error: InvalidTokenRequestError,
        words: "Variant 46 is out of range",
      },
    ];
    for (const { key, variant, error, words } of cases) {
      const { deps, writes, imageSource } = setSetup();

      const thrown = await rejection(
        setTooManyTokensVariant(deps, key, variant, origin),
      );

      const label = `${key} variant ${String(variant)}`;
      expect(thrown, label).toBeInstanceOf(error);
      if (words !== undefined)
        expect((thrown as Error).message, label).toContain(words);
      expect(imageSource.loads, label).toEqual([]);
      expect(writes, label).toEqual([]);
    }
  });
});
