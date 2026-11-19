import { describe, expect, it } from "vitest";
import {
  makeTestImageSource,
  makeTestMonster,
  makeTestMonsterIndex,
  makeTestTokeniser,
  pngDeclaring,
  webpDeclaring,
} from "../testing/index.js";
import { UnknownMonsterError } from "./errors.js";
import type { ChangeOrigin } from "./origin.js";
import { setOwnTokenArt, type SetOwnTokenArtDeps } from "./own-token-art.js";
import type { EncounterRepository } from "./repository.js";
import type {
  StoredTokenArt,
  TokenArt,
  TokenArtRepository,
  TokenArtSource,
} from "./token-art.js";
import type {
  NewTokenImage,
  TokenImage,
  TokenImageRepository,
} from "./token-image.js";
import type { Encounter } from "./types.js";

const PATH = "/home/dm/art/owlbear.png";
const KEY = "homebrew_mossling";
/** The hash the fake image store answers for the made token. */
const TOKEN_HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const AGENT_HASH = "c".repeat(64);

const origin: ChangeOrigin = {
  source: "mcp",
  commandId: "command-1",
  command: "set_token_art",
};

const published = (sha256: string): TokenArt => ({
  url: "https://cdn.owlbear.rodeo/assets/mossling.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256,
});

type Write =
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
 * all recording their writes in one list, in order.
 */
function setup(initial: Record<string, StoredTokenArt> = {}) {
  const writes: Write[] = [];
  const stored: Record<string, StoredTokenArt> = { ...initial };
  const art: TokenArtRepository = {
    listTokenArt() {
      return Object.fromEntries(
        Object.entries(stored).map(([key, value]) => [key, value.art]),
      );
    },
    getTokenArt(monsterKey) {
      return Object.hasOwn(stored, monsterKey) ? stored[monsterKey] : undefined;
    },
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
      return fn();
    },
  };
  const images: TokenImageRepository = {
    saveTokenImage(image) {
      writes.push({ kind: "saveTokenImage", image });
      return TOKEN_HASH;
    },
    getTokenImage(): TokenImage | undefined {
      return undefined;
    },
  };
  const current: Encounter = { id: "enc-1", name: "Encounter 1", createdAt: 0 };
  const directory: SetOwnTokenArtDeps["directory"] = {
    getOpenScene: () => undefined,
    getCurrentEncounter: () => current,
    repositoryFor: (encounterId) =>
      ({
        noteCommand: (at: ChangeOrigin) => {
          writes.push({ kind: "noteCommand", encounterId, origin: at });
        },
      }) as unknown as EncounterRepository,
  };
  const imageSource = makeTestImageSource({ [PATH]: pngDeclaring(1000, 600) });
  const monster = makeTestMonster();
  const deps: SetOwnTokenArtDeps = {
    imageSource,
    tokeniser: makeTestTokeniser(),
    monsters: makeTestMonsterIndex([monster]),
    art,
    images,
    directory,
  };
  return { deps, writes, stored, imageSource, monster };
}

const tokenImage: NewTokenImage = {
  mime: "image/webp",
  width: 512,
  height: 512,
  bytes: webpDeclaring(512, 512),
};

/** The writes of a set over any prior art: bytes, then the art, then the note. */
const setWrites: Write[] = [
  { kind: "saveTokenImage", image: tokenImage },
  {
    kind: "setTokenArt",
    monsterKey: KEY,
    art: { sha256: TOKEN_HASH },
    source: "agent",
    origin,
  },
  { kind: "noteCommand", encounterId: "enc-1", origin },
];

async function expectSetOver(prior: StoredTokenArt | undefined) {
  const { deps, writes, stored, monster } = setup(
    prior === undefined ? {} : { [KEY]: prior },
  );

  const result = await setOwnTokenArt(deps, KEY, PATH, {}, origin);

  expect(result).toMatchObject({
    outcome: "set",
    monster,
    sha256: TOKEN_HASH,
    replaced: prior ?? null,
    published: false,
  });
  expect(result.token.bytes).toEqual(webpDeclaring(512, 512));
  expect(writes).toEqual(setWrites);
  expect(stored[KEY]).toEqual({ art: { sha256: TOKEN_HASH }, source: "agent" });
}

describe("setOwnTokenArt", () => {
  it("setOwnTokenArt stores the token bytes and sets { sha256 } with source agent on a type with no art, answering no replaced art and that the art waits to be published", async () => {
    await expectSetOver(undefined);
  });

  it("setOwnTokenArt stores the token bytes and replaces default art with { sha256 } and source agent, answering the replaced art and its source default", async () => {
    await expectSetOver({ art: published(OTHER_HASH), source: "default" });
  });

  it("setOwnTokenArt stores the token bytes and replaces agent art with { sha256 } and source agent, answering the replaced art and its source agent", async () => {
    await expectSetOver({ art: { sha256: AGENT_HASH }, source: "agent" });
  });

  it("setOwnTokenArt stores the token bytes and replaces table art (a GM pick) with { sha256 } and source agent, answering the replaced art and its source table", async () => {
    await expectSetOver({ art: published(OTHER_HASH), source: "table" });
  });

  it("setOwnTokenArt refuses an unknown monster key with UnknownMonsterError, loading no image and writing nothing", async () => {
    const { deps, writes, imageSource } = setup();

    const error: unknown = await setOwnTokenArt(
      deps,
      "homebrew_nothing",
      PATH,
      {},
      origin,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(UnknownMonsterError);
    expect((error as Error).message).toBe(
      'Unknown monster "homebrew_nothing". Use search_monsters to find keys.',
    );
    expect(imageSource.loads).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("setOwnTokenArt keeps stored art that already has the token's hash, url included, writes no art and notes no command, and answers unchanged with whether it is published", async () => {
    const kept: StoredTokenArt = {
      art: published(TOKEN_HASH),
      source: "table",
    };
    const { deps, writes, stored, monster } = setup({ [KEY]: kept });

    const result = await setOwnTokenArt(deps, KEY, PATH, {}, origin);

    expect(result).toMatchObject({
      outcome: "unchanged",
      monster,
      sha256: TOKEN_HASH,
      kept,
      published: true,
    });
    expect(
      writes.filter(
        (w) => w.kind === "setTokenArt" || w.kind === "noteCommand",
      ),
    ).toEqual([]);
    expect(stored[KEY]).toEqual(kept);
  });
});
