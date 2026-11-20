import { createHash } from "node:crypto";
import {
  createMonsterIndex,
  tooManyTokensUrls,
  type ChangeOrigin,
  type TokenArt,
} from "@ttrpg-agents/engine";
import {
  makeTestImageSource,
  makeTestSetupPorts,
  makeTestTokeniser,
  makeTestTooManyTokensIndex,
  pngDeclaring,
  webpDeclaring,
} from "@ttrpg-agents/engine/testing";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteCreatureRepository,
  SqliteEncounterDirectory,
  SqliteEncounterLog,
  SqliteTokenArtRepository,
  SqliteTokenImageRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

const GOBLIN = "srd-2024_goblin-warrior";
const FOLDER = "Goblin Warrior";
const TOTAL = 45;
const PATH = "/home/dm/art/goblin.png";

/** "Goblin_Warrior_01.webp" to "Goblin_Warrior_45.webp". */
function fileOf(n: number): string {
  return `Goblin_Warrior_${String(n).padStart(2, "0")}.webp`;
}

/** A TooManyTokens index with one folder of 45 variants, keyed to the Goblin Warrior. */
const goblinIndex = makeTestTooManyTokensIndex([
  {
    name: FOLDER,
    key: GOBLIN,
    files: Array.from({ length: TOTAL }, (_, i) => fileOf(i + 1)),
  },
]);

function urlsOf(n: number) {
  return tooManyTokensUrls(goblinIndex, { folder: FOLDER, file: fileOf(n) });
}

/** Distinct bytes for variant `n`: a WebP header declaring (100 + n) by 100 px. */
function bytesOf(n: number): Uint8Array {
  return webpDeclaring(100 + n, 100);
}

function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every variant's bytes at its jsDelivr url, but those of `missing`. */
function variantImages(missing: readonly number[] = []) {
  const images: Record<string, Uint8Array> = {
    [PATH]: pngDeclaring(1000, 600),
  };
  for (let n = 1; n <= TOTAL; n++)
    if (!missing.includes(n)) images[urlsOf(n).jsdelivr] = bytesOf(n);
  return images;
}

const SHEET = webpDeclaring(640, 512);

const seedOrigin: ChangeOrigin = { source: "table", commandId: "seed" };

const tablePick: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/goblin.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

let ctx: ToolContext;
let directory: SqliteEncounterDirectory;
let art: SqliteTokenArtRepository;
let log: SqliteEncounterLog;
let imageSource: ReturnType<typeof makeTestImageSource>;

