import {
  checkMonster,
  createMonsterIndex,
  type Monster,
} from "@ttrpg-agents/engine";
import { makeTestSetupPorts } from "@ttrpg-agents/engine/testing";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteCreatureRepository,
  SqliteEncounterDirectory,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { formatCreatureCheck } from "./creature-reply.js";
import { tools, type ToolResult } from "./tools.js";

const GOBLIN_WARRIOR = "srd-2024_goblin-warrior";

let ctx: ToolContext;
let directory: SqliteEncounterDirectory;
let creatures: SqliteCreatureRepository;

beforeEach(() => {
  let tick = 1000;
  let commands = 0;
  // One database, as in production: the directory and the creature store share it.
  const db = openDatabase(":memory:");
  directory = new SqliteEncounterDirectory(db, { now: () => tick++ });
  creatures = new SqliteCreatureRepository(db);
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

function stored(key: string): Monster | undefined {
  return creatures.getRecord(key)?.data as Monster | undefined;
}

/** An invented spellcasting entry; DC 9 is what the Goblin Warrior's Wisdom gives. */
const spellcasting = {
  name: "Spellcasting",
  desc: "The goblin casts one of the following spells, using Wisdom as the spellcasting ability (spell save DC 9): At will: Light",
};

describe("create_creature", () => {
  it('create_creature from srd-2024_goblin-warrior into homebrew as Goblin Shaman with hp dice "20" and an added Spellcasting entry stores homebrew_goblin-shaman with HP 20, and add_monsters adds it in the same session', async () => {
    await ok("create_creature", {
      book: "homebrew",
      from: GOBLIN_WARRIOR,
      changes: {
        name: "Goblin Shaman",
        hp: { dice: "20" },
        sections: { actions: { add: [spellcasting] } },
      },
    });

    const shaman = stored("homebrew_goblin-shaman");
    expect(shaman?.key).toBe("homebrew_goblin-shaman");
    expect(shaman?.name).toBe("Goblin Shaman");
    expect(shaman?.hp).toEqual({ average: 20, dice: "20" });
    expect(shaman?.sections.actions.map((e) => e.name)).toContain(
      "Spellcasting",
    );

    await ok("add_monsters", {
      groups: [{ monster: "homebrew_goblin-shaman", count: 1 }],
    });
    const current = directory.getCurrentEncounter();
    const instances = current
      ? directory.repositoryFor(current.id).listInstances()
      : [];
    expect(
      instances.map((i) => ({ monsterKey: i.monsterKey, maxHp: i.maxHp })),
    ).toEqual([{ monsterKey: "homebrew_goblin-shaman", maxHp: 20 }]);
  });

  it("create_creature's reply says what it created and from what, then its rolls, text-only entries and findings, and its structured content carries key, monster, rolls and findings", async () => {
    const r = await ok("create_creature", {
      book: "homebrew",
      page: 7,
      from: GOBLIN_WARRIOR,
      changes: { name: "Goblin Shaman" },
    });

    const monster = stored("homebrew_goblin-shaman");
    if (!monster) throw new Error("not stored");
    const check = checkMonster(monster);
    expect(text(r)).toBe(
      `Created Goblin Shaman (homebrew_goblin-shaman) in homebrew, page 7, from Goblin Warrior (${GOBLIN_WARRIOR}).\n\n${formatCreatureCheck(check)}`,
    );
    expect(text(r)).toContain("Text only: Nimble Escape (bonus action)");
    expect(r.structuredContent).toMatchObject({
      key: "homebrew_goblin-shaman",
      monster,
      rolls: check.entries.filter((e) => e.rolls),
      findings: check.findings,
    });
  });

  it("create_creature with a wrong damage average stores the creature and replies with a damage_average finding giving the expected average and naming edit_creature", async () => {
    const r = await ok("create_creature", {
      book: "homebrew",
      from: GOBLIN_WARRIOR,
      changes: {
        name: "Goblin Brute",
        sections: {
          actions: {
            replace: [
              {
                name: "Scimitar",
                desc: "Melee Attack Roll: +4, reach 5 ft. 9 (1d6 + 2) Slashing damage.",
              },
            ],
          },
        },
      },
    });

    expect(stored("homebrew_goblin-brute")).toBeDefined();
    expect(text(r)).toContain(
      "- Scimitar (action): damage average 9 for 1d6 + 2; expected 5",
    );
    expect(text(r)).toContain("edit_creature");
    expect(r.structuredContent?.["findings"]).toContainEqual(
      expect.objectContaining({
        code: "damage_average",
        found: 9,
        expected: [5],
      }),
    );
  });

  it("create_creature from scratch without abilities replies isError naming abilities and stores nothing", async () => {
    const r = await call("create_creature", {
      book: "homebrew",
      changes: {
        name: "Bog Mossling",
        size: "small",
        type: "plant",
        alignment: "neutral",
        ac: 12,
        hp: { dice: "2d6" },
        speeds: { walk: 20 },
        saves: { str: -1, dex: 1, con: 0, int: -4, wis: 0, cha: -3 },
        initiativeModifier: 1,
        cr: 0.25,
        languages: "",
      },
    });

    expect(r.isError).toBe(true);
    expect(text(r)).toContain("abilities");
    expect(creatures.listRecords()).toEqual([]);
  });

  it("undo right after create_creature says create_creature is not covered and changes nothing", async () => {
    await ok("add_monsters", {
      groups: [{ monster: "srd-2024_wolf", count: 1 }],
    });
    await ok("create_creature", {
      book: "homebrew",
      from: GOBLIN_WARRIOR,
      changes: { name: "Goblin Shaman" },
    });
    const current = directory.getCurrentEncounter();
    if (!current) throw new Error("no current encounter");
    const before = directory.repositoryFor(current.id).listInstances();

    const r = await ok("undo");

    expect(text(r)).toContain(
      "The last change was create_creature, which undo does not cover; nothing was changed.",
    );
    expect(directory.repositoryFor(current.id).listInstances()).toEqual(before);
    expect(stored("homebrew_goblin-shaman")).toBeDefined();
  });

  it("create_creature with no encounter in the store creates none", async () => {
    await ok("create_creature", {
      book: "homebrew",
      from: GOBLIN_WARRIOR,
      changes: { name: "Goblin Shaman" },
    });

    expect(directory.listEncounters()).toEqual([]);
    expect(directory.getCurrentEncounter()).toBeUndefined();
  });
});

describe("get_statblock of a created creature", () => {
  it("get_statblock of a created creature shows its book and page under the header", async () => {
    await ok("create_creature", {
      book: "homebrew",
      page: 7,
      from: GOBLIN_WARRIOR,
      changes: { name: "Goblin Shaman" },
    });

    const lines = text(
      await ok("get_statblock", { key: "homebrew_goblin-shaman" }),
    ).split("\n");

    const header = lines.indexOf("## Goblin Shaman (homebrew_goblin-shaman)");
    expect(header).toBeGreaterThanOrEqual(0);
    expect(lines[header + 1]).toBe("Source: homebrew, page 7");
  });
});

/** Stores Goblin Shaman (homebrew_goblin-shaman), copied from the Goblin Warrior. */
async function createShaman(page?: number): Promise<void> {
  await ok("create_creature", {
    book: "homebrew",
    ...(page === undefined ? {} : { page }),
    from: GOBLIN_WARRIOR,
    changes: { name: "Goblin Shaman" },
  });
}

/** Adds `count` Goblin Shamans to a new encounter named Ambush, then makes the encounter that was current before current again. */
async function shamansInAmbush(count: number): Promise<void> {
  const before = directory.getCurrentEncounter();
  directory.createEncounter("Ambush");
  await ok("add_monsters", {
    encounter: "Ambush",
    groups: [{ monster: "homebrew_goblin-shaman", count }],
  });
  if (before) directory.setCurrentEncounter(before.id);
}

describe("edit_creature", () => {
  it("edit_creature changing a stored creature's AC changes get_statblock, and its reply says how many monsters in encounters keep their old AC, naming each with its encounter, while their list_encounter rows stay unchanged", async () => {
    await createShaman();
    await shamansInAmbush(2);
    const rowsBefore = text(
      await ok("list_encounter", { encounter: "Ambush" }),
    );
    const acBefore = stored("homebrew_goblin-shaman")?.ac;

    const r = await ok("edit_creature", {
      key: "homebrew_goblin-shaman",
      changes: { ac: 17 },
    });

    expect(acBefore).not.toBe(17);
    expect(stored("homebrew_goblin-shaman")?.ac).toBe(17);
    expect(
      text(await ok("get_statblock", { key: "homebrew_goblin-shaman" })),
    ).toContain("- **AC** 17");
    expect(text(r)).toContain("2 monsters in encounters keep");
    expect(text(r)).toContain(
      "Goblin Shaman 1 (Ambush), Goblin Shaman 2 (Ambush)",
    );
    expect(text(await ok("list_encounter", { encounter: "Ambush" }))).toBe(
      rowsBefore,
    );
  });

  it("edit_creature's reply says what it edited and in which book, a rename, then its rolls, text-only entries and findings, and its structured content carries key, monster, rolls, findings and the live instances", async () => {
    await createShaman(7);
    await shamansInAmbush(1);
    const ambush = directory.listEncounters().find((e) => e.name === "Ambush");
    if (!ambush) throw new Error("no Ambush");
    const [instance] = directory.repositoryFor(ambush.id).listInstances();
    if (!instance) throw new Error("no instance");

    const r = await ok("edit_creature", {
      key: "homebrew_goblin-shaman",
      changes: { name: "Goblin Hexer" },
    });

    const monster = stored("homebrew_goblin-shaman");
    if (!monster) throw new Error("not stored");
    const check = checkMonster(monster);
    const reply = text(r);
    const [first] = reply.split("\n");
    expect(first).toContain("Goblin Hexer (homebrew_goblin-shaman)");
    expect(first).toContain("homebrew, page 7");
    expect(first).toContain("Goblin Shaman");
    expect(reply).toContain("Goblin Shaman 1 (Ambush)");
    expect(reply.endsWith(formatCreatureCheck(check))).toBe(true);
    expect(reply.indexOf("Goblin Shaman 1 (Ambush)")).toBeLessThan(
      reply.indexOf(formatCreatureCheck(check)),
    );
    expect(r.structuredContent).toMatchObject({
      key: "homebrew_goblin-shaman",
      monster,
      rolls: check.entries.filter((e) => e.rolls),
      findings: check.findings,
      liveInstances: [
        { id: instance.id, name: "Goblin Shaman 1", encounter: "Ambush" },
      ],
    });
  });

  it("after edit_creature renames a creature, add_monsters by its key still adds it, named after its new name", async () => {
    await createShaman();
    await ok("edit_creature", {
      key: "homebrew_goblin-shaman",
      changes: { name: "Goblin Hexer" },
    });

    await ok("add_monsters", {
      groups: [{ monster: "homebrew_goblin-shaman", count: 1 }],
    });

    const current = directory.getCurrentEncounter();
    if (!current) throw new Error("no current encounter");
    expect(
      directory
        .repositoryFor(current.id)
        .listInstances()
        .map((i) => ({ monsterKey: i.monsterKey, name: i.displayName })),
    ).toEqual([
      { monsterKey: "homebrew_goblin-shaman", name: "Goblin Hexer 1" },
    ]);
  });
});

describe("remove_creature", () => {
  it("remove_creature of a creature with a live monster in another encounter replies isError naming the monster and its encounter; after remove_monsters it succeeds, and restore_monsters then fails with the unknown-monster message", async () => {
    await createShaman();
    await ok("add_monsters", {
      groups: [{ monster: "srd-2024_wolf", count: 1 }],
    });
    await shamansInAmbush(1);

    const refused = await call("remove_creature", {
      key: "homebrew_goblin-shaman",
    });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("Goblin Shaman 1");
    expect(text(refused)).toContain("Ambush");
    expect(stored("homebrew_goblin-shaman")).toBeDefined();

    await ok("remove_monsters", {
      encounter: "Ambush",
      targets: ["Goblin Shaman 1"],
    });
    const removed = await ok("remove_creature", {
      key: "homebrew_goblin-shaman",
    });
    expect(removed.structuredContent).toEqual({
      key: "homebrew_goblin-shaman",
      summary: text(removed),
    });
    expect(stored("homebrew_goblin-shaman")).toBeUndefined();

    const restore = await call("restore_monsters", {
      encounter: "Ambush",
      targets: ["Goblin Shaman 1"],
    });
    expect(restore.isError).toBe(true);
    expect(text(restore)).toContain(
      "monster type homebrew_goblin-shaman is not in the monster index",
    );
  });

  it("remove_creature of a stored row that fails the schema removes it by key and replies with the key", async () => {
    // The store writes what it is given; this row fails monsterSchema.
    creatures.insert("homebrew_broken", {
      name: "Broken",
    } as unknown as Monster);

    const removed = await ok("remove_creature", { key: "homebrew_broken" });

    expect(text(removed)).toBe("Removed homebrew_broken.");
    expect(removed.structuredContent).toEqual({
      key: "homebrew_broken",
      summary: text(removed),
    });
    expect(creatures.getRecord("homebrew_broken")).toBeUndefined();
  });
});

describe("list_creatures", () => {
  it("list_creatures replies a table of the stored creatures' key, name, book, page and CR, only the given book's with book, and structured content with each", async () => {
    await ok("create_creature", {
      book: "homebrew",
      page: 7,
      from: GOBLIN_WARRIOR,
      changes: { name: "Goblin Shaman", cr: 2 },
    });
    await ok("create_creature", {
      book: "my-campaign",
      from: GOBLIN_WARRIOR,
      changes: { name: "Goblin Hexer", cr: 0.5 },
    });
    const shamanRow =
      "| homebrew_goblin-shaman | Goblin Shaman | homebrew | 7 | 2 |";
    const hexerRow =
      "| my-campaign_goblin-hexer | Goblin Hexer | my-campaign | - | 0.5 |";
    const shaman = {
      key: "homebrew_goblin-shaman",
      name: "Goblin Shaman",
      source: { book: "homebrew", page: 7 },
      cr: 2,
    };
    const hexer = {
      key: "my-campaign_goblin-hexer",
      name: "Goblin Hexer",
      source: { book: "my-campaign" },
      cr: 0.5,
    };

    const all = await ok("list_creatures");
    const allLines = text(all).split("\n");
    expect(allLines).toContain("| key | name | book | page | CR |");
    expect(allLines).toContain(shamanRow);
    expect(allLines).toContain(hexerRow);
    expect(allLines.indexOf(shamanRow)).toBeLessThan(
      allLines.indexOf(hexerRow),
    );
    expect(text(all)).not.toContain(GOBLIN_WARRIOR);
    expect(all.structuredContent).toEqual({
      creatures: [shaman, hexer],
      summary: text(all),
    });

    const filtered = await ok("list_creatures", { book: "my-campaign" });
    expect(text(filtered).split("\n")).toContain(hexerRow);
    expect(text(filtered)).not.toContain("homebrew_goblin-shaman");
    expect(filtered.structuredContent).toEqual({
      creatures: [hexer],
      summary: text(filtered),
    });
  });

  it("list_creatures with no stored creatures, or none in the given book, says so", async () => {
    const none = await ok("list_creatures");
    expect(text(none)).toContain("No stored creatures");
    expect(none.structuredContent).toEqual({
      creatures: [],
      summary: text(none),
    });

    await createShaman();
    const noneInBook = await ok("list_creatures", { book: "my-campaign" });
    expect(text(noneInBook)).toContain("No stored creatures");
    expect(text(noneInBook)).toContain("my-campaign");
    expect(noneInBook.structuredContent).toEqual({
      creatures: [],
      summary: text(noneInBook),
    });
  });
});
