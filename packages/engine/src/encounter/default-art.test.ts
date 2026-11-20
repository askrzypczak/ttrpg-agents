import { describe, expect, it } from "vitest";
import {
  makeTestImageSource,
  makeTestMonster,
  makeTestMonsterIndex,
  makeTestTooManyTokensIndex,
  pngDeclaring,
  webpDeclaring,
} from "../testing/index.js";
import {
  loadDefaultArt,
  storeDefaultArt,
  type LoadedDefaultArt,
} from "./default-art.js";
import type { ChangeOrigin } from "./origin.js";
import type {
  StoredTokenArt,
  TokenArtRepository,
  TokenArtSource,
} from "./token-art.js";
import type { NewTokenImage, TokenImageRepository } from "./token-image.js";
import { tooManyTokensUrls } from "./too-many-tokens.js";

const origin: ChangeOrigin = {
  source: "mcp",
  commandId: "command-1",
  command: "add_monsters",
};

const KEY = "homebrew_mossling";
const OTHER_KEY = "homebrew_bramble";
/** The hash the fake image store answers for any saved image. */
const HASH = "d".repeat(64);

const mossling = makeTestMonster();
const bramble = makeTestMonster({ key: OTHER_KEY, name: "Bramble" });

const folders = [
  {
    name: "Mossling",
    key: KEY,
    files: ["Mossling_02.webp", "Mossling_01.webp"],
  },
  { name: "Bramble", key: OTHER_KEY, files: ["Bramble_01.webp"] },
];
const tooManyTokens = makeTestTooManyTokensIndex(folders);
const urls = tooManyTokensUrls(tooManyTokens, {
  folder: "Mossling",
  file: "Mossling_01.webp",
});
const brambleUrls = tooManyTokensUrls(tooManyTokens, {
  folder: "Bramble",
  file: "Bramble_01.webp",
});

/**
 * In-memory art and image stores recording, in one list and in order, the
 * outermost art transaction's start and end, every art and image write, and
 * the write a test passes to storeDefaultArt.
 */
function setup(
  options: {
    stored?: Record<string, StoredTokenArt>;
    images?: Record<string, Uint8Array>;
    index?: ReturnType<typeof makeTestTooManyTokensIndex>;
  } = {},
) {
  const log: string[] = [];
  const stored: Record<string, StoredTokenArt> = { ...options.stored };
  const saved: NewTokenImage[] = [];
  const setCalls: {
    monsterKey: string;
    art: StoredTokenArt["art"];
    source: TokenArtSource;
    origin: ChangeOrigin;
  }[] = [];
  let depth = 0;
  const art: TokenArtRepository = {
    listTokenArt: () =>
      Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, v.art])),
    getTokenArt: (monsterKey) =>
      Object.hasOwn(stored, monsterKey) ? stored[monsterKey] : undefined,
    setTokenArt(monsterKey, value, source, at) {
      log.push(`set-art ${monsterKey}`);
      setCalls.push({ monsterKey, art: value, source, origin: at });
      stored[monsterKey] = { art: value, source };
    },
    transaction<T>(fn: () => T): T {
      const outer = depth === 0;
      if (outer) log.push("begin");
      depth += 1;
      try {
        const result = fn();
        if (outer) log.push("commit");
        return result;
      } catch (error) {
        if (outer) log.push("rollback");
        throw error;
      } finally {
        depth -= 1;
      }
    },
  };
  const images: TokenImageRepository = {
    saveTokenImage(image) {
      log.push("save-image");
      saved.push(image);
      return HASH;
    },
    getTokenImage: () => undefined,
  };
  const imageSource = makeTestImageSource(options.images ?? {});
  const deps = {
    art,
    images,
    imageSource,
    tooManyTokens: options.index ?? tooManyTokens,
    monsters: makeTestMonsterIndex([mossling, bramble]),
  };
  const write = () => {
    log.push(depth > 0 ? "write in transaction" : "write outside");
    return "written";
  };
  return { deps, log, stored, saved, setCalls, imageSource, write };
}

