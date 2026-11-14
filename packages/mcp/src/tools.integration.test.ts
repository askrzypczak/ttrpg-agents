import {
  TableUnavailableError,
  applyInstanceEdit,
  getSetupStatus,
  type EncounterDirectory,
  type EncounterRepository,
  type MonsterInstance,
  type NewMonsterInstance,
  type Rng,
  type TablePort,
  type TableSceneStatus,
  type ChangeOrigin,
  resolveEncounter,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterDirectory,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolContext } from "./context.js";
import { formatSetupStatus } from "./setup-status.js";
import { tools, type ToolResult } from "./tools.js";
import { makeTestSetupPorts } from "@ttrpg-agents/engine/testing";

const origin: ChangeOrigin = { source: "mcp", commandId: "test" };

const monsters = loadSrdMonsters();
const SHADOW = "srd-2024_shadow";

/** Test-only Rng: yields the given values in order, cycling, each reduced mod max. */
function cycleRng(...values: number[]): Rng {
  let i = 0;
  return {
    nextInt(max) {
      const value = values[i++ % values.length] ?? 0;
      return value % max;
    },
  };
}

let ctx: ToolContext;
let tick: number;
let groupN: number;

beforeEach(() => {
  tick = 1000;
  groupN = 0;
  ctx = {
    table: {
      sceneStatus: () =>
        Promise.reject(new Error("table not stubbed in this test")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    encounters: new SqliteEncounterDirectory(openDatabase(":memory:"), {
      now: () => tick++,
    }),
    monsters,
    rng: cycleRng(0, 3, 5, 7),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${++groupN}`,
    browser: { showPage: () => Promise.reject(new Error("not stubbed")) },
    setup: makeTestSetupPorts(),
    newCommandId: () => "command",
  };
  // A scene bound to the encounter is open, so replies name no encounter.
  ctx.encounters.setOpenScene("scene-1");
  resolveEncounter(ctx.encounters, { writes: true });
});

async function call(name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(ctx, args);
}

/** A table port stub that answers every call with `status`. */
function tableAnswering(status: TableSceneStatus): TablePort {
  return {
    sceneStatus: () => Promise.resolve(status),
    sceneMap: () => Promise.reject(new Error("not stubbed")),
    sceneTokens: () => Promise.reject(new Error("not stubbed")),
    mapImage: () => Promise.reject(new Error("not stubbed")),
  };
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function seed(...items: NewMonsterInstance[]): void {
  repoOf(ctx).addInstances(() => items, origin);
}

/** Delegates to `inner`, with some methods replaced. */
function wrapRepo(
  inner: EncounterRepository,
  over: Partial<EncounterRepository>,
): EncounterRepository {
  return {
    addInstances: (build) => inner.addInstances(build, origin),
    applyDamage: (id, amount) => inner.applyDamage(id, amount, origin),
    applyHealing: (id, amount) => inner.applyHealing(id, amount, origin),
    removeInstances: (ids) => inner.removeInstances(ids, origin),
    listRemovedInstances: () => inner.listRemovedInstances(),
    listRestoreSeqs: () => inner.listRestoreSeqs(),
    restoreInstances: (ids, name) => inner.restoreInstances(ids, name, origin),
    renameInstance: (id, name) => inner.renameInstance(id, name, origin),
    setInitiative: (id, n) => inner.setInitiative(id, n, origin),
    setGroupId: (id, groupId) => inner.setGroupId(id, groupId, origin),
    setHp: (id, hp) => inner.setHp(id, hp, origin),
    setMaxHp: (id, maxHp) => inner.setMaxHp(id, maxHp, origin),
    setArmorClass: (id, ac) => inner.setArmorClass(id, ac, origin),
    setStatsVisible: (id, visible) =>
      inner.setStatsVisible(id, visible, origin),
    setSpawnPositions: (positions) =>
      inner.setSpawnPositions(positions, origin),
    changeMonsters: (changes) => inner.changeMonsters(changes, origin),
    clearEncounter: () => inner.clearEncounter(origin),
    listInstances: () => inner.listInstances(),
    noteCommand: () => inner.noteCommand(origin),
    transaction: (fn) => inner.transaction(fn),
    latestUndoRecord: () => inner.latestUndoRecord(),
    forgetCommands: (ids) => inner.forgetCommands(ids),
    ...over,
  };
}

/** listInstances keeps returning `snapshot`; writes go to the real store. */
function staleRepo(
  inner: EncounterRepository,
  snapshot: MonsterInstance[],
): EncounterRepository {
  return wrapRepo(inner, {
    listInstances: () => snapshot.map((i) => ({ ...i })),
  });
}

function item(
  displayName: string,
  initiative: number | null,
  maxHp = 10,
): NewMonsterInstance {
  return { monsterKey: SHADOW, displayName, maxHp, initiative };
}

function names(): string[] {
  return repoOf(ctx)
    .listInstances()
    .map((i) => i.displayName);
}

/** Delegates to `inner` but hands out `repo` as every encounter's repository. */
function handingOut(
  inner: EncounterDirectory,
  repo: EncounterRepository,
): EncounterDirectory {
  return {
    listEncounters: () => inner.listEncounters(),
    createEncounter: (name) => inner.createEncounter(name),
    getCurrentEncounter: () => inner.getCurrentEncounter(),
    setCurrentEncounter: (id) => inner.setCurrentEncounter(id),
    findEncounterOfInstance: (id) => inner.findEncounterOfInstance(id),
    repositoryFor: () => repo,
    mapRepositoryFor: (id) => inner.mapRepositoryFor(id),
    getOpenScene: () => inner.getOpenScene(),
    setOpenScene: (sceneId) => inner.setOpenScene(sceneId),
    bindScene: (sceneId, encounterId) => inner.bindScene(sceneId, encounterId),
    setEncounterName: (encounterId, name) =>
      inner.setEncounterName(encounterId, name),
    findSceneOfEncounter: (encounterId) =>
      inner.findSceneOfEncounter(encounterId),
    transaction: (fn) => inner.transaction(fn),
  };
}

/** The current encounter's repository (created when there is none), resolved as a tool call does. */
function repoOf(context: ToolContext): EncounterRepository {
  return context.encounters.repositoryFor(
    resolveEncounter(context.encounters, { writes: true }).encounter.id,
  );
}

describe("tool registry", () => {
  it("exposes the thirty-six tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_monsters",
      "apply_damage",
      "change_monster_type",
      "clear_encounter",
      "get_map_image",
      "get_statblock",
      "heal",
      "list_encounter",
      "list_encounters",
      "list_rooms",
      "merge_initiative",
      "move_monsters",
      "open_statblock",
      "preview_monsters",
      "propose_rooms",
      "remove_monsters",
      "remove_rooms",
      "rename_encounter",
      "rename_monster",
      "reset_max_hp",
      "restore_encounter",
      "restore_monsters",
      "roll_initiative",
      "search_monsters",
      "set_armor_class",
      "set_hp",
      "set_initiative",
      "set_max_hp",
      "set_rooms",
      "set_stats_visibility",
      "setup_status",
      "split_initiative",
      "table_status",
      "undo",
      "use_encounter",
      "use_map",
    ]);
  });
});

describe("search_monsters", () => {
  it("ranks the exact name first and returns at most 10", async () => {
    const r = await call("search_monsters", { query: "shadow" });
    expect(r.isError).toBeUndefined();
    const results = r.structuredContent?.["results"] as { key: string }[];
    expect(results[0]?.key).toBe(SHADOW);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(text(r)).toContain(SHADOW);

    const many = await call("search_monsters", { query: "a" });
    expect((many.structuredContent?.["results"] as unknown[]).length).toBe(10);
  });

  it("reports no matches without erroring", async () => {
    const r = await call("search_monsters", { query: "zzzzqqqq" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent?.["results"]).toEqual([]);
    expect(text(r)).toContain("No monsters match");
  });

  it('search_monsters finds Tough for "thug" and "thugs" and names the rename in its summary and results', async () => {
    for (const query of ["thug", "thugs"]) {
      const r = await call("search_monsters", { query });
      expect(r.isError).toBeUndefined();
      const results = r.structuredContent?.["results"] as Record<
        string,
        unknown
      >[];
      expect(results[0]).toMatchObject({
        key: "srd-2024_tough",
        name: "Tough",
        source: "srd-5.2",
        alias: "Thug",
      });
      const lines = text(r).split("\n");
      expect(lines[0]).toBe("Thug is now Tough (srd-5.2).");
      expect(text(r)).toContain("srd-2024_tough");
      expect(r.structuredContent?.["summary"]).toBe(text(r));
    }
    // A plain name match carries no rename.
    const shadow = await call("search_monsters", { query: "shadow" });
    const shadowResults = shadow.structuredContent?.["results"] as Record<
      string,
      unknown
    >[];
    expect(shadowResults[0]).not.toHaveProperty("alias");
    expect(text(shadow)).not.toContain(" is now ");
  });
});

describe("get_statblock", () => {
  it("formats a known monster", async () => {
    const r = await call("get_statblock", { key: SHADOW });
    const monster = monsters.byKey.get(SHADOW);
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("## Shadow");
    expect(text(r)).toContain(`**AC** ${String(monster?.ac)}`);
    expect(text(r)).toContain(`**HP** ${String(monster?.hp.average)}`);
    expect(text(r)).toContain("### Actions");
  });

  it("formats CR, senses, resistances and immunities", async () => {
    const out = text(await call("get_statblock", { key: SHADOW }));
    expect(out).toContain("**CR** 1/2");
    expect(out).toContain("darkvision 60 ft.");
    expect(out).toContain("passive Perception 10");
    expect(out).toContain("**Damage Resistances** Acid, Cold");
    expect(out).toContain("**Damage Immunities** Necrotic, Poison");
    expect(out).toContain("**Condition Immunities** Exhaustion");
  });

  it("returns an error result for an unknown key", async () => {
    const r = await call("get_statblock", { key: "nope" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Unknown monster "nope"');
  });
});

describe("open_statblock", () => {
  const ABOLETH = "srd-2024_aboleth";
  const ABOLETH_URL = "https://www.dndbeyond.com/monsters/5194867-aboleth";
  let shown: string[];

  /** A browser that records each page it is asked to show. */
  function recordingBrowser(outcome: () => Promise<void>): void {
    shown = [];
    ctx.browser = {
      showPage: (url) => {
        shown.push(url);
        return outcome();
      },
    };
  }

  beforeEach(() => {
    recordingBrowser(() => Promise.resolve());
  });

  it("open_statblock shows the monster's D&D Beyond page through the browser port and replies with its URL", async () => {
    const r = await call("open_statblock", { key: ABOLETH });
    const reply = `Opened the D&D Beyond page for Aboleth: ${ABOLETH_URL}`;
    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(reply);
    expect(shown).toEqual([ABOLETH_URL]);
    expect(r.structuredContent).toEqual({
      key: ABOLETH,
      url: ABOLETH_URL,
      opened: true,
      summary: reply,
    });
  });

  it("open_statblock still replies with the URL when the browser cannot be opened", async () => {
    recordingBrowser(() =>
      Promise.reject(new Error("no browser opener for linux")),
    );
    const r = await call("open_statblock", { key: ABOLETH });
    const reply = `Could not open a browser (no browser opener for linux). D&D Beyond page for Aboleth: ${ABOLETH_URL}`;
    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(reply);
    expect(shown).toEqual([ABOLETH_URL]);
    expect(r.structuredContent).toEqual({
      key: ABOLETH,
      url: ABOLETH_URL,
      opened: false,
      summary: reply,
    });
  });

  it("open_statblock fails with get_statblock's error for an unknown key and opens nothing", async () => {
    const statblock = await call("get_statblock", { key: "nope" });
    const r = await call("open_statblock", { key: "nope" });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe(text(statblock));
    expect(text(r)).toBe(
      'Unknown monster "nope". Use search_monsters to find keys.',
    );
    expect(shown).toEqual([]);
  });

  it("open_statblock opens nothing for a monster without a D&D Beyond page and says so", async () => {
    const key = "srd-2024_giant-fly";
    const r = await call("open_statblock", { key });
    const reply =
      "Giant Fly has no D&D Beyond 2024 page. Use get_statblock for its statblock.";
    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(reply);
    expect(shown).toEqual([]);
    expect(r.structuredContent).toEqual({
      key,
      url: null,
      opened: false,
      summary: reply,
    });
  });

  it("open_statblock opens nothing for a hostile-looking key", async () => {
    for (const key of [
      "https://evil.example/",
      "srd-2024_aboleth; open -a Calculator",
      "../../etc/passwd",
    ]) {
      const r = await call("open_statblock", { key });
      expect(r.isError, key).toBe(true);
      expect(text(r), key).toBe(
        `Unknown monster "${key}". Use search_monsters to find keys.`,
      );
    }
    expect(shown).toEqual([]);
  });
});

describe("add_monsters", () => {
  it("adds several groups in one call with a table and roll log", async () => {
    const r = await call("add_monsters", {
      groups: [
        { monster: SHADOW, count: 3 },
        { monster: "srd-2024_goblin-warrior", count: 2, hp: "average" },
      ],
    });
    expect(r.isError).toBeUndefined();
    const added = r.structuredContent?.["instances"] as { name: string }[];
    expect(added.map((i) => i.name)).toEqual([
      "Shadow 1",
      "Shadow 2",
      "Shadow 3",
      "Goblin Warrior 1",
      "Goblin Warrior 2",
    ]);
    expect(names()).toHaveLength(5);
    expect(text(r)).toContain("| Shadow 1 |");
    expect(text(r)).toContain("Shadow 1 HP");
    expect(text(r)).toContain("Shadow initiative (group)");
  });

  it("add_monsters takes group ids from the context id source", async () => {
    const r = await call("add_monsters", {
      groups: [
        { monster: SHADOW, count: 2 },
        { monster: "srd-2024_goblin-warrior", count: 1, hp: "average" },
      ],
    });
    expect(r.isError).toBeUndefined();
    const added = r.structuredContent?.["instances"] as { groupId: string }[];
    expect(added.map((i) => i.groupId)).toEqual([
      "group-1",
      "group-1",
      "group-2",
    ]);
  });

  it("lists each roll under Rolls: with its label, expression and total", async () => {
    ctx.rng = cycleRng(0); // every die shows 1
    const r = await call("add_monsters", {
      groups: [{ monster: SHADOW, count: 1 }],
    });
    expect(text(r)).toContain(
      "Rolls:\n- Shadow 1 HP: 5d8 + 5 = 10\n- Shadow initiative (group): 1d20 = 1",
    );
  });

  it("supports per-monster initiative", async () => {
    const r = await call("add_monsters", {
      groups: [{ monster: SHADOW, count: 2 }],
      initiative: "each",
    });
    const rolls = r.structuredContent?.["rolls"] as { label?: string }[];
    expect(rolls.map((x) => x.label)).toContain("Shadow 2 initiative");
  });

  it("returns an error result for an unknown monster and stores nothing", async () => {
    const r = await call("add_monsters", {
      groups: [{ monster: "nope", count: 1 }],
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('unknown monster "nope"');
    expect(names()).toEqual([]);
  });

  it("returns an error result for a bad count", async () => {
    const r = await call("add_monsters", {
      groups: [{ monster: SHADOW, count: 0 }],
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Invalid arguments");
    expect(names()).toEqual([]);
  });

  it("add_monsters creates a group revealed when statsVisible is true", async () => {
    const r = await call("add_monsters", {
      groups: [
        { monster: SHADOW, count: 2, statsVisible: true },
        { monster: "srd-2024_goblin-warrior", count: 1 },
      ],
    });
    expect(r.isError).toBeUndefined();
    expect(
      repoOf(ctx)
        .listInstances()
        .map((i) => [i.displayName, i.statsVisible]),
    ).toEqual([
      ["Shadow 1", true],
      ["Shadow 2", true],
      ["Goblin Warrior 1", false],
    ]);
  });

  it("returns an error result for malformed arguments", async () => {
    const r = await call("add_monsters", { groups: "shadow" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Invalid arguments");
  });
});

describe("list_encounter", () => {
  it("says so when empty", async () => {
    expect(text(await call("list_encounter"))).toContain("empty");
  });

  it("orders by initiative desc, nulls last, ties by creation", async () => {
    seed(
      item("Low", 3),
      item("None", null),
      item("High", 18),
      item("TieA", 10),
      item("TieB", 10),
    );
    const r = await call("list_encounter");
    const order = (
      r.structuredContent?.["instances"] as { name: string }[]
    ).map((i) => i.name);
    expect(order).toEqual(["High", "TieA", "TieB", "Low", "None"]);
    expect(text(r)).toContain("10/10");
  });

  it("list_encounter shows each monster's armor class in an AC column and in its structured instances, including one set by set_armor_class and one edited at the table", async () => {
    seed(
      { ...item("Shadow 1", 15), armorClass: 12 },
      { ...item("Shadow 2", 8), armorClass: 12 },
    );
    const [first, second] = repoOf(ctx).listInstances();
    const firstId = first?.id ?? "";
    const secondId = second?.id ?? "";
    const set = await call("set_armor_class", {
      target: firstId,
      armorClass: 15,
    });
    expect(set.isError).toBeUndefined();
    applyInstanceEdit(
      repoOf(ctx),
      { instanceId: secondId, armorClass: 17 },
      { source: "table", commandId: "table-edit" },
    );

    const r = await call("list_encounter");

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "| id | name | AC | HP | initiative |",
        "| --- | --- | --- | --- | --- |",
        `| ${firstId} | Shadow 1 | 15 | 10/10 | 15 |`,
        `| ${secondId} | Shadow 2 | 17 | 10/10 | 8 |`,
      ].join("\n"),
    );
    expect(r.structuredContent?.["instances"]).toEqual([
      {
        id: firstId,
        name: "Shadow 1",
        monsterKey: SHADOW,
        hp: 10,
        maxHp: 10,
        initiative: 15,
        armorClass: 15,
      },
      {
        id: secondId,
        name: "Shadow 2",
        monsterKey: SHADOW,
        hp: 10,
        maxHp: 10,
        initiative: 8,
        armorClass: 17,
      },
    ]);
  });

  it("list_encounter shows - in the AC column and armorClass null for a monster without an armor class", async () => {
    seed(item("Shadow 1", 5));
    const id = repoOf(ctx).listInstances()[0]?.id ?? "";

    const r = await call("list_encounter");

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "| id | name | AC | HP | initiative |",
        "| --- | --- | --- | --- | --- |",
        `| ${id} | Shadow 1 | - | 10/10 | 5 |`,
      ].join("\n"),
    );
    const instances = r.structuredContent?.["instances"] as {
      armorClass: unknown;
    }[];
    expect(instances[0]?.armorClass).toBeNull();
  });
});

describe("apply_damage and heal", () => {
  it("damages by id, then heals by name, with clamping", async () => {
    seed(item("Shadow 1", 5, 10));
    const id = repoOf(ctx).listInstances()[0]?.id ?? "";

    const hit = await call("apply_damage", { target: id, amount: 4 });
    expect(hit.isError).toBeUndefined();
    expect(text(hit)).toContain("10 -> 6/10");

    const overkill = await call("apply_damage", { target: id, amount: 99 });
    expect(text(overkill)).toContain("6 -> 0/10");

    const healed = await call("heal", { target: "Shadow 1", amount: 3 });
    expect(text(healed)).toContain("0 -> 3/10");

    const overheal = await call("heal", { target: "Shadow 1", amount: 99 });
    expect(text(overheal)).toContain("3 -> 10/10");
    expect(repoOf(ctx).listInstances()[0]?.currentHp).toBe(10);
  });

  it("errors on unknown or ambiguous targets", async () => {
    seed(item("Twin", 1), item("Twin", 2));
    const unknown = await call("apply_damage", { target: "Nobody", amount: 1 });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('Unknown target "Nobody"');

    const ambiguous = await call("heal", { target: "Twin", amount: 1 });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toContain("Ambiguous");

    const id = repoOf(ctx).listInstances()[0]?.id ?? "";
    expect(
      (await call("apply_damage", { target: id, amount: 1 })).isError,
    ).toBeUndefined();
  });

  it("apply_damage reports the HP read inside the write, not the HP listed before it", async () => {
    seed(item("Shadow 1", 5, 10));
    const inner = repoOf(ctx);
    const snapshot = inner.listInstances();
    // Another writer changes HP after the tool listed the encounter.
    inner.applyDamage(snapshot[0]?.id ?? "", 3, origin);
    ctx.encounters = handingOut(ctx.encounters, staleRepo(inner, snapshot));

    const r = await call("apply_damage", { target: "Shadow 1", amount: 2 });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("Shadow 1: 7 -> 5/10 HP");
    expect(inner.listInstances()[0]?.currentHp).toBe(5);
  });

  it("errors on negative or fractional amounts without changing HP", async () => {
    seed(item("Shadow 1", 1));
    for (const amount of [-1, 1.5]) {
      for (const name of ["apply_damage", "heal"]) {
        const r = await call(name, { target: "Shadow 1", amount });
        expect(r.isError).toBe(true);
        expect(text(r)).toContain("Invalid arguments");
      }
    }
    expect(repoOf(ctx).listInstances()[0]?.currentHp).toBe(10);
  });
});

describe("tool errors", () => {
  it("tool handler returns isError for an unknown target, and for an instance removed between resolve and write (UnknownInstanceError)", async () => {
    seed(item("Shadow 1", 5, 10));
    const unknown = await call("apply_damage", { target: "Nobody", amount: 1 });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('Unknown target "Nobody"');

    const inner = repoOf(ctx);
    const snapshot = inner.listInstances();
    const id = snapshot[0]?.id ?? "";
    // Removed by another writer after the tool resolved the target.
    inner.clearEncounter(origin);
    ctx.encounters = handingOut(ctx.encounters, staleRepo(inner, snapshot));
    for (const name of ["apply_damage", "heal"]) {
      const r = await call(name, { target: "Shadow 1", amount: 1 });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain(`Unknown monster instance: ${id}`);
    }
  });

  it("tool handler rethrows an unexpected RangeError instead of returning isError", async () => {
    ctx.encounters = handingOut(
      ctx.encounters,
      wrapRepo(repoOf(ctx), {
        listInstances: () => {
          throw new RangeError("bug");
        },
      }),
    );
    await expect(call("list_encounter")).rejects.toThrow(RangeError);
  });
});

describe("remove_monsters", () => {
  it("removes by id and name", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const idC = repoOf(ctx).listInstances()[2]?.id ?? "";
    const r = await call("remove_monsters", { targets: ["A", idC, "A"] });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("Removed 2");
    expect(names()).toEqual(["B"]);
  });

  it("is all-or-nothing when any target fails to resolve", async () => {
    seed(item("A", 1), item("B", 2));
    const r = await call("remove_monsters", { targets: ["A", "Ghost"] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Nothing was removed");
    expect(names()).toEqual(["A", "B"]);
  });

  it("is all-or-nothing when a target is ambiguous", async () => {
    seed(item("A", 1), item("Twin", 2), item("Twin", 3));
    const r = await call("remove_monsters", { targets: ["A", "Twin"] });
    expect(r.isError).toBe(true);
    expect(names()).toEqual(["A", "Twin", "Twin"]);
  });
});

describe("remove_monsters validation", () => {
  it("rejects an empty target list", async () => {
    seed(item("A", 1));
    const r = await call("remove_monsters", { targets: [] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Invalid arguments");
    expect(names()).toEqual(["A"]);
  });
});

describe("rename_monster", () => {
  it("renames by id and by exact name, reports old and new name", async () => {
    seed(item("Shadow 1", 5), item("Shadow 2", 3));
    const id = repoOf(ctx).listInstances()[0]?.id ?? "";

    const byId = await call("rename_monster", { target: id, name: "Boss" });
    expect(byId.isError).toBeUndefined();
    expect(text(byId)).toContain("Shadow 1 renamed to Boss");
    expect(byId.structuredContent?.["instance"]).toMatchObject({
      id,
      name: "Boss",
    });

    const byName = await call("rename_monster", {
      target: "Shadow 2",
      name: "Lackey",
    });
    expect(byName.isError).toBeUndefined();
    expect(text(byName)).toContain("Shadow 2 renamed to Lackey");
    expect(names()).toEqual(["Boss", "Lackey"]);
  });

  it("reports an unknown target", async () => {
    seed(item("Shadow 1", 5));
    const r = await call("rename_monster", { target: "Nobody", name: "Boss" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Nobody");
    expect(names()).toEqual(["Shadow 1"]);
  });

  it("reports a duplicate name", async () => {
    seed(item("Shadow 1", 5), item("Shadow 2", 3));
    const r = await call("rename_monster", {
      target: "Shadow 1",
      name: "Shadow 2",
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Shadow 2");
    expect(names()).toEqual(["Shadow 1", "Shadow 2"]);
  });

  it("reports an empty name", async () => {
    seed(item("Shadow 1", 5));
    for (const name of ["", "   "]) {
      const r = await call("rename_monster", { target: "Shadow 1", name });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/name/i);
    }
    expect(names()).toEqual(["Shadow 1"]);
  });
});

describe("set_initiative", () => {
  const initiatives = () =>
    repoOf(ctx)
      .listInstances()
      .map((i) => i.initiative);
  const listedOrder = async () =>
    (
      (await call("list_encounter")).structuredContent?.["instances"] as {
        name: string;
      }[]
    ).map((i) => i.name);

  it("set_initiative by id stores the value and reports before and after", async () => {
    seed(item("Shadow 1", 5));
    const id = repoOf(ctx).listInstances()[0]?.id ?? "";

    const r = await call("set_initiative", { target: id, initiative: 17 });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("Shadow 1: initiative 5 -> 17");
    expect(r.structuredContent?.["instance"]).toMatchObject({
      id,
      name: "Shadow 1",
      initiative: 17,
    });
    expect(r.structuredContent?.["before"]).toBe(5);
    expect(initiatives()).toEqual([17]);
  });

  it("set_initiative by exact name works and list_encounter order reflects the new value", async () => {
    seed(item("Shadow 1", 15), item("Shadow 2", 8));
    expect(await listedOrder()).toEqual(["Shadow 1", "Shadow 2"]);

    const r = await call("set_initiative", {
      target: "Shadow 2",
      initiative: 20,
    });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("Shadow 2: initiative 8 -> 20");
    expect(initiatives()).toEqual([15, 20]);
    expect(await listedOrder()).toEqual(["Shadow 2", "Shadow 1"]);
  });

  it("set_initiative reports unset as the before value when the monster had no initiative", async () => {
    seed(item("Shadow 1", null));

    const r = await call("set_initiative", {
      target: "Shadow 1",
      initiative: 0,
    });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("Shadow 1: initiative unset -> 0");
    expect(r.structuredContent?.["before"]).toBeNull();
    expect(r.structuredContent?.["instance"]).toMatchObject({ initiative: 0 });
    expect(initiatives()).toEqual([0]);
  });

  it("set_initiative on an unknown target fails and changes nothing", async () => {
    seed(item("Shadow 1", 5), item("Shadow 2", 3));

    const r = await call("set_initiative", {
      target: "Nobody",
      initiative: 12,
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Nobody");
    expect(initiatives()).toEqual([5, 3]);
  });
});

describe("roll_initiative", () => {
  const OGRE = "srd-2024_ogre";
  const initiatives = () =>
    repoOf(ctx)
      .listInstances()
      .map((i) => [i.displayName, i.initiative]);
  const listedOrder = async () =>
    (
      (await call("list_encounter")).structuredContent?.["instances"] as {
        name: string;
      }[]
    ).map((i) => i.name);
  const grouped = (
    displayName: string,
    initiative: number | null,
  ): NewMonsterInstance => ({
    ...item(displayName, initiative),
    groupId: "g1",
  });

  it("roll_initiative by id and by exact name writes the rolled values and reports roll, modifier, before and after for each", async () => {
    seed(item("Shadow 1", 5), {
      monsterKey: OGRE,
      displayName: "Ogre 1",
      maxHp: 68,
      initiative: 4,
    });
    const shadowId = repoOf(ctx).listInstances()[0]?.id ?? "";
    const ogreId = repoOf(ctx).listInstances()[1]?.id ?? "";
    ctx.rng = cycleRng(12, 6);

    const r = await call("roll_initiative", {
      targets: [shadowId, "Ogre 1"],
    });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain(
      "Shadow 1: initiative 5 -> 15 (d20 13, modifier +2)",
    );
    expect(text(r)).toContain("Ogre 1: initiative 4 -> 6 (d20 7, modifier -1)");
    expect(r.structuredContent?.["instances"]).toEqual([
      {
        id: shadowId,
        name: "Shadow 1",
        monsterKey: SHADOW,
        hp: 10,
        maxHp: 10,
        initiative: 15,
        armorClass: null,
        before: 5,
        roll: 13,
        modifier: 2,
      },
      {
        id: ogreId,
        name: "Ogre 1",
        monsterKey: OGRE,
        hp: 68,
        maxHp: 68,
        initiative: 6,
        armorClass: null,
        before: 4,
        roll: 7,
        modifier: -1,
      },
    ]);
    expect(r.structuredContent?.["rolls"]).toHaveLength(2);
    expect(initiatives()).toEqual([
      ["Shadow 1", 15],
      ["Ogre 1", 6],
    ]);
  });

  it("roll_initiative reports unset as the before value for a monster with no initiative", async () => {
    seed(item("Shadow 1", null));
    ctx.rng = cycleRng(9);

    const r = await call("roll_initiative", { targets: ["Shadow 1"] });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain(
      "Shadow 1: initiative unset -> 12 (d20 10, modifier +2)",
    );
    expect(r.structuredContent?.["instances"]).toEqual([
      expect.objectContaining({
        name: "Shadow 1",
        before: null,
        initiative: 12,
      }),
    ]);
    expect(initiatives()).toEqual([["Shadow 1", 12]]);
  });

  it("roll_initiative shares one roll within a group by default and rolls each monster with mode each", async () => {
    seed(
      grouped("Shadow 1", 1),
      grouped("Shadow 2", 2),
      grouped("Shadow 3", 3),
    );
    const targets = ["Shadow 1", "Shadow 2", "Shadow 3"];
    ctx.rng = cycleRng(10, 4, 16);

    const shared = await call("roll_initiative", { targets });
    expect(shared.isError).toBeUndefined();
    expect(text(shared)).toContain(
      "Shadow 1: initiative 1 -> 13 (d20 11, modifier +2)",
    );
    expect(text(shared)).toContain(
      "Shadow 2: initiative 2 -> 13 (d20 11, modifier +2)",
    );
    expect(text(shared)).toContain(
      "Shadow 3: initiative 3 -> 13 (d20 11, modifier +2)",
    );
    expect(shared.structuredContent?.["rolls"]).toHaveLength(1);
    expect(initiatives()).toEqual([
      ["Shadow 1", 13],
      ["Shadow 2", 13],
      ["Shadow 3", 13],
    ]);

    ctx.rng = cycleRng(10, 4, 16);
    const each = await call("roll_initiative", { targets, mode: "each" });
    expect(each.isError).toBeUndefined();
    expect(text(each)).toContain(
      "Shadow 1: initiative 13 -> 13 (d20 11, modifier +2)",
    );
    expect(text(each)).toContain(
      "Shadow 2: initiative 13 -> 7 (d20 5, modifier +2)",
    );
    expect(text(each)).toContain(
      "Shadow 3: initiative 13 -> 19 (d20 17, modifier +2)",
    );
    expect(each.structuredContent?.["rolls"]).toHaveLength(3);
    expect(initiatives()).toEqual([
      ["Shadow 1", 13],
      ["Shadow 2", 7],
      ["Shadow 3", 19],
    ]);
  });

  it("roll_initiative fails and changes nothing when a target is unknown or ambiguous", async () => {
    seed(item("A", 1), item("Twin", 2), item("Twin", 3));
    const before = initiatives();

    const unknown = await call("roll_initiative", { targets: ["A", "Ghost"] });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('Unknown target "Ghost"');
    expect(text(unknown)).toContain("Nothing was changed.");
    expect(initiatives()).toEqual(before);

    const ambiguous = await call("roll_initiative", { targets: ["A", "Twin"] });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toContain("Ambiguous");
    expect(text(ambiguous)).toContain("Nothing was changed.");
    expect(initiatives()).toEqual(before);
  });

  it("roll_initiative changes the list_encounter order to the rolled values", async () => {
    seed(item("Shadow 1", 15), item("Shadow 2", 8));
    expect(await listedOrder()).toEqual(["Shadow 1", "Shadow 2"]);
    ctx.rng = cycleRng(19);

    const r = await call("roll_initiative", { targets: ["Shadow 2"] });
    expect(r.isError).toBeUndefined();
    expect(initiatives()).toEqual([
      ["Shadow 1", 15],
      ["Shadow 2", 22],
    ]);
    expect(await listedOrder()).toEqual(["Shadow 2", "Shadow 1"]);
  });
});

describe("set_stats_visibility", () => {
  const visibility = () =>
    repoOf(ctx)
      .listInstances()
      .map((i) => [i.displayName, i.statsVisible]);

  it("set_stats_visibility reveals several targets in one call", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const idC = repoOf(ctx).listInstances()[2]?.id ?? "";

    const r = await call("set_stats_visibility", {
      targets: ["A", idC],
      visible: true,
    });
    expect(r.isError).toBeUndefined();
    expect(visibility()).toEqual([
      ["A", true],
      ["B", false],
      ["C", true],
    ]);
  });

  it("set_stats_visibility hides previously revealed targets", async () => {
    seed(
      { ...item("A", 1), statsVisible: true },
      { ...item("B", 2), statsVisible: true },
      { ...item("C", 3), statsVisible: true },
    );
    expect(visibility()).toEqual([
      ["A", true],
      ["B", true],
      ["C", true],
    ]);

    const r = await call("set_stats_visibility", {
      targets: ["A", "B"],
      visible: false,
    });
    expect(r.isError).toBeUndefined();
    expect(visibility()).toEqual([
      ["A", false],
      ["B", false],
      ["C", true],
    ]);
  });

  it("set_stats_visibility fails and changes nothing when a target is unknown", async () => {
    seed(item("A", 1), item("B", 2));

    const r = await call("set_stats_visibility", {
      targets: ["A", "Ghost"],
      visible: true,
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Ghost");
    expect(visibility()).toEqual([
      ["A", false],
      ["B", false],
    ]);
  });
});

describe("clear_encounter", () => {
  it("uses singular for one monster", async () => {
    seed(item("A", 1));
    expect(text(await call("clear_encounter"))).toContain(
      "Cleared 1 monster: A.",
    );
  });

  it("removes every monster", async () => {
    seed(item("A", 1), item("B", 2));
    const r = await call("clear_encounter");
    expect(text(r)).toContain("Cleared 2");
    expect(names()).toEqual([]);
  });
});

describe("setup_status", () => {
  it("setup_status replies with the formatted report of ctx.setup and structured ready and rows, and is not an error when the bridge is down", async () => {
    const bridgeDown = {
      bridge: { answer: { kind: "unreachable" as const } },
    };
    ctx.setup = makeTestSetupPorts(bridgeDown);
    const r = await call("setup_status");
    const expected = await getSetupStatus(makeTestSetupPorts(bridgeDown));
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe(formatSetupStatus(expected));
    expect(r.structuredContent).toEqual({
      summary: text(r),
      ready: false,
      rows: expected.rows,
    });
  });
});

describe("table_status", () => {
  // These tests set the open scene and its binding themselves: start from an
  // empty store with no scene open and no encounter.
  beforeEach(() => {
    ctx.encounters = new SqliteEncounterDirectory(openDatabase(":memory:"), {
      now: () => tick++,
    });
  });

  /**
   * Opens "scene-1" in the store bound to the current encounter (the one
   * `seed` created), and returns what a tab holding it for that scene reports.
   */
  function holdSeededScene(): { sceneId: string; heldEncounterId: string } {
    const encounter = ctx.encounters.getCurrentEncounter();
    if (!encounter) throw new Error("seed an encounter first");
    ctx.encounters.setOpenScene("scene-1");
    ctx.encounters.bindScene("scene-1", encounter.id);
    return { sceneId: "scene-1", heldEncounterId: encounter.id };
  }

  it("`table_status` formats text and `structuredContent` from the port and the repo when in sync", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [],
      roomId: "room-abc",
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toMatch(/\bin sync\b/i);
    expect(out).not.toMatch(/out of sync|not in sync/i);
    expect(out).toMatch(/\b3\b/);
    expect(r.structuredContent).toEqual({
      summary: out,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      encounterCount: 3,
      inSync: true,
      roomId: "room-abc",
      encounter: "Encounter 1",
    });
  });

  it("table_status names the room in its summary line and structured result when in sync", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [],
      roomId: "room-abc",
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    expect(text(r).split("\n")[0]).toBe(
      "Owlbear is in sync (room room-abc): scene ready, 3 tokens on the scene, 3 instances applied, 3 in the encounter.",
    );
    expect(r.structuredContent).toMatchObject({
      inSync: true,
      roomId: "room-abc",
    });
  });

  it("table_status names the room in its summary line when out of sync", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    ctx.table = tableAnswering({
      ...held,
      sceneReady: false,
      tokenCount: 0,
      appliedInstanceCount: 0,
      artWaits: [],
      roomId: "room-xyz",
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    expect(text(r).split("\n")[0]).toBe(
      "Owlbear is out of sync (room room-xyz): scene not ready, 0 tokens on the scene, 0 instances applied, 3 in the encounter.",
    );
    expect(r.structuredContent).toMatchObject({
      inSync: false,
      roomId: "room-xyz",
    });
  });

  it("table_status without a room id says the room is unknown and to reload the Owlbear tab, and leaves `roomId` out of its structured result", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [],
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    expect(text(r).split("\n")[0]).toBe(
      "Owlbear is in sync (room unknown: reload the Owlbear tab): scene ready, 3 tokens on the scene, 3 instances applied, 3 in the encounter.",
    );
    expect(r.structuredContent).toMatchObject({ inSync: true });
    expect(r.structuredContent).not.toHaveProperty("roomId");
  });

  it("`table_status` reports out of sync with all three counts in the text", async () => {
    // Encounter count 3; tokens 7 and applied 8 are distinct from it.
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 7,
      appliedInstanceCount: 8,
      artWaits: [],
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toMatch(/out of sync/i);
    for (const n of [7, 8, 3])
      expect(out).toMatch(new RegExp(`\\b${String(n)}\\b`));
  });

  it("`table_status` returns an `isError` result carrying the port's `TableUnavailableError` message", async () => {
    const message = "no Owlbear GM tab is connected to the bridge";
    ctx.table = {
      sceneStatus: () => Promise.reject(new TableUnavailableError(message)),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    };
    const r = await call("table_status");
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(message);
  });

  it("table_status names the types whose art is being picked and says tokens wait on the GM, in its text and structured result", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [
        { monsterKey: "srd-2024_ogre", monsterName: "Ogre", step: "pick" },
      ],
      roomId: "room-abc",
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    const line =
      "Tokens are waiting on the GM: art for Ogre is being chosen in Owlbear's image picker; cancelling it gives circles.";
    const lines = text(r).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Owlbear is out of sync \(room room-abc\): /);
    expect(lines[1]).toBe("Encounter: Encounter 1.");
    expect(lines[2]).toBe(line);
    expect(r.structuredContent).toMatchObject({
      inSync: false,
      waitingOnGm: [line],
    });
  });

  it("table_status names the types whose art needs re-uploading and what the GM presses, in its text and structured result", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    const reupload = (monsterKey: string, monsterName: string) => ({
      monsterKey,
      monsterName,
      step: "reupload" as const,
    });

    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [
        reupload("srd-2024_wolf", "Wolf"),
        reupload("srd-2024_owlbear", "Owlbear"),
      ],
      roomId: "room-abc",
    });
    const two = await call("table_status");
    expect(two.isError).toBeFalsy();
    const twoLine =
      "Art for Wolf and Owlbear needs re-uploading: click Re-upload next to each in the extension panel, then Pick the uploaded image.";
    const twoLines = text(two).split("\n");
    expect(twoLines).toHaveLength(3);
    // A re-upload alone leaves the verdict to the counts.
    expect(twoLines[0]).toMatch(/^Owlbear is in sync \(room room-abc\): /);
    expect(twoLines[1]).toBe("Encounter: Encounter 1.");
    expect(twoLines[2]).toBe(twoLine);
    expect(two.structuredContent).toMatchObject({
      inSync: true,
      waitingOnGm: [twoLine],
    });

    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [reupload("srd-2024_wolf", "Wolf")],
    });
    const one = await call("table_status");
    const oneLine =
      "Art for Wolf needs re-uploading: click Re-upload next to it in the extension panel, then Pick the uploaded image.";
    expect(text(one).split("\n")[2]).toBe(oneLine);
    expect(one.structuredContent).toMatchObject({ waitingOnGm: [oneLine] });

    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [
        reupload("srd-2024_wolf", "Wolf"),
        reupload("srd-2024_owlbear", "Owlbear"),
        reupload("srd-2024_ogre", "Ogre"),
      ],
    });
    const three = await call("table_status");
    expect(text(three).split("\n")[2]).toBe(
      "Art for Wolf, Owlbear and Ogre needs re-uploading: click Re-upload next to each in the extension panel, then Pick the uploaded image.",
    );
  });

  it("table_status adds nothing when no art wait is open", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const held = holdSeededScene();
    ctx.table = tableAnswering({
      ...held,
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      artWaits: [],
      roomId: "room-abc",
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe(
      "Owlbear is in sync (room room-abc): scene ready, 3 tokens on the scene, 3 instances applied, 3 in the encounter.\nEncounter: Encounter 1.",
    );
    expect(r.structuredContent).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      encounterCount: 3,
      inSync: true,
      roomId: "room-abc",
      encounter: "Encounter 1",
      summary:
        "Owlbear is in sync (room room-abc): scene ready, 3 tokens on the scene, 3 instances applied, 3 in the encounter.\nEncounter: Encounter 1.",
    });
  });

  /** Stores an encounter with `count` instances; returns its id. */
  function encounterWith(name: string, count: number): string {
    const { id } = ctx.encounters.createEncounter(name);
    ctx.encounters
      .repositoryFor(id)
      .addInstances(
        () =>
          Array.from({ length: count }, (_, i) =>
            item(`${name} ${String(i + 1)}`, null),
          ),
        origin,
      );
    return id;
  }

  /** Opens `sceneId` in the store and binds it to `encounterId`. */
  function openBound(sceneId: string, encounterId: string): void {
    ctx.encounters.setOpenScene(sceneId);
    ctx.encounters.bindScene(sceneId, encounterId);
  }

  const answer = (
    count: number,
    extra: Partial<TableSceneStatus> = {},
  ): TableSceneStatus => ({
    sceneReady: true,
    tokenCount: count,
    appliedInstanceCount: count,
    artWaits: [],
    roomId: "room-abc",
    ...extra,
  });

  it("table_status names the open scene's encounter on the line after the status, and in its structured content", async () => {
    const goblins = encounterWith("Goblin Ambush", 2);
    const wolves = encounterWith("Wolf Pack", 5);
    ctx.encounters.setCurrentEncounter(wolves);
    openBound("scene-1", goblins);
    ctx.table = tableAnswering(
      answer(2, { sceneId: "scene-1", heldEncounterId: goblins }),
    );

    const r = await call("table_status");

    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out.split("\n")).toEqual([
      "Owlbear is in sync (room room-abc): scene ready, 2 tokens on the scene, 2 instances applied, 2 in the encounter.",
      "Encounter: Goblin Ambush.",
    ]);
    expect(r.structuredContent).toEqual({
      summary: out,
      sceneReady: true,
      tokenCount: 2,
      appliedInstanceCount: 2,
      encounterCount: 2,
      inSync: true,
      roomId: "room-abc",
      encounter: "Goblin Ambush",
    });
  });

  it("table_status in an open scene with no encounter says the scene has none yet, gives a verdict, and creates no encounter", async () => {
    ctx.encounters.setOpenScene("scene-1");
    ctx.table = tableAnswering(
      answer(0, { sceneId: "scene-1", heldEncounterId: null }),
    );

    const r = await call("table_status");

    expect(r.isError).toBeFalsy();
    expect(text(r).split("\n")).toEqual([
      "Owlbear is in sync (room room-abc): scene ready, 0 tokens on the scene, 0 instances applied, 0 in the encounter.",
      "This scene has no encounter yet.",
    ]);
    expect(r.structuredContent).toMatchObject({
      inSync: true,
      encounterCount: 0,
      encounter: null,
    });
    expect(ctx.encounters.listEncounters()).toEqual([]);
    expect(ctx.encounters.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: undefined,
    });
  });

  it("table_status with no scene open says so and creates no encounter", async () => {
    ctx.table = tableAnswering(
      answer(0, { sceneId: null, heldEncounterId: null }),
    );

    const r = await call("table_status");

    expect(r.isError).toBeFalsy();
    expect(text(r).split("\n")).toEqual([
      "Owlbear is out of sync (room room-abc): scene ready, 0 tokens on the scene, 0 instances applied, 0 in the encounter.",
      "No scene is open.",
    ]);
    expect(r.structuredContent).toMatchObject({
      inSync: false,
      encounterCount: 0,
      encounter: null,
    });
    expect(ctx.encounters.listEncounters()).toEqual([]);
    expect(ctx.encounters.getOpenScene()).toBeUndefined();
  });

  it("table_status reports out of sync and says the Owlbear tab has not caught up while the tab holds another encounter", async () => {
    const goblins = encounterWith("Goblin Ambush", 2);
    const wolves = encounterWith("Wolf Pack", 2);
    openBound("scene-1", goblins);
    ctx.table = tableAnswering(
      answer(2, { sceneId: "scene-1", heldEncounterId: wolves }),
    );

    const r = await call("table_status");

    expect(r.isError).toBeFalsy();
    expect(text(r).split("\n")).toEqual([
      "Owlbear is out of sync (room room-abc): scene ready, 2 tokens on the scene, 2 instances applied, 2 in the encounter.",
      "Encounter: Goblin Ambush; the Owlbear tab has not caught up yet.",
    ]);
    expect(r.structuredContent).toMatchObject({
      inSync: false,
      encounter: "Goblin Ambush",
    });
  });

  it("table_status reports our tokens of another encounter or none in its text and structured content, only when there are some, and they leave it in sync", async () => {
    const goblins = encounterWith("Goblin Ambush", 2);
    openBound("scene-1", goblins);
    const held = { sceneId: "scene-1", heldEncounterId: goblins };

    ctx.table = tableAnswering(answer(2, { ...held, unmanagedTokenCount: 3 }));
    const several = await call("table_status");
    expect(text(several).split("\n")).toEqual([
      "Owlbear is in sync (room room-abc): scene ready, 2 tokens on the scene, 2 instances applied, 2 in the encounter.",
      "Encounter: Goblin Ambush.",
      "3 tokens of ours on the scene are left alone: they belong to another encounter or to none, and do not count toward sync.",
    ]);
    expect(several.structuredContent).toMatchObject({
      inSync: true,
      unmanagedTokenCount: 3,
    });

    ctx.table = tableAnswering(answer(2, { ...held, unmanagedTokenCount: 1 }));
    const one = await call("table_status");
    expect(text(one).split("\n")[2]).toBe(
      "1 token of ours on the scene is left alone: it belongs to another encounter or to none, and does not count toward sync.",
    );
    expect(one.structuredContent).toMatchObject({
      inSync: true,
      unmanagedTokenCount: 1,
    });

    ctx.table = tableAnswering(answer(2, { ...held, unmanagedTokenCount: 0 }));
    const none = await call("table_status");
    expect(text(none).split("\n")).toEqual([
      "Owlbear is in sync (room room-abc): scene ready, 2 tokens on the scene, 2 instances applied, 2 in the encounter.",
      "Encounter: Goblin Ambush.",
    ]);
    expect(none.structuredContent).toMatchObject({ inSync: true });
    expect(none.structuredContent).not.toHaveProperty("unmanagedTokenCount");
  });

  it("table_status for a tab without the new fields gives a verdict from the counts and says the tab's encounter is unknown", async () => {
    const goblins = encounterWith("Goblin Ambush", 3);
    openBound("scene-1", goblins);

    ctx.table = tableAnswering(answer(3));
    const matching = await call("table_status");
    expect(matching.isError).toBeFalsy();
    expect(text(matching).split("\n")).toEqual([
      "Owlbear is in sync (room room-abc): scene ready, 3 tokens on the scene, 3 instances applied, 3 in the encounter.",
      "Encounter: Goblin Ambush (the tab's encounter unknown: reload the Owlbear tab).",
    ]);
    expect(matching.structuredContent).toMatchObject({
      inSync: true,
      encounter: "Goblin Ambush",
    });

    ctx.table = tableAnswering(answer(2));
    const differing = await call("table_status");
    expect(text(differing).split("\n")[0]).toBe(
      "Owlbear is out of sync (room room-abc): scene ready, 2 tokens on the scene, 2 instances applied, 3 in the encounter.",
    );
  });
});

describe("the encounter a tool call acts on", () => {
  /** A full tool context over `encounters`, independent of the shared one. */
  function contextOver(encounters: EncounterDirectory): ToolContext {
    let groups = 0;
    return {
      table: {
        sceneStatus: () => Promise.reject(new Error("not stubbed")),
        sceneMap: () => Promise.reject(new Error("not stubbed")),
        sceneTokens: () => Promise.reject(new Error("not stubbed")),
        mapImage: () => Promise.reject(new Error("not stubbed")),
      },
      encounters,
      monsters,
      rng: cycleRng(0, 3, 5, 7),
      now: () => new Date("2026-01-01T00:00:00Z"),
      newGroupId: () => `group-${String(++groups)}`,
      browser: { showPage: () => Promise.reject(new Error("not stubbed")) },
      setup: makeTestSetupPorts(),
      newCommandId: () => "command",
    };
  }

  async function callWith(
    context: ToolContext,
    name: string,
    args: unknown = {},
  ): Promise<ToolResult> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.handler(context, args);
  }

  it('a tool call on a store with no encounter creates "Encounter 1", makes it current and acts on it', async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));

    const r = await callWith(contextOver(directory), "add_monsters", {
      groups: [{ monster: SHADOW, count: 2 }],
    });

    expect(r.isError).toBeUndefined();
    const encounters = directory.listEncounters();
    expect(encounters.map((e) => e.name)).toEqual(["Encounter 1"]);
    expect(directory.getCurrentEncounter()).toEqual(encounters[0]);
    expect(
      directory
        .repositoryFor(encounters[0]!.id)
        .listInstances()
        .map((i) => i.displayName),
    ).toEqual(["Shadow 1", "Shadow 2"]);
  });

  it("a tool that reads no encounter creates none", async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const context = contextOver(directory);

    const search = await callWith(context, "search_monsters", {
      query: "shadow",
    });
    const statblock = await callWith(context, "get_statblock", {
      key: SHADOW,
    });

    expect(search.isError).toBeUndefined();
    expect(statblock.isError).toBeUndefined();
    expect(directory.listEncounters()).toEqual([]);
    expect(directory.getCurrentEncounter()).toBeUndefined();
  });

  it('a read tool in an open scene with no encounter replies "This scene has no encounter yet." and creates none', async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const tavern = directory.createEncounter("Tavern");
    directory.setCurrentEncounter(tavern.id);
    directory.setOpenScene("scene-1");

    const r = await callWith(contextOver(directory), "list_encounter");

    expect(r.isError).toBe(true);
    expect(text(r)).toBe("This scene has no encounter yet.");
    expect(directory.listEncounters()).toEqual([tavern]);
    expect(directory.getCurrentEncounter()).toEqual(tavern);
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: undefined,
    });
  });

  it('a writing tool that cannot start an encounter, in an open scene with no encounter, replies "This scene has no encounter yet." and creates none', async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const tavern = directory.createEncounter("Tavern");
    directory.setCurrentEncounter(tavern.id);
    directory
      .repositoryFor(tavern.id)
      .addInstances(() => [item("Shadow 1", 5, 10)], origin);
    directory.setOpenScene("scene-1");

    const r = await callWith(contextOver(directory), "clear_encounter");

    expect(r.isError).toBe(true);
    expect(text(r)).toBe("This scene has no encounter yet.");
    expect(directory.listEncounters()).toEqual([tavern]);
    expect(directory.getCurrentEncounter()).toEqual(tavern);
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter: undefined,
    });
    expect(
      directory
        .repositoryFor(tavern.id)
        .listInstances()
        .map((i) => i.displayName),
    ).toEqual(["Shadow 1"]);
  });

  it('add_monsters in an open scene with no encounter adds to a new "Encounter N" bound to the scene and made current', async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const first = directory.createEncounter("Encounter 1");
    directory.setCurrentEncounter(first.id);
    directory.setOpenScene("scene-1");

    const r = await callWith(contextOver(directory), "add_monsters", {
      groups: [{ monster: SHADOW, count: 2 }],
    });

    expect(r.isError).toBeUndefined();
    const created = directory.listEncounters().filter((e) => e.id !== first.id);
    expect(created.map((e) => e.name)).toEqual(["Encounter 2"]);
    const encounter = created[0]!;
    expect(directory.getOpenScene()).toEqual({
      sceneId: "scene-1",
      encounter,
    });
    expect(directory.getCurrentEncounter()).toEqual(encounter);
    expect(
      directory
        .repositoryFor(encounter.id)
        .listInstances()
        .map((i) => i.displayName),
    ).toEqual(["Shadow 1", "Shadow 2"]);
    expect(directory.repositoryFor(first.id).listInstances()).toEqual([]);
  });

  it("a tool call keeps acting on the encounter it resolved when another encounter becomes current during the call", async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const a = directory.createEncounter("Encounter A");
    const b = directory.createEncounter("Encounter B");
    directory.setCurrentEncounter(a.id);
    const [shadow] = directory
      .repositoryFor(a.id)
      .addInstances(() => [item("Shadow 1", 5, 10)], origin);
    directory
      .repositoryFor(b.id)
      .addInstances(() => [item("Shadow 1", 5, 10)], origin);

    // The first repository call of the tool makes B current, as another
    // process could between two statements of the call.
    const requested: string[] = [];
    let switched = false;
    const switching: EncounterDirectory = {
      listEncounters: () => directory.listEncounters(),
      createEncounter: (name) => directory.createEncounter(name),
      getCurrentEncounter: () => directory.getCurrentEncounter(),
      setCurrentEncounter: (id) => directory.setCurrentEncounter(id),
      findEncounterOfInstance: (id) => directory.findEncounterOfInstance(id),
      transaction: (fn) => directory.transaction(fn),
      mapRepositoryFor: (id) => directory.mapRepositoryFor(id),
      getOpenScene: () => directory.getOpenScene(),
      setOpenScene: (sceneId) => directory.setOpenScene(sceneId),
      bindScene: (sceneId, encounterId) =>
        directory.bindScene(sceneId, encounterId),
      setEncounterName: (encounterId, name) =>
        directory.setEncounterName(encounterId, name),
      findSceneOfEncounter: (encounterId) =>
        directory.findSceneOfEncounter(encounterId),
      repositoryFor(encounterId) {
        requested.push(encounterId);
        const inner = directory.repositoryFor(encounterId);
        return new Proxy(inner, {
          get(target, prop, receiver) {
            const value: unknown = Reflect.get(target, prop, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              if (!switched) {
                switched = true;
                directory.setCurrentEncounter(b.id);
              }
              return (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              );
            };
          },
        });
      },
    };

    const r = await callWith(contextOver(switching), "apply_damage", {
      target: "Shadow 1",
      amount: 4,
    });

    expect(r.isError).toBeUndefined();
    expect(switched).toBe(true);
    expect(directory.getCurrentEncounter()).toEqual(b);
    expect(requested).toEqual([a.id]);
    expect(
      directory
        .repositoryFor(a.id)
        .listInstances()
        .map((i) => [i.id, i.currentHp]),
    ).toEqual([[shadow!.id, 6]]);
    expect(
      directory
        .repositoryFor(b.id)
        .listInstances()
        .map((i) => i.currentHp),
    ).toEqual([10]);
    expect(directory.listEncounters()).toEqual([a, b]);
  });

  it("with no scene open, apply_damage with encounter changes that encounter and makes it current, a following call without encounter acts on it, and both replies begin with its encounter line", async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const first = directory.createEncounter("Encounter 1");
    const ambush = directory.createEncounter("Goblin Ambush");
    directory.setCurrentEncounter(first.id);
    directory.setOpenScene(null);
    for (const encounter of [first, ambush])
      directory
        .repositoryFor(encounter.id)
        .addInstances(() => [item("Shadow 1", 5, 10)], origin);
    const context = contextOver(directory);

    const named = await callWith(context, "apply_damage", {
      target: "Shadow 1",
      amount: 4,
      encounter: "goblin ambush",
    });

    expect(named.isError).toBeUndefined();
    expect(text(named)).toBe(
      "Encounter: Goblin Ambush\n\nShadow 1: 10 -> 6/10 HP",
    );
    expect(named.structuredContent).toMatchObject({
      encounter: "Goblin Ambush",
      summary: "Encounter: Goblin Ambush\n\nShadow 1: 10 -> 6/10 HP",
    });
    expect(directory.getCurrentEncounter()).toEqual(ambush);

    const unnamed = await callWith(context, "apply_damage", {
      target: "Shadow 1",
      amount: 1,
    });

    expect(text(unnamed)).toBe(
      "Encounter: Goblin Ambush\n\nShadow 1: 6 -> 5/10 HP",
    );
    expect(unnamed.structuredContent).toMatchObject({
      encounter: "Goblin Ambush",
    });
    expect(
      directory.repositoryFor(first.id).listInstances()[0]?.currentHp,
    ).toBe(10);
    expect(
      directory.repositoryFor(ambush.id).listInstances()[0]?.currentHp,
    ).toBe(5);
  });

  it("with a scene open, apply_damage naming another encounter changes that one and leaves the current encounter as it was, its reply begins with the encounter line, and a call in the open scene's encounter has no line but carries the encounter's name in its structured content", async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const bound = directory.createEncounter("Encounter 1");
    const ambush = directory.createEncounter("Goblin Ambush");
    directory.bindScene("scene-1", bound.id);
    directory.setOpenScene("scene-1");
    directory.setCurrentEncounter(bound.id);
    for (const encounter of [bound, ambush])
      directory
        .repositoryFor(encounter.id)
        .addInstances(() => [item("Shadow 1", 5, 10)], origin);
    const context = contextOver(directory);

    const named = await callWith(context, "apply_damage", {
      target: "Shadow 1",
      amount: 4,
      encounter: "Goblin Ambush",
    });

    expect(named.isError).toBeUndefined();
    expect(text(named)).toBe(
      "Encounter: Goblin Ambush\n\nShadow 1: 10 -> 6/10 HP",
    );
    expect(named.structuredContent).toMatchObject({
      encounter: "Goblin Ambush",
    });
    expect(directory.getCurrentEncounter()).toEqual(bound);
    expect(
      directory.repositoryFor(ambush.id).listInstances()[0]?.currentHp,
    ).toBe(6);

    const own = await callWith(context, "apply_damage", {
      target: "Shadow 1",
      amount: 3,
    });

    expect(text(own)).toBe("Shadow 1: 10 -> 7/10 HP");
    expect(own.structuredContent).toMatchObject({
      encounter: "Encounter 1",
      summary: "Shadow 1: 10 -> 7/10 HP",
    });
    expect(
      directory.repositoryFor(bound.id).listInstances()[0]?.currentHp,
    ).toBe(7);
    expect(directory.getCurrentEncounter()).toEqual(bound);
  });

  it("a call naming an unknown encounter fails listing the encounters' names and changes nothing", async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const first = directory.createEncounter("Encounter 1");
    directory.createEncounter("Goblin Ambush");
    directory.setCurrentEncounter(first.id);
    directory.setOpenScene(null);
    directory
      .repositoryFor(first.id)
      .addInstances(() => [item("Shadow 1", 5, 10)], origin);
    const before = directory.listEncounters();

    const r = await callWith(contextOver(directory), "apply_damage", {
      target: "Shadow 1",
      amount: 4,
      encounter: "Ogre Den",
    });

    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Ogre Den");
    expect(text(r)).toContain("Encounter 1");
    expect(text(r)).toContain("Goblin Ambush");
    expect(directory.listEncounters()).toEqual(before);
    expect(directory.getCurrentEncounter()).toEqual(first);
    expect(
      directory.repositoryFor(first.id).listInstances()[0]?.currentHp,
    ).toBe(10);
  });

  it('add_monsters that starts an encounter in an open scene begins its reply with "New encounter: Encounter 2"', async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const first = directory.createEncounter("Encounter 1");
    directory.setCurrentEncounter(first.id);
    directory.setOpenScene("scene-1");

    const r = await callWith(contextOver(directory), "add_monsters", {
      groups: [{ monster: SHADOW, count: 1 }],
    });

    expect(r.isError).toBeUndefined();
    expect(text(r).startsWith("New encounter: Encounter 2\n\n")).toBe(true);
    expect(r.structuredContent).toMatchObject({
      encounter: "Encounter 2",
      summary: text(r),
    });
  });

  it("an error reply of a call with no scene open begins with the encounter line", async () => {
    const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
    const first = directory.createEncounter("Encounter 1");
    directory.setCurrentEncounter(first.id);
    directory.setOpenScene(null);

    const r = await callWith(contextOver(directory), "apply_damage", {
      target: "Nobody",
      amount: 1,
    });

    expect(r.isError).toBe(true);
    expect(text(r).startsWith("Encounter: Encounter 1\n\n")).toBe(true);
    expect(text(r)).toContain('Unknown target "Nobody"');
    expect(r.structuredContent).toBeUndefined();
  });

  it("every tool that reads or changes an encounter takes an optional encounter argument, use_encounter requires one, and the other tools take none", () => {
    const optional = [
      "add_monsters",
      "preview_monsters",
      "move_monsters",
      "list_encounter",
      "apply_damage",
      "heal",
      "set_hp",
      "set_max_hp",
      "reset_max_hp",
      "set_armor_class",
      "remove_monsters",
      "restore_monsters",
      "rename_monster",
      "change_monster_type",
      "set_initiative",
      "roll_initiative",
      "split_initiative",
      "merge_initiative",
      "set_stats_visibility",
      "clear_encounter",
      "restore_encounter",
      "undo",
      "use_map",
      "set_rooms",
      "list_rooms",
      "remove_rooms",
      "get_map_image",
      "rename_encounter",
    ];
    const required = ["use_encounter"];
    const none = [
      "search_monsters",
      "get_statblock",
      "open_statblock",
      "setup_status",
      "propose_rooms",
      "table_status",
      "list_encounters",
    ];
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...optional, ...required, ...none].sort(),
    );

    const encounterArgument = (name: string) => {
      const schema = tools.find((t) => t.name === name)?.inputSchema[
        "encounter"
      ];
      if (!schema) return "none";
      const accepts = (args: Record<string, unknown>) =>
        z.object({ encounter: schema }).safeParse(args).success;
      if (!accepts({ encounter: "Goblin Ambush" })) return "not a name";
      return accepts({}) ? "optional" : "required";
    };
    for (const name of optional)
      expect(encounterArgument(name), name).toBe("optional");
    for (const name of required)
      expect(encounterArgument(name), name).toBe("required");
    for (const name of none) expect(encounterArgument(name), name).toBe("none");
  });

  describe("list_encounters", () => {
    it("list_encounters lists each encounter's name, monster count, scene and current flag in a table and its structured content", async () => {
      const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
      const ambush = directory.createEncounter("Goblin Ambush");
      const crypt = directory.createEncounter("Crypt");
      directory.createEncounter("Encounter 3");
      const ambushRepo = directory.repositoryFor(ambush.id);
      const [, , removed] = ambushRepo.addInstances(
        () => [item("Goblin 1", 5), item("Goblin 2", 5), item("Goblin 3", 5)],
        origin,
      );
      ambushRepo.removeInstances([removed!.id], origin);
      directory
        .repositoryFor(crypt.id)
        .addInstances(() => [item("Shadow 1", 5)], origin);
      directory.bindScene("scene-1", ambush.id);
      directory.bindScene("scene-2", crypt.id);
      directory.setOpenScene("scene-1");
      directory.setCurrentEncounter(crypt.id);
      const context = contextOver(directory);

      const r = await callWith(context, "list_encounters");

      const expectedTable = [
        "| encounter | monsters | scene | current |",
        "| --- | --- | --- | --- |",
        "| Goblin Ambush | 2 | open | - |",
        "| Crypt | 1 | another | yes |",
        "| Encounter 3 | 0 | - | - |",
      ].join("\n");
      expect(r.isError).toBeUndefined();
      expect(text(r)).toBe(expectedTable);
      expect(r.structuredContent).toEqual({
        encounters: [
          {
            encounter: "Goblin Ambush",
            monsters: 2,
            bound: true,
            openScene: true,
            current: false,
          },
          {
            encounter: "Crypt",
            monsters: 1,
            bound: true,
            openScene: false,
            current: true,
          },
          {
            encounter: "Encounter 3",
            monsters: 0,
            bound: false,
            openScene: false,
            current: false,
          },
        ],
        sceneOpen: true,
        summary: expectedTable,
      });

      directory.setOpenScene(null);
      const closed = await callWith(context, "list_encounters");

      expect(
        text(closed).startsWith(
          expectedTable.replace("| open |", "| another |"),
        ),
      ).toBe(true);
      expect(text(closed).endsWith("No scene is open.")).toBe(true);
      expect(closed.structuredContent).toMatchObject({ sceneOpen: false });

      directory.setOpenScene("scene-3");
      const unbound = await callWith(context, "list_encounters");

      expect(
        text(unbound).endsWith("The open scene has no encounter yet."),
      ).toBe(true);
      expect(unbound.structuredContent).toMatchObject({ sceneOpen: true });
      expect(directory.listEncounters()).toHaveLength(3);
    });

    it("list_encounters on an empty store says there are no encounters and creates none", async () => {
      const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
      directory.setOpenScene(null);

      const r = await callWith(contextOver(directory), "list_encounters");

      expect(r.isError).toBeUndefined();
      expect(text(r)).toBe("There are no encounters yet.");
      expect(r.structuredContent).toMatchObject({
        encounters: [],
        sceneOpen: false,
      });
      expect(directory.listEncounters()).toEqual([]);
      expect(directory.getCurrentEncounter()).toBeUndefined();
    });
  });

  describe("rename_encounter", () => {
    it("rename_encounter renames the open scene's encounter and replies with the old and new name", async () => {
      const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
      const bound = directory.createEncounter("Encounter 1");
      const current = directory.createEncounter("Encounter 2");
      directory.bindScene("scene-1", bound.id);
      directory.setOpenScene("scene-1");
      directory.setCurrentEncounter(current.id);

      const r = await callWith(contextOver(directory), "rename_encounter", {
        name: "Goblin Ambush",
      });

      expect(r.isError).toBeUndefined();
      expect(text(r)).toBe("Renamed Encounter 1 to Goblin Ambush.");
      expect(r.structuredContent).toEqual({
        encounter: "Goblin Ambush",
        renamedFrom: "Encounter 1",
        summary: "Renamed Encounter 1 to Goblin Ambush.",
      });
      expect(directory.listEncounters().map((e) => e.name)).toEqual([
        "Goblin Ambush",
        "Encounter 2",
      ]);
      expect(directory.getCurrentEncounter()).toEqual(current);
    });

    it("rename_encounter to a name another encounter has fails naming it and renames nothing", async () => {
      const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
      const bound = directory.createEncounter("Encounter 1");
      directory.createEncounter("Crypt");
      directory.bindScene("scene-1", bound.id);
      directory.setOpenScene("scene-1");
      const before = directory.listEncounters();

      const r = await callWith(contextOver(directory), "rename_encounter", {
        name: "crypt",
      });

      expect(r.isError).toBe(true);
      expect(text(r)).toContain("Crypt");
      expect(directory.listEncounters()).toEqual(before);
    });
  });

  describe("use_encounter", () => {
    it("use_encounter binds the named encounter to the open scene, makes it current and replies so", async () => {
      const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
      const crypt = directory.createEncounter("Crypt");
      const ambush = directory.createEncounter("Goblin Ambush");
      directory.bindScene("scene-1", crypt.id);
      directory.setCurrentEncounter(crypt.id);
      directory.setOpenScene("scene-2");

      const r = await callWith(contextOver(directory), "use_encounter", {
        encounter: "goblin ambush",
      });

      expect(r.isError).toBeUndefined();
      expect(text(r)).toBe("Goblin Ambush is now this scene's encounter.");
      expect(r.structuredContent).toEqual({
        encounter: "Goblin Ambush",
        summary: "Goblin Ambush is now this scene's encounter.",
      });
      expect(directory.getOpenScene()).toEqual({
        sceneId: "scene-2",
        encounter: ambush,
      });
      expect(directory.getCurrentEncounter()).toEqual(ambush);
    });

    it("use_encounter with no scene open fails with the reason and binds nothing", async () => {
      const directory = new SqliteEncounterDirectory(openDatabase(":memory:"));
      const crypt = directory.createEncounter("Crypt");
      const ambush = directory.createEncounter("Goblin Ambush");
      directory.setCurrentEncounter(crypt.id);
      directory.setOpenScene(null);

      const r = await callWith(contextOver(directory), "use_encounter", {
        encounter: "Goblin Ambush",
      });

      expect(r.isError).toBe(true);
      expect(text(r)).toContain("No scene is open");
      expect(directory.getCurrentEncounter()).toEqual(crypt);
      expect(directory.listEncounters()).toEqual([crypt, ambush]);
      // Bound to no scene: a fresh scene can still take it.
      directory.setOpenScene("scene-1");
      expect(directory.getOpenScene()?.encounter).toBeUndefined();
      directory.bindScene("scene-1", ambush.id);
      expect(directory.getOpenScene()?.encounter).toEqual(ambush);
    });
  });
});
