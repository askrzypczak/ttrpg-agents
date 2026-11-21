import {
  assessDifficulty,
  createMonsterIndex,
  type DifficultyAssessment,
} from "@ttrpg-agents/engine";
import {
  makeTestInstance,
  makeTestMonster,
  makeTestMonsterIndex,
  makeTestSetupPorts,
} from "@ttrpg-agents/engine/testing";
import { loadSrdDifficultyTables, loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteCreatureRepository,
  SqliteEncounterDirectory,
  SqlitePartyStore,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

const GOBLIN_WARRIOR = "srd-2024_goblin-warrior";
const ADULT_RED_DRAGON = "srd-2024_adult-red-dragon";
const BUGBEAR_WARRIOR = "srd-2024_bugbear-warrior";

let ctx: ToolContext;
let directory: SqliteEncounterDirectory;
let partyStore: SqlitePartyStore;

beforeEach(() => {
  let tick = 1000;
  let commands = 0;
  // One database, as in production: encounters, creatures and the party share it.
  const db = openDatabase(":memory:");
  directory = new SqliteEncounterDirectory(db, { now: () => tick++ });
  const creatures = new SqliteCreatureRepository(db);
  partyStore = new SqlitePartyStore(db);
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    encounters: directory,
    monsters: createMonsterIndex(loadSrdMonsters(), creatures),
    creatures,
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${String(tick)}`,
    browser: { showPage: () => Promise.reject(new Error("not stubbed")) },
    setup: makeTestSetupPorts(),
    newCommandId: () => `command-${String(++commands)}`,
    difficultyTables: loadSrdDifficultyTables(),
    party: partyStore,
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

/** The cells of each table row in the reply, header included, separator rows left out. */
function tableRows(r: ToolResult): string[][] {
  return lines(r)
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

function rowOf(r: ToolResult, name: string): string[] | undefined {
  return tableRows(r).find((cells) => cells[0] === name);
}

function assessment(r: ToolResult): DifficultyAssessment {
  return r.structuredContent as unknown as DifficultyAssessment;
}

function currentInstances() {
  const current = directory.getCurrentEncounter();
  if (!current) throw new Error("no current encounter");
  return directory.repositoryFor(current.id).listInstances();
}

async function addGoblins(count: number, encounter?: string): Promise<void> {
  await ok("add_monsters", {
    groups: [{ monster: GOBLIN_WARRIOR, count, hp: "average" }],
    ...(encounter !== undefined && { encounter }),
  });
}

describe("assess_difficulty", () => {
  it("assess_difficulty with four goblin warriors and a stored party of four level-1 characters reports 200 XP against budgets of 200, 300 and 400 and the band Low", async () => {
    partyStore.set({ size: 4, level: 1 });
    await addGoblins(4);

    const r = await ok("assess_difficulty");

    expect(lines(r)).toContain(
      "Difficulty: Low. 200 XP against budgets of Low 200, Moderate 300, High 400.",
    );
    const result = assessment(r);
    expect(result.totals.xp).toBe(200);
    expect(result.party.budgets).toEqual({
      low: 200,
      moderate: 300,
      high: 400,
    });
    expect(result.band).toBe("low");
  });

  it("assess_difficulty with partySize 5 and partyLevel 3 uses the budgets of five level-3 characters, says the party is for this call only, and leaves the stored party unchanged", async () => {
    partyStore.set({ size: 4, level: 1 });
    await addGoblins(4);

    const r = await ok("assess_difficulty", { partySize: 5, partyLevel: 3 });

    expect(lines(r)).toContain(
      "Party: 5 characters, level 3, for this call only (stored: 4 characters, level 1).",
    );
    expect(lines(r)).toContain(
      "Difficulty: Low. 200 XP against budgets of Low 750, Moderate 1125, High 2000.",
    );
    expect(assessment(r).party).toEqual({
      size: 5,
      level: 3,
      budgets: { low: 750, moderate: 1125, high: 2000 },
    });
    expect(partyStore.get()).toEqual({ size: 4, level: 1 });
  });

  it('assess_difficulty with no party stored and no override fails with "Party size and level are not set." and creates no encounter', async () => {
    const r = await call("assess_difficulty");

    expect(r.isError).toBe(true);
    expect(text(r)).toBe("Party size and level are not set.");
    expect(directory.listEncounters()).toEqual([]);
    expect(directory.getCurrentEncounter()).toBeUndefined();
    expect(partyStore.get()).toBeNull();
  });

  it("assess_difficulty with `with` counts the hypothetical monsters together with the encounter's and leaves the encounter's instances unchanged", async () => {
    partyStore.set({ size: 4, level: 3 });
    await addGoblins(4);
    const before = currentInstances();
    const encountersBefore = directory.listEncounters();

    const r = await ok("assess_difficulty", {
      with: [
        { monster: GOBLIN_WARRIOR, count: 2 },
        { monster: BUGBEAR_WARRIOR, count: 1 },
      ],
    });

    const result = assessment(r);
    expect(
      result.monsters.map((m) => ({
        monsterKey: m.monsterKey,
        encounterCount: m.encounterCount,
        hypotheticalCount: m.hypotheticalCount,
        xpTotal: m.xpTotal,
      })),
    ).toEqual([
      {
        monsterKey: GOBLIN_WARRIOR,
        encounterCount: 4,
        hypotheticalCount: 2,
        xpTotal: 300,
      },
      {
        monsterKey: BUGBEAR_WARRIOR,
        encounterCount: 0,
        hypotheticalCount: 1,
        xpTotal: 200,
      },
    ]);
    expect(result.totals.monsterCount).toBe(7);
    expect(result.totals.xp).toBe(500);
    expect(rowOf(r, "Goblin Warrior")?.[2]).toBe("4 (+2 hypothetical)");
    expect(rowOf(r, "Bugbear Warrior")?.[2]).toBe("0 (+1 hypothetical)");
    expect(currentInstances()).toEqual(before);
    expect(directory.listEncounters()).toEqual(encountersBefore);
  });

  it("assess_difficulty with encounter assesses the named encounter rather than the open scene's", async () => {
    partyStore.set({ size: 4, level: 1 });
    const ambush = directory.createEncounter("Ambush");
    const camp = directory.createEncounter("Camp");
    await addGoblins(4, "Ambush");
    await ok("add_monsters", {
      encounter: "Camp",
      groups: [{ monster: BUGBEAR_WARRIOR, count: 1, hp: "average" }],
    });
    directory.setOpenScene("scene-1");
    directory.bindScene("scene-1", camp.id);

    const r = await ok("assess_difficulty", { encounter: "Ambush" });

    expect(r.structuredContent?.["encounter"]).toBe(ambush.name);
    expect(assessment(r).monsters.map((m) => m.monsterKey)).toEqual([
      GOBLIN_WARRIOR,
    ]);
    expect(assessment(r).totals.xp).toBe(200);
  });

  it('assess_difficulty in an open scene with no encounter and no `with` replies "This scene has no encounter yet." and creates no encounter', async () => {
    partyStore.set({ size: 4, level: 1 });
    const tavern = directory.createEncounter("Tavern");
    directory.setCurrentEncounter(tavern.id);
    directory.setOpenScene("scene-1");

    const r = await call("assess_difficulty");

    expect(r.isError).toBe(true);
    expect(text(r)).toBe("This scene has no encounter yet.");
    expect(directory.listEncounters()).toEqual([tavern]);
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: undefined,
    });
  });

  it("assess_difficulty in an open scene with no encounter assesses the `with` monsters alone, says so, and creates no encounter", async () => {
    partyStore.set({ size: 4, level: 1 });
    const tavern = directory.createEncounter("Tavern");
    directory.setCurrentEncounter(tavern.id);
    directory.setOpenScene("scene-1");

    const r = await ok("assess_difficulty", {
      with: [{ monster: GOBLIN_WARRIOR, count: 3 }],
    });

    expect(lines(r)[0]).toBe(
      "This scene has no encounter yet; assessed the hypothetical monsters alone.",
    );
    const result = assessment(r);
    expect(
      result.monsters.map((m) => ({
        monsterKey: m.monsterKey,
        encounterCount: m.encounterCount,
        hypotheticalCount: m.hypotheticalCount,
      })),
    ).toEqual([
      { monsterKey: GOBLIN_WARRIOR, encounterCount: 0, hypotheticalCount: 3 },
    ]);
    expect(result.totals.xp).toBe(150);
    expect(r.structuredContent?.["encounter"]).toBeUndefined();
    expect(directory.listEncounters()).toEqual([tavern]);
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: undefined,
    });
  });

  it("a stored creature in the encounter counts at the XP of its CR", async () => {
    partyStore.set({ size: 4, level: 3 });
    await ok("create_creature", {
      book: "homebrew",
      from: GOBLIN_WARRIOR,
      changes: { name: "Goblin Captain", cr: 2 },
    });
    await ok("add_monsters", {
      groups: [{ monster: "homebrew_goblin-captain", count: 1, hp: "average" }],
    });

    const r = await ok("assess_difficulty");

    const result = assessment(r);
    expect(
      result.monsters.map((m) => ({
        monsterKey: m.monsterKey,
        cr: m.cr,
        xpEach: m.xpEach,
      })),
    ).toEqual([{ monsterKey: "homebrew_goblin-captain", cr: 2, xpEach: 450 }]);
    expect(result.totals.xp).toBe(450);
    expect(result.problems).toEqual([]);
    expect(rowOf(r, "Goblin Captain")?.slice(1, 5)).toEqual([
      "2",
      "1",
      "450",
      "450",
    ]);
  });

  it("assess_difficulty with inLair counts an Adult Red Dragon at the next CR's XP and names it in the lair line", async () => {
    partyStore.set({ size: 4, level: 15 });
    await ok("add_monsters", {
      groups: [{ monster: ADULT_RED_DRAGON, count: 1, hp: "average" }],
    });

    const outside = await ok("assess_difficulty");
    const inLair = await ok("assess_difficulty", { inLair: true });

    expect(assessment(outside).monsters[0]?.xpEach).toBe(18000);
    expect(lines(outside)).toContain(
      "Lair variant: Adult Red Dragon. With inLair, each counts at the next CR's XP.",
    );
    expect(assessment(inLair).monsters[0]?.xpEach).toBe(20000);
    expect(assessment(inLair).totals.xp).toBe(20000);
    expect(lines(inLair)).toContain(
      "In lair: Adult Red Dragon counted at the next CR's XP.",
    );
  });

  it('assess_difficulty\'s reply lists each monster type\'s CR, count, XP each, XP total, Multiattack, legendary and lair, the monster count against the party size, the HP totals and the count at 0 HP, its structured content is the engine\'s assessment, an encounter over the High budget reads "above High", and the text never says "deadly"', async () => {
    partyStore.set({ size: 4, level: 1 });
    await addGoblins(4);
    await ok("add_monsters", {
      groups: [{ monster: ADULT_RED_DRAGON, count: 1, hp: "average" }],
    });
    const downed = currentInstances().find(
      (i) => i.monsterKey === GOBLIN_WARRIOR,
    );
    if (!downed) throw new Error("no goblin");
    await ok("set_hp", { target: downed.id, hp: 0 });
    const instances = currentInstances();

    const r = await ok("assess_difficulty");

    expect(lines(r)).toContain("Party: 4 characters, level 1.");
    expect(lines(r)).toContain(
      "Difficulty: above High. 18200 XP against budgets of Low 200, Moderate 300, High 400.",
    );
    expect(tableRows(r)[0]).toEqual([
      "monster",
      "CR",
      "count",
      "XP each",
      "XP total",
      "Multiattack",
      "legendary",
      "lair",
    ]);
    expect(rowOf(r, "Goblin Warrior")).toEqual([
      "Goblin Warrior",
      "1/4",
      "4",
      "50",
      "200",
      "no",
      "no",
      "no",
    ]);
    expect(rowOf(r, "Adult Red Dragon")).toEqual([
      "Adult Red Dragon",
      "17",
      "1",
      "18000",
      "18000",
      "yes",
      "yes",
      "yes",
    ]);
    expect(lines(r)).toContain("Monsters: 5 for 4 characters.");
    expect(lines(r)).toContain("HP: 286 current, 296 max; 1 at 0 HP.");
    expect(text(r)).not.toMatch(/deadly/i);

    const expected = assessDifficulty(
      { tables: ctx.difficultyTables, monsters: ctx.monsters },
      { instances, party: { size: 4, level: 1 }, inLair: false },
    );
    expect(expected.band).toBe("above-high");
    expect(r.structuredContent).toEqual({
      ...expected,
      encounter: directory.getCurrentEncounter()?.name,
      summary: text(r),
    });

    const crowded = await ok("assess_difficulty", {
      with: [{ monster: GOBLIN_WARRIOR, count: 5 }],
    });

    expect(lines(crowded)).toContain(
      "Monsters: 10 for 4 characters, more than two per character.",
    );
    expect(rowOf(crowded, "Goblin Warrior")?.[2]).toBe("4 (+5 hypothetical)");
    expect(text(crowded)).not.toMatch(/deadly/i);
  });
});

describe("set_party", () => {
  it("set_party with size 4 and level 1 stores them and replies that no party was set before", async () => {
    const r = await ok("set_party", { size: 4, level: 1 });

    expect(text(r)).toBe("Party: 4 characters, level 1 (was: none set).");
    expect(r.structuredContent).toMatchObject({
      before: null,
      after: { size: 4, level: 1 },
    });
    expect(partyStore.get()).toEqual({ size: 4, level: 1 });
    expect(directory.listEncounters()).toEqual([]);
  });

  it("set_party with only level 3 keeps the stored size and replies with the previous and new values", async () => {
    partyStore.set({ size: 4, level: 1 });

    const r = await ok("set_party", { level: 3 });

    expect(text(r)).toBe(
      "Party: 4 characters, level 3 (was: 4 characters, level 1).",
    );
    expect(r.structuredContent).toMatchObject({
      before: { size: 4, level: 1 },
      after: { size: 4, level: 3 },
    });
    expect(partyStore.get()).toEqual({ size: 4, level: 3 });
  });

  it("undo right after set_party says set_party is not covered and changes nothing", async () => {
    await addGoblins(2);
    await ok("set_party", { size: 4, level: 1 });
    const before = currentInstances();

    const r = await ok("undo");

    expect(text(r)).toContain(
      "The last change was set_party, which undo does not cover; nothing was changed.",
    );
    expect(currentInstances()).toEqual(before);
    expect(partyStore.get()).toEqual({ size: 4, level: 1 });
  });
});

describe("assess_difficulty reply lines", () => {
  it('assess_difficulty names a monster it cannot count in a "Not counted in XP" line', async () => {
    partyStore.set({ size: 4, level: 1 });
    const crypt = directory.createEncounter("Crypt");
    directory.setCurrentEncounter(crypt.id);
    directory.repositoryFor(crypt.id).addInstances(
      () => [
        makeTestInstance({
          monsterKey: "homebrew_ghost",
          displayName: "Ghost 1",
          maxHp: 5,
        }),
      ],
      { source: "table", commandId: "seed" },
    );

    const r = await ok("assess_difficulty");

    expect(lines(r)).toContain(
      'Not counted in XP: unknown monster "homebrew_ghost" (Ghost 1).',
    );
    expect(lines(r)).toContain("No monsters counted in XP.");
    expect(assessment(r).totals.monsterCount).toBe(1);
  });

  it('assess_difficulty names a monster whose CR has no row in the XP table in a "Not counted in XP" line', async () => {
    partyStore.set({ size: 4, level: 1 });
    ctx = {
      ...ctx,
      monsters: makeTestMonsterIndex([
        makeTestMonster({ key: "homebrew_dust", name: "Dust Mote", cr: 0.375 }),
      ]),
    };
    const crypt = directory.createEncounter("Crypt");
    directory.setCurrentEncounter(crypt.id);
    directory.repositoryFor(crypt.id).addInstances(
      () => [
        makeTestInstance({
          monsterKey: "homebrew_dust",
          displayName: "Dust Mote 1",
          maxHp: 2,
        }),
      ],
      { source: "table", commandId: "seed" },
    );

    const r = await ok("assess_difficulty");

    expect(lines(r)).toContain(
      "Not counted in XP: Dust Mote (CR 0.375) has no row in the XP table.",
    );
  });

  it('assess_difficulty for a party of one with an empty encounter replies "No monsters." and counts one character', async () => {
    partyStore.set({ size: 1, level: 1 });
    const crypt = directory.createEncounter("Crypt");
    directory.setCurrentEncounter(crypt.id);

    const r = await ok("assess_difficulty");

    expect(lines(r)).toContain("Party: 1 character, level 1.");
    expect(lines(r)).toContain("No monsters.");
    expect(lines(r)).toContain("Monsters: 0 for 1 character.");
  });

  it("assess_difficulty with an override and no party stored says none is stored", async () => {
    await addGoblins(4);

    const r = await ok("assess_difficulty", { partySize: 4, partyLevel: 1 });

    expect(lines(r)).toContain(
      "Party: 4 characters, level 1, for this call only (none stored).",
    );
    expect(partyStore.get()).toBeNull();
  });
});