describe("loadDefaultArt and storeDefaultArt", () => {
  it("loadDefaultArt and storeDefaultArt give a type with no art its default variant's jsDelivr url with source default, the stored image's hash and the fetched mime, width and height", async () => {
    const bytes = webpDeclaring(280, 300);
    const s = setup({ images: { [urls.jsdelivr]: bytes } });

    const loaded = await loadDefaultArt(s.deps, [KEY]);
    const stored = storeDefaultArt(s.deps, loaded, origin, s.write);

    expect(stored.result).toBe("written");
    expect(stored.art).toEqual([
      { outcome: "set", monsterKey: KEY, name: "Mossling" },
    ]);
    expect(s.imageSource.loads).toEqual([{ url: urls.jsdelivr }]);
    expect(s.saved).toEqual([
      { mime: "image/webp", width: 280, height: 300, bytes },
    ]);
    expect(s.stored[KEY]).toEqual({
      art: {
        url: urls.jsdelivr,
        mime: "image/webp",
        width: 280,
        height: 300,
        sha256: HASH,
      },
      source: "default",
    });
    expect(s.setCalls.map((c) => c.origin)).toEqual([origin]);
  });

  it("loadDefaultArt answers has-art for a type with art from any source and loads nothing for it", async () => {
    const published = {
      url: "https://cdn.owlbear.rodeo/assets/mossling.png",
      mime: "image/png",
      width: 300,
      height: 280,
    };
    const kinds: StoredTokenArt[] = [
      { art: published, source: "table" },
      { art: published, source: "agent" },
      { art: published, source: "default" },
      { art: { sha256: "e".repeat(64) }, source: "agent" },
    ];
    for (const kept of kinds) {
      const s = setup({
        stored: { [KEY]: kept },
        images: { [urls.jsdelivr]: webpDeclaring(256, 256) },
      });

      const loaded = await loadDefaultArt(s.deps, [KEY]);

      expect(loaded).toEqual([
        { outcome: "has-art", monsterKey: KEY, name: "Mossling" },
      ]);
      expect(s.imageSource.loads).toEqual([]);
      expect(s.log).toEqual([]);
    }
  });

  it("loadDefaultArt answers not-covered for a type the index does not cover and loads nothing", async () => {
    const s = setup({
      index: makeTestTooManyTokensIndex([
        { name: "Owlbear", key: "srd-2024_owlbear", files: ["Owlbear.webp"] },
      ]),
    });

    const loaded = await loadDefaultArt(s.deps, [KEY]);

    expect(loaded).toEqual([
      { outcome: "not-covered", monsterKey: KEY, name: "Mossling" },
    ]);
    expect(s.imageSource.loads).toEqual([]);
  });

  it("loadDefaultArt keeps the raw.githubusercontent.com url when the jsDelivr load fails and storeDefaultArt stores it as the url", async () => {
    const bytes = webpDeclaring(256, 256);
    const s = setup({ images: { [urls.raw]: bytes } });

    const loaded = await loadDefaultArt(s.deps, [KEY]);

    expect(s.imageSource.loads).toEqual([
      { url: urls.jsdelivr },
      { url: urls.raw },
    ]);
    expect(loaded).toEqual([
      {
        outcome: "loaded",
        monsterKey: KEY,
        name: "Mossling",
        url: urls.raw,
        bytes,
      },
    ]);

    const stored = storeDefaultArt(s.deps, loaded, origin, s.write);
    expect(stored.art).toEqual([
      { outcome: "set", monsterKey: KEY, name: "Mossling" },
    ]);
    expect(s.stored[KEY]?.art.url).toBe(urls.raw);
    expect(s.stored[KEY]?.source).toBe("default");
  });

  it("loadDefaultArt answers failed with both urls' reasons when both loads fail and storeDefaultArt writes no art for it but still runs the write", async () => {
    const s = setup();

    const loaded = await loadDefaultArt(s.deps, [KEY]);

    expect(s.imageSource.loads).toEqual([
      { url: urls.jsdelivr },
      { url: urls.raw },
    ]);
    expect(loaded).toEqual([
      {
        outcome: "failed",
        monsterKey: KEY,
        name: "Mossling",
        reason: expect.any(String) as string,
      },
    ]);
    const reason = (loaded[0] as { reason: string }).reason;
    const jsdelivrAt = reason.indexOf(`No test image at ${urls.jsdelivr}.`);
    const rawAt = reason.indexOf(`No test image at ${urls.raw}.`);
    expect(jsdelivrAt).toBeGreaterThanOrEqual(0);
    expect(rawAt).toBeGreaterThan(jsdelivrAt);

    const stored = storeDefaultArt(s.deps, loaded, origin, s.write);
    expect(stored).toEqual({
      result: "written",
      art: [{ outcome: "failed", monsterKey: KEY, name: "Mossling", reason }],
    });
    expect(s.log).toEqual(["begin", "write in transaction", "commit"]);
    expect(s.stored).toEqual({});
  });

  it("loadDefaultArt tries the raw url when the store's checks refuse the jsDelivr bytes and answers failed naming the refusal when they refuse both", async () => {
    const good = webpDeclaring(256, 256);
    const tooWide = pngDeclaring(4096, 100);
    const refusedFirst = setup({
      images: { [urls.jsdelivr]: tooWide, [urls.raw]: good },
    });

    const fallback = await loadDefaultArt(refusedFirst.deps, [KEY]);

    expect(refusedFirst.imageSource.loads).toEqual([
      { url: urls.jsdelivr },
      { url: urls.raw },
    ]);
    expect(fallback).toEqual([
      {
        outcome: "loaded",
        monsterKey: KEY,
        name: "Mossling",
        url: urls.raw,
        bytes: good,
      },
    ]);

    const refusedBoth = setup({
      images: {
        [urls.jsdelivr]: tooWide,
        [urls.raw]: new Uint8Array([1, 2, 3, 4]),
      },
    });

    const failed = await loadDefaultArt(refusedBoth.deps, [KEY]);

    expect(failed).toEqual([
      {
        outcome: "failed",
        monsterKey: KEY,
        name: "Mossling",
        reason: expect.any(String) as string,
      },
    ]);
    const reason = (failed[0] as { reason: string }).reason;
    expect(reason).toMatch(/refused/);
    const jsdelivrAt = reason.indexOf(urls.jsdelivr);
    expect(jsdelivrAt).toBeGreaterThanOrEqual(0);
    expect(reason.indexOf(urls.raw)).toBeGreaterThan(jsdelivrAt);
  });

  it("loadDefaultArt handles each distinct key once in input order and gives a key not in the monster index no entry", async () => {
    const mosslingBytes = webpDeclaring(256, 256);
    const s = setup({
      stored: {
        [OTHER_KEY]: { art: { sha256: "f".repeat(64) }, source: "table" },
      },
      images: {
        [urls.jsdelivr]: mosslingBytes,
        [brambleUrls.jsdelivr]: webpDeclaring(256, 256),
      },
    });

    const loaded = await loadDefaultArt(s.deps, [
      OTHER_KEY,
      "homebrew_unknown",
      KEY,
      OTHER_KEY,
      KEY,
    ]);

    expect(loaded).toEqual([
      { outcome: "has-art", monsterKey: OTHER_KEY, name: "Bramble" },
      {
        outcome: "loaded",
        monsterKey: KEY,
        name: "Mossling",
        url: urls.jsdelivr,
        bytes: mosslingBytes,
      },
    ]);
    expect(s.imageSource.loads).toEqual([{ url: urls.jsdelivr }]);
  });

  it("storeDefaultArt answers has-art and stores no bytes for a loaded type that got art since the load", async () => {
    const s = setup({ images: { [urls.jsdelivr]: webpDeclaring(256, 256) } });
    const loaded = await loadDefaultArt(s.deps, [KEY]);
    const picked: StoredTokenArt = {
      art: {
        url: "https://cdn.owlbear.rodeo/assets/picked.png",
        mime: "image/png",
        width: 300,
        height: 300,
      },
      source: "table",
    };
    s.stored[KEY] = picked;

    const stored = storeDefaultArt(s.deps, loaded, origin, s.write);

    expect(stored.art).toEqual([
      { outcome: "has-art", monsterKey: KEY, name: "Mossling" },
    ]);
    expect(s.saved).toEqual([]);
    expect(s.setCalls).toEqual([]);
    expect(s.stored[KEY]).toEqual(picked);
    expect(stored.result).toBe("written");
  });

  it("storeDefaultArt stores the bytes and assigns the art in one art transaction before it runs the write there and rethrows the write's error", () => {
    const loaded: LoadedDefaultArt[] = [
      {
        outcome: "loaded",
        monsterKey: KEY,
        name: "Mossling",
        url: urls.jsdelivr,
        bytes: webpDeclaring(256, 256),
      },
    ];

    const ok = setup();
    storeDefaultArt(ok.deps, loaded, origin, ok.write);
    expect(ok.log).toEqual([
      "begin",
      "save-image",
      `set-art ${KEY}`,
      "write in transaction",
      "commit",
    ]);

    const failing = setup();
    const boom = new Error("the write failed");
    expect(() =>
      storeDefaultArt(failing.deps, loaded, origin, () => {
        failing.write();
        throw boom;
      }),
    ).toThrow(boom);
    expect(failing.log).toEqual([
      "begin",
      "save-image",
      `set-art ${KEY}`,
      "write in transaction",
      "rollback",
    ]);
  });
});
