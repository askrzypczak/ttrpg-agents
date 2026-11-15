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
