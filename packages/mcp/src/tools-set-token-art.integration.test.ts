import { createHash } from "node:crypto";
import {
  createMonsterIndex,
  type ChangeOrigin,
  type TokenArt,
  type TokenArtSource,
} from "@ttrpg-agents/engine";
import {
  makeTestImageSource,
  makeTestSetupPorts,
  makeTestTokeniser,
  pngDeclaring,
  webpDeclaring,
  makeTestTooManyTokensIndex,
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

const PATH = "/home/dm/art/owlbear.png";
const WOLF = "srd-2024_wolf";
/** SHA-256 of the test tokeniser's rendered token. */
const TOKEN_HASH = createHash("sha256")
  .update(webpDeclaring(512, 512))
  .digest("hex");

const publishedArt = (name: string): TokenArt => ({
  url: `https://cdn.owlbear.rodeo/assets/${name}.png`,
  mime: "image/png",
  width: 300,
  height: 280,
});

const seedOrigin: ChangeOrigin = { source: "table", commandId: "seed" };

let ctx: ToolContext;
let directory: SqliteEncounterDirectory;
let art: SqliteTokenArtRepository;
let log: SqliteEncounterLog;

beforeEach(() => {
  let tick = 1000;
  let commands = 0;
  // One database, as in production: the directory and both token art stores share it.
  const db = openDatabase(":memory:");
  directory = new SqliteEncounterDirectory(db, { now: () => tick++ });
  art = new SqliteTokenArtRepository(db);
  log = new SqliteEncounterLog(db);
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
    imageSource: makeTestImageSource({ [PATH]: pngDeclaring(1000, 600) }),
    tooManyTokens: makeTestTooManyTokensIndex(),
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
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

const PREVIEW_LINE =
  "Source: 1000 x 600 px PNG. Focus: x 0.50, y 0.40. Zoom: 1. Crop: 600 px square at x 200, y 0.";

const waitsLine = (name: string): string =>
  `It waits on the GM: in the extension panel, click Re-upload next to ${name}, then Pick the uploaded image. ${name} is listed there while the open scene's encounter has one. Until it is published, new ${name} tokens are circles and existing ones keep their look.`;

describe("set_token_art", () => {
  it("set_token_art on a generated image writes one art-changed event with a null encounter id while an encounter is current, and its reply says the GM publishes it with Re-upload, then Pick the uploaded image", async () => {
    await ok("add_monsters", { groups: [{ monster: WOLF, count: 1 }] });
    const encounters = directory.listEncounters();
    expect(directory.getCurrentEncounter()).toBeDefined();
    const before = log.latestSeq();

    const r = await ok("set_token_art", {
      monster: WOLF,
      image: PATH,
      focus: { x: 0.5, y: 0.4 },
    });

    const artEvents = log
      .eventsSince(before)
      .filter((e) => "event" in e && e.event.type === "art-changed");
    expect(artEvents).toEqual([
      {
        seq: expect.any(Number) as number,
        encounterId: null,
        event: {
          type: "art-changed",
          monsterKey: WOLF,
          art: { sha256: TOKEN_HASH },
          origin: {
            source: "mcp",
            commandId: expect.any(String) as string,
          },
        },
      },
    ]);
    expect(text(r)).toBe(
      [
        `Set Wolf (${WOLF}) token art to a token made from ${PATH}. It had no art before.`,
        PREVIEW_LINE,
        waitsLine("Wolf"),
      ].join("\n"),
    );
    expect(r.structuredContent).toEqual({
      outcome: "set",
      monsterKey: WOLF,
      sha256: TOKEN_HASH,
      replaced: null,
      kept: null,
      published: false,
      summary: text(r),
    });
    expect(directory.listEncounters()).toEqual(encounters);
  });

  it("set_token_art's reply names the art it replaced by source: a GM pick in Owlbear, art set through the agent, the TooManyTokens default, or no art before", async () => {
    const priors: [string, string, TokenArtSource][] = [
      ["srd-2024_shadow", "Shadow", "table"],
      ["srd-2024_goblin-warrior", "Goblin Warrior", "agent"],
      ["srd-2024_owlbear", "Owlbear", "default"],
    ];
    for (const [key, name, source] of priors)
      art.setTokenArt(key, publishedArt(name), source, seedOrigin);

    const firstLine = async (monster: string): Promise<string | undefined> =>
      text(await ok("set_token_art", { monster, image: PATH })).split("\n")[0];

    expect(await firstLine("srd-2024_shadow")).toBe(
      `Set Shadow (srd-2024_shadow) token art to a token made from ${PATH}. It replaces a GM pick in Owlbear.`,
    );
    expect(await firstLine("srd-2024_goblin-warrior")).toBe(
      `Set Goblin Warrior (srd-2024_goblin-warrior) token art to a token made from ${PATH}. It replaces art set through the agent (the DM's own image or a chosen variant).`,
    );
    expect(await firstLine("srd-2024_owlbear")).toBe(
      `Set Owlbear (srd-2024_owlbear) token art to a token made from ${PATH}. It replaces the TooManyTokens default.`,
    );
    expect(await firstLine(WOLF)).toBe(
      `Set Wolf (${WOLF}) token art to a token made from ${PATH}. It had no art before.`,
    );
  });

  it("undo right after set_token_art says set_token_art is not covered and changes nothing", async () => {
    await ok("add_monsters", { groups: [{ monster: WOLF, count: 1 }] });
    await ok("set_token_art", { monster: WOLF, image: PATH });
    const current = directory.getCurrentEncounter();
    if (!current) throw new Error("no current encounter");
    const before = directory.repositoryFor(current.id).listInstances();

    const r = await ok("undo");

    expect(text(r)).toContain(
      "The last change was set_token_art, which undo does not cover; nothing was changed.",
    );
    expect(directory.repositoryFor(current.id).listInstances()).toEqual(before);
    expect(art.getTokenArt(WOLF)).toEqual({
      art: { sha256: TOKEN_HASH },
      source: "agent",
    });
  });

  it("set_token_art with no encounter in the store sets the art and creates none", async () => {
    await ok("set_token_art", { monster: WOLF, image: PATH });

    expect(art.getTokenArt(WOLF)).toEqual({
      art: { sha256: TOKEN_HASH },
      source: "agent",
    });
    expect(directory.listEncounters()).toEqual([]);
    expect(directory.getCurrentEncounter()).toBeUndefined();
  });

  it("set_token_art with a token whose hash the type's art already has keeps that art, logs no art-changed event and says nothing changed", async () => {
    ctx.images.saveTokenImage({
      mime: "image/webp",
      width: 512,
      height: 512,
      bytes: webpDeclaring(512, 512),
    });
    art.setTokenArt(
      WOLF,
      { ...publishedArt("Wolf"), sha256: TOKEN_HASH },
      "table",
      seedOrigin,
    );
    const before = log.latestSeq();

    const r = await ok("set_token_art", {
      monster: WOLF,
      image: PATH,
      focus: { x: 0.5, y: 0.4 },
    });

    expect(text(r)).toBe(
      [
        `Wolf (${WOLF}) already has this token as its art, from a GM pick in Owlbear; nothing changed.`,
        PREVIEW_LINE,
        "It is published in Owlbear.",
      ].join("\n"),
    );
    expect(r.structuredContent).toEqual({
      outcome: "unchanged",
      monsterKey: WOLF,
      sha256: TOKEN_HASH,
      replaced: null,
      kept: "table",
      published: true,
      summary: text(r),
    });
    const artEvents = log
      .eventsSince(before)
      .filter((e) => "event" in e && e.event.type === "art-changed");
    expect(artEvents).toEqual([]);
    expect(art.getTokenArt(WOLF)).toEqual({
      art: { ...publishedArt("Wolf"), sha256: TOKEN_HASH },
      source: "table",
    });
  });
});
