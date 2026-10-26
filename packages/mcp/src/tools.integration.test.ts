import {
  TableUnavailableError,
  applyInstanceEdit,
  type EncounterRepository,
  type MonsterInstance,
  type NewMonsterInstance,
  type Rng,
  type TablePort,
  type TableSceneStatus,
  type ChangeOrigin,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  SqliteMapRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

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
    repo: new SqliteEncounterRepository(openDatabase(":memory:"), {
      now: () => tick++,
    }),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters,
    rng: cycleRng(0, 3, 5, 7),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${++groupN}`,
    newCommandId: () => "command",
  };
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
  ctx.repo.addInstances(() => items, origin);
}

/** Delegates to `inner`, with some methods replaced. */
function wrapRepo(
  inner: EncounterRepository,
  over: Partial<EncounterRepository>,
): EncounterRepository {
  return {
    getOrCreateActiveEncounter: () => inner.getOrCreateActiveEncounter(),
    addInstances: (build) => inner.addInstances(build, origin),
    applyDamage: (id, amount) => inner.applyDamage(id, amount, origin),
    applyHealing: (id, amount) => inner.applyHealing(id, amount, origin),
    removeInstances: (ids) => inner.removeInstances(ids, origin),
    listRemovedInstances: () => inner.listRemovedInstances(),
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
  return ctx.repo.listInstances().map((i) => i.displayName);
}

describe("tool registry", () => {
  it("exposes the twenty-nine tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_monsters",
      "apply_damage",
      "change_monster_type",
      "clear_encounter",
      "get_map_image",
      "get_statblock",
      "heal",
      "list_encounter",
      "list_rooms",
      "merge_initiative",
      "move_monsters",
      "propose_rooms",
      "remove_monsters",
      "remove_rooms",
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
      "split_initiative",
      "table_status",
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
      ctx.repo.listInstances().map((i) => [i.displayName, i.statsVisible]),
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
    const [first, second] = ctx.repo.listInstances();
    const firstId = first?.id ?? "";
    const secondId = second?.id ?? "";
    const set = await call("set_armor_class", {
      target: firstId,
      armorClass: 15,
    });
    expect(set.isError).toBeUndefined();
    applyInstanceEdit(
      ctx.repo,
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
    const id = ctx.repo.listInstances()[0]?.id ?? "";

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
    const id = ctx.repo.listInstances()[0]?.id ?? "";

    const hit = await call("apply_damage", { target: id, amount: 4 });
    expect(hit.isError).toBeUndefined();
    expect(text(hit)).toContain("10 -> 6/10");

    const overkill = await call("apply_damage", { target: id, amount: 99 });
    expect(text(overkill)).toContain("6 -> 0/10");

    const healed = await call("heal", { target: "Shadow 1", amount: 3 });
    expect(text(healed)).toContain("0 -> 3/10");

    const overheal = await call("heal", { target: "Shadow 1", amount: 99 });
    expect(text(overheal)).toContain("3 -> 10/10");
    expect(ctx.repo.listInstances()[0]?.currentHp).toBe(10);
  });

  it("errors on unknown or ambiguous targets", async () => {
    seed(item("Twin", 1), item("Twin", 2));
    const unknown = await call("apply_damage", { target: "Nobody", amount: 1 });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('Unknown target "Nobody"');

    const ambiguous = await call("heal", { target: "Twin", amount: 1 });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toContain("Ambiguous");

    const id = ctx.repo.listInstances()[0]?.id ?? "";
    expect(
      (await call("apply_damage", { target: id, amount: 1 })).isError,
    ).toBeUndefined();
  });

  it("apply_damage reports the HP read inside the write, not the HP listed before it", async () => {
    seed(item("Shadow 1", 5, 10));
    const inner = ctx.repo;
    const snapshot = inner.listInstances();
    // Another writer changes HP after the tool listed the encounter.
    inner.applyDamage(snapshot[0]?.id ?? "", 3, origin);
    ctx.repo = staleRepo(inner, snapshot);

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
    expect(ctx.repo.listInstances()[0]?.currentHp).toBe(10);
  });
});

describe("tool errors", () => {
  it("tool handler returns isError for an unknown target, and for an instance removed between resolve and write (UnknownInstanceError)", async () => {
    seed(item("Shadow 1", 5, 10));
    const unknown = await call("apply_damage", { target: "Nobody", amount: 1 });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('Unknown target "Nobody"');

    const inner = ctx.repo;
    const snapshot = inner.listInstances();
    const id = snapshot[0]?.id ?? "";
    // Removed by another writer after the tool resolved the target.
    inner.clearEncounter(origin);
    ctx.repo = staleRepo(inner, snapshot);
    for (const name of ["apply_damage", "heal"]) {
      const r = await call(name, { target: "Shadow 1", amount: 1 });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain(`Unknown monster instance: ${id}`);
    }
  });

  it("tool handler rethrows an unexpected RangeError instead of returning isError", async () => {
    ctx.repo = wrapRepo(ctx.repo, {
      listInstances: () => {
        throw new RangeError("bug");
      },
    });
    await expect(call("list_encounter")).rejects.toThrow(RangeError);
  });
});

describe("remove_monsters", () => {
  it("removes by id and name", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const idC = ctx.repo.listInstances()[2]?.id ?? "";
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
    const id = ctx.repo.listInstances()[0]?.id ?? "";

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
  const initiatives = () => ctx.repo.listInstances().map((i) => i.initiative);
  const listedOrder = async () =>
    (
      (await call("list_encounter")).structuredContent?.["instances"] as {
        name: string;
      }[]
    ).map((i) => i.name);

  it("set_initiative by id stores the value and reports before and after", async () => {
    seed(item("Shadow 1", 5));
    const id = ctx.repo.listInstances()[0]?.id ?? "";

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
    ctx.repo.listInstances().map((i) => [i.displayName, i.initiative]);
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
    const shadowId = ctx.repo.listInstances()[0]?.id ?? "";
    const ogreId = ctx.repo.listInstances()[1]?.id ?? "";
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
    ctx.repo.listInstances().map((i) => [i.displayName, i.statsVisible]);

  it("set_stats_visibility reveals several targets in one call", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const idC = ctx.repo.listInstances()[2]?.id ?? "";

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

describe("table_status", () => {
  it("`table_status` formats text and `structuredContent` from the port and the repo when in sync", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    ctx.table = tableAnswering({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
    });
    const r = await call("table_status");
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toMatch(/\bin sync\b/i);
    expect(out).not.toMatch(/out of sync|not in sync/i);
    expect(out).toMatch(/\b3\b/);
    expect(r.structuredContent).toEqual({
      sceneReady: true,
      tokenCount: 3,
      appliedInstanceCount: 3,
      encounterCount: 3,
      inSync: true,
    });
  });

  it("`table_status` reports out of sync with all three counts in the text", async () => {
    // Encounter count 3; tokens 7 and applied 8 are distinct from it.
    seed(item("A", 1), item("B", 2), item("C", 3));
    ctx.table = tableAnswering({
      sceneReady: true,
      tokenCount: 7,
      appliedInstanceCount: 8,
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
});