beforeEach(() => {
  let tick = 1000;
  let commands = 0;
  // One database, as in production: the directory and both token art stores share it.
  const db = openDatabase(":memory:");
  directory = new SqliteEncounterDirectory(db, { now: () => tick++ });
  art = new SqliteTokenArtRepository(db);
  log = new SqliteEncounterLog(db);
  imageSource = makeTestImageSource(variantImages());
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    encounters: directory,
    monsters: createMonsterIndex(
      loadSrdMonsters(),
      new SqliteCreatureRepository(db),
    ),
    creatures: new SqliteCreatureRepository(db),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${String(tick)}`,
    browser: { showPage: () => Promise.reject(new Error("not stubbed")) },
    setup: makeTestSetupPorts(),
    tokeniser: makeTestTokeniser(),
    imageSource,
    tooManyTokens: goblinIndex,
    art,
    images: new SqliteTokenImageRepository(db),
    newCommandId: () => `command-${String(++commands)}`,
  };
});

async function call(name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(ctx, args);
}

/** Calls a tool and expects it to succeed. */
async function ok(name: string, args: unknown = {}): Promise<ToolResult> {
  const result = await call(name, args);
  expect(result.isError, `${name}: ${text(result)}`).toBeFalsy();
  return result;
}

function text(r: ToolResult): string {
  return r.content
    .flatMap((c) => (c.type === "text" ? [c.text] : []))
    .join("\n");
}

function artEventsSince(seq: number) {
  return log
    .eventsSince(seq)
    .filter((e) => "event" in e && e.event.type === "art-changed");
}

describe("show_token_variants", () => {
  it('show_token_variants returns the sheet as a WebP image block and the line "Goblin Warrior: variants 21-40 of 45, numbered left to right, top to bottom; the current art is 1." with no structured content', async () => {
    ctx.images.saveTokenImage({
      mime: "image/webp",
      width: 101,
      height: 100,
      bytes: bytesOf(1),
    });
    art.setTokenArt(
      GOBLIN,
      {
        url: urlsOf(1).jsdelivr,
        mime: "image/webp",
        width: 101,
        height: 100,
        sha256: hashOf(bytesOf(1)),
      },
      "default",
      seedOrigin,
    );

    const r = await ok("show_token_variants", { monster: GOBLIN, page: 2 });

    expect(r.content).toEqual([
      {
        type: "image",
        data: Buffer.from(SHEET).toString("base64"),
        mimeType: "image/webp",
      },
      {
        type: "text",
        text: "Goblin Warrior: variants 21-40 of 45, numbered left to right, top to bottom; the current art is 1.",
      },
    ]);
    expect(r.structuredContent).toBeUndefined();
  });

  it("show_token_variants's line says none of the variants is the current art and how many images could not be loaded", async () => {
    ctx.imageSource = makeTestImageSource(variantImages([5, 42, 44]));
    art.setTokenArt(GOBLIN, tablePick, "table", seedOrigin);

    const page3 = await ok("show_token_variants", { monster: GOBLIN, page: 3 });
    const page1 = await ok("show_token_variants", { monster: GOBLIN });

    expect(text(page3)).toBe(
      "Goblin Warrior: variants 41-45 of 45, numbered left to right, top to bottom; none of the variants is the current art. 2 could not be loaded and are left blank.",
    );
    expect(text(page1)).toBe(
      "Goblin Warrior: variants 1-20 of 45, numbered left to right, top to bottom; none of the variants is the current art. 1 could not be loaded and is left blank.",
    );
  });

  it("show_token_variants's line names the one variant of a last page that holds one", async () => {
    ctx.tooManyTokens = makeTestTooManyTokensIndex([
      {
        name: FOLDER,
        key: GOBLIN,
        files: Array.from({ length: 41 }, (_, i) => fileOf(i + 1)),
      },
    ]);

    const page3 = await ok("show_token_variants", { monster: GOBLIN, page: 3 });

    expect(text(page3)).toBe(
      "Goblin Warrior: variant 41 of 41, numbered left to right, top to bottom; none of the variants is the current art.",
    );
  });

  it("show_token_variants creates no encounter with none in the store, nor in an open scene that has none", async () => {
    await ok("show_token_variants", { monster: GOBLIN });

    expect(directory.listEncounters()).toEqual([]);
    expect(directory.getCurrentEncounter()).toBeUndefined();

    directory.setOpenScene("scene-1");

    await ok("show_token_variants", { monster: GOBLIN });

    expect(directory.listEncounters()).toEqual([]);
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: undefined,
    });
  });
});

describe("set_token_art with variant", () => {
  it("set_token_art with variant and no encounter in the store writes one art-changed event with a null encounter id, the variant's jsDelivr url and its hash, creates no encounter, and replies naming the variant and the art it replaced with its source", async () => {
    art.setTokenArt(GOBLIN, tablePick, "table", seedOrigin);
    const before = log.latestSeq();

    const r = await ok("set_token_art", { monster: GOBLIN, variant: 3 });

    const sha256 = hashOf(bytesOf(3));
    expect(artEventsSince(before)).toEqual([
      {
        seq: expect.any(Number) as number,
        encounterId: null,
        event: {
          type: "art-changed",
          monsterKey: GOBLIN,
          art: {
            url: urlsOf(3).jsdelivr,
            mime: "image/webp",
            width: 103,
            height: 100,
            sha256,
          },
          origin: {
            source: "mcp",
            commandId: expect.any(String) as string,
          },
        },
      },
    ]);
    expect(directory.listEncounters()).toEqual([]);
    expect(text(r)).toBe(
      [
        `Set Goblin Warrior (${GOBLIN}) token art to TooManyTokens variant 3 (${FOLDER}/${fileOf(3)}). It replaces a GM pick in Owlbear.`,
        "It is published in Owlbear: new Goblin Warrior tokens are drawn with it, and those in the open scene are redrawn once.",
      ].join("\n"),
    );
    expect(r.structuredContent).toEqual({
      outcome: "set",
      monsterKey: GOBLIN,
      sha256,
      replaced: "table",
      kept: null,
      published: true,
      summary: text(r),
    });
  });

  it("set_token_art refuses variant together with image, variant with focus or zoom, and neither image nor variant, writing nothing", async () => {
    const before = log.latestSeq();
    const refusals: [Record<string, unknown>, string][] = [
      [
        { monster: GOBLIN, image: PATH, variant: 1 },
        "Give image or variant, not both.",
      ],
      [
        { monster: GOBLIN, variant: 1, focus: { x: 0.5, y: 0.5 } },
        "focus and zoom apply to image only; a variant is used as it is.",
      ],
      [
        { monster: GOBLIN, variant: 1, zoom: 2 },
        "focus and zoom apply to image only; a variant is used as it is.",
      ],
      [
        { monster: GOBLIN },
        "Give image (an absolute file path or an https URL) or variant (a number from show_token_variants).",
      ],
    ];

    for (const [args, message] of refusals) {
      const r = await call("set_token_art", args);

      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(text(r), JSON.stringify(args)).toBe(message);
    }
    expect(imageSource.loads).toEqual([]);
    expect(artEventsSince(before)).toEqual([]);
    expect(art.getTokenArt(GOBLIN)).toBeUndefined();
    expect(directory.listEncounters()).toEqual([]);
  });

  it("set_token_art with the variant the type's art already is replies that nothing changed and logs no art-changed event", async () => {
    const sha256 = hashOf(bytesOf(1));
    const kept: TokenArt = {
      url: urlsOf(1).jsdelivr,
      mime: "image/webp",
      width: 101,
      height: 100,
      sha256,
    };
    ctx.images.saveTokenImage({
      mime: "image/webp",
      width: 101,
      height: 100,
      bytes: bytesOf(1),
    });
    art.setTokenArt(GOBLIN, kept, "default", seedOrigin);
    const before = log.latestSeq();

    const r = await ok("set_token_art", { monster: GOBLIN, variant: 1 });

    expect(text(r)).toBe(
      `Goblin Warrior (${GOBLIN}) already has TooManyTokens variant 1 as its art, from the TooManyTokens default; nothing changed.`,
    );
    expect(r.structuredContent).toEqual({
      outcome: "unchanged",
      monsterKey: GOBLIN,
      sha256,
      replaced: null,
      kept: "default",
      published: true,
      summary: text(r),
    });
    expect(artEventsSince(before)).toEqual([]);
    expect(art.getTokenArt(GOBLIN)).toEqual({ art: kept, source: "default" });
  });
});
