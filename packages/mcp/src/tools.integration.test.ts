import type { BridgeClient } from "@ttrpg-agents/bridge/client";
import type {
  EncounterRepository,
  MonsterInstance,
  NewMonsterInstance,
  Rng,
} from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools, type ToolResult } from "./tools.js";

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
    bridge: {
      command: () =>
        Promise.reject(new Error("bridge not stubbed in this test")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:"), {
      now: () => tick++,
    }),
    monsters,
    rng: cycleRng(0, 3, 5, 7),
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => `group-${++groupN}`,
  };
});

async function call(name: string, args: unknown = {}): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(ctx, args);
}

type AgentCommandResponse = Awaited<ReturnType<BridgeClient["command"]>>;

/** A bridge client stub that answers every command with `response`. */
function bridgeAnswering(response: AgentCommandResponse): BridgeClient {
  return { command: () => Promise.resolve(response) };
}

function text(r: ToolResult): string {
  return r.content.map((c) => c.text).join("\n");
}

function seed(...items: NewMonsterInstance[]): void {
  ctx.repo.addInstances(() => items);
}

/** Delegates to `inner`, with some methods replaced. */
function wrapRepo(
  inner: EncounterRepository,
  over: Partial<EncounterRepository>,
): EncounterRepository {
  return {
    getOrCreateActiveEncounter: () => inner.getOrCreateActiveEncounter(),
    addInstances: (build) => inner.addInstances(build),
    applyDamage: (id, amount) => inner.applyDamage(id, amount),
    applyHealing: (id, amount) => inner.applyHealing(id, amount),
    removeInstances: (ids) => inner.removeInstances(ids),
    clearEncounter: () => inner.clearEncounter(),
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
  it("exposes the nine tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_monsters",
      "apply_damage",
      "clear_encounter",
      "get_statblock",
      "heal",
      "list_encounter",
      "remove_monsters",
      "search_monsters",
      "table_status",
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
    inner.applyDamage(snapshot[0]?.id ?? "", 3);
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
    inner.clearEncounter();
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

describe("clear_encounter", () => {
  it("uses singular for one monster", async () => {
    seed(item("A", 1));
    expect(text(await call("clear_encounter"))).toContain("Cleared 1 monster.");
  });

  it("removes every monster", async () => {
    seed(item("A", 1), item("B", 2));
    const r = await call("clear_encounter");
    expect(text(r)).toContain("Cleared 2");
    expect(names()).toEqual([]);
  });
});

describe("table_status", () => {
  const sceneStatus = (
    sceneReady: boolean,
    tokenCount: number,
    appliedInstanceCount: number,
  ): AgentCommandResponse => ({
    ok: true,
    result: {
      name: "scene-status",
      result: { sceneReady, tokenCount, appliedInstanceCount },
    },
  });

  it("`table_status` returns scene counts and an in-sync verdict when scene ready and tokens, applied and DB counts all match (AC4, A9)", async () => {
    seed(item("A", 1), item("B", 2), item("C", 3));
    const commands: unknown[] = [];
    ctx.bridge = {
      command: (command) => {
        commands.push(command);
        return Promise.resolve(sceneStatus(true, 3, 3));
      },
    };
    const r = await call("table_status");
    expect(commands).toEqual([{ name: "scene-status" }]);
    expect(r.isError).toBeFalsy();
    const out = text(r);
    expect(out).toMatch(/\bin sync\b/i);
    expect(out).not.toMatch(/out of sync|not in sync/i);
    expect(out).toMatch(/\b3\b/);
  });

  it("`table_status` reports out of sync, with the counts, when any of the three differ or the scene is not ready (A9)", async () => {
    // DB count 3 throughout; tokens 7 and applied 8 are distinct from it.
    seed(item("A", 1), item("B", 2), item("C", 3));
    ctx.bridge = bridgeAnswering(sceneStatus(true, 7, 8));
    const counts = text(await call("table_status"));
    expect(counts).toMatch(/out of sync/i);
    for (const n of [7, 8, 3])
      expect(counts).toMatch(new RegExp(`\\b${String(n)}\\b`));

    for (const [label, response] of [
      ["tokens differ", sceneStatus(true, 2, 3)],
      ["applied differs", sceneStatus(true, 3, 2)],
      ["DB differs", sceneStatus(true, 4, 4)],
      ["scene not ready", sceneStatus(false, 3, 3)],
    ] as const) {
      ctx.bridge = bridgeAnswering(response);
      expect(text(await call("table_status")), label).toMatch(/out of sync/i);
    }
  });

  it("`table_status` returns an `isError` result carrying the client's message when the client reports `not-connected` or `timeout` (AC3, AC4)", async () => {
    for (const [code, message] of [
      ["not-connected", "no Owlbear GM tab is connected to the bridge"],
      ["timeout", "the GM tab did not answer within 5000 ms"],
    ] as const) {
      ctx.bridge = bridgeAnswering({ ok: false, error: { code, message } });
      const r = await call("table_status");
      expect(r.isError, code).toBe(true);
      expect(text(r), code).toContain(message);
    }
  });
});
