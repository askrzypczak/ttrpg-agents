import { createHash } from "node:crypto";
import { createMonsterIndex, tooManyTokensUrls } from "@ttrpg-agents/engine";
import {
  makeTestImageSource,
  makeTestSetupPorts,
  makeTestTokeniser,
  makeTestTooManyTokensIndex,
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

const WOLF = "srd-2024_wolf";
const SHADOW = "srd-2024_shadow";

/** A TooManyTokens index with one folder, keyed to the Wolf. */
const wolfIndex = makeTestTooManyTokensIndex([
  { name: "Wolf", key: WOLF, files: ["Wolf_01.webp"] },
]);
const wolfUrls = tooManyTokensUrls(wolfIndex, {
  folder: "Wolf",
  file: "Wolf_01.webp",
});
const wolfBytes = webpDeclaring(256, 256);
const WOLF_HASH = createHash("sha256").update(wolfBytes).digest("hex");

const SET_LINE = "Wolf: token art set to the TooManyTokens default.";

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
    imageSource: makeTestImageSource({ [wolfUrls.jsdelivr]: wolfBytes }),
    art,
    images: new SqliteTokenImageRepository(db),
    newCommandId: () => `command-${String(++commands)}`,
    tooManyTokens: wolfIndex,
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

function lines(r: ToolResult): string[] {
  return text(r).split("\n");
}

/** Adds Wolves while the index covers nothing, so the Wolf keeps no art. */
async function addWolvesWithoutArt(count: number): Promise<void> {
  ctx.tooManyTokens = makeTestTooManyTokensIndex();
  await ok("add_monsters", { groups: [{ monster: WOLF, count }] });
  ctx.tooManyTokens = wolfIndex;
  expect(art.getTokenArt(WOLF)).toBeUndefined();
}

describe("the TooManyTokens default art in the tools' replies", () => {
  it("add_monsters of a covered type with no art replies with a line naming the type and the TooManyTokens default", async () => {
    const r = await ok("add_monsters", {
      groups: [{ monster: WOLF, count: 2 }],
    });

    expect(lines(r)).toContain(SET_LINE);
    expect(art.getTokenArt(WOLF)).toEqual({
      art: {
        url: wolfUrls.jsdelivr,
        mime: "image/webp",
        width: 256,
        height: 256,
        sha256: WOLF_HASH,
      },
      source: "default",
    });
  });

  it("add_monsters with both default art loads failing adds the monsters and replies with a line naming the type and the reason", async () => {
    ctx.imageSource = makeTestImageSource();

    const r = await ok("add_monsters", {
      groups: [{ monster: WOLF, count: 2 }],
    });

    const current = directory.getCurrentEncounter();
    if (!current) throw new Error("no current encounter");
    expect(
      directory
        .repositoryFor(current.id)
        .listInstances()
        .map((i) => i.monsterKey),
    ).toEqual([WOLF, WOLF]);
    const failed = lines(r).filter((l) =>
      l.startsWith("No TooManyTokens art for Wolf"),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain(wolfUrls.jsdelivr);
    expect(failed[0]).toContain(wolfUrls.raw);
    expect(art.getTokenArt(WOLF)).toBeUndefined();
  });

  it("add_monsters of a covered type with no art logs art-changed with no encounter before its added event", async () => {
    const before = log.latestSeq();

    await ok("add_monsters", { groups: [{ monster: WOLF, count: 1 }] });

    const events = log
      .eventsSince(before)
      .flatMap((e) =>
        "event" in e
          ? [{ type: e.event.type, encounterId: e.encounterId }]
          : [],
      );
    const current = directory.getCurrentEncounter();
    if (!current) throw new Error("no current encounter");
    expect(events).toEqual([
      { type: "art-changed", encounterId: null },
      { type: "added", encounterId: current.id },
    ]);
  });

  it("change_monster_type to a covered type with no art replies with the default art line", async () => {
    await ok("add_monsters", { groups: [{ monster: SHADOW, count: 1 }] });

    const r = await ok("change_monster_type", {
      targets: ["Shadow 1"],
      monster: WOLF,
      hp: "average",
    });

    expect(lines(r)).toContain(SET_LINE);
    expect(art.getTokenArt(WOLF)?.source).toBe("default");
  });

  it("restore_monsters of a monster whose covered type has no art replies with the default art line", async () => {
    await addWolvesWithoutArt(1);
    await ok("remove_monsters", { targets: ["Wolf 1"] });

    const r = await ok("restore_monsters", { targets: ["Wolf 1"] });

    expect(lines(r)).toContain(SET_LINE);
    expect(art.getTokenArt(WOLF)?.source).toBe("default");
  });

  it("restore_encounter of monsters whose covered type has no art replies with the default art line", async () => {
    await addWolvesWithoutArt(2);
    await ok("clear_encounter");

    const r = await ok("restore_encounter");

    expect(lines(r)).toContain(SET_LINE);
    expect(art.getTokenArt(WOLF)?.source).toBe("default");
  });
});
