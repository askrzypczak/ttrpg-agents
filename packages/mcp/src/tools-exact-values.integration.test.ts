import type {
  ChangeOrigin,
  EncounterRepository,
  MonsterInstance,
  NewMonsterInstance,
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

const origin: ChangeOrigin = { source: "table", commandId: "seed" };

const SHADOW = "srd-2024_shadow";

let ctx: ToolContext;

beforeEach(() => {
  ctx = {
    table: {
      sceneStatus: () => Promise.reject(new Error("not stubbed")),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
      mapImage: () => Promise.reject(new Error("not stubbed")),
    },
    repo: new SqliteEncounterRepository(openDatabase(":memory:")),
    maps: new SqliteMapRepository(openDatabase(":memory:")),
    monsters: loadSrdMonsters(),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "group",
    newCommandId: () => "command",
  };
});

async function call(name: string, args: unknown): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(ctx, args);
}

function text(r: ToolResult): string {
  return r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
}

function seed(...items: NewMonsterInstance[]): MonsterInstance[] {
  return ctx.repo.addInstances(() => items, origin);
}

function item(
  displayName: string,
  maxHp: number,
  armorClass: number | null = null,
): NewMonsterInstance {
  return { monsterKey: SHADOW, displayName, maxHp, initiative: 5, armorClass };
}

/** Delegates to `inner`, but listInstances keeps returning `snapshot`. */
function staleRepo(
  inner: EncounterRepository,
  snapshot: MonsterInstance[],
): EncounterRepository {
  return {
    getOrCreateActiveEncounter: () => inner.getOrCreateActiveEncounter(),
    listInstances: () => snapshot.map((i) => ({ ...i })),
    addInstances: (build, o) => inner.addInstances(build, o),
    applyDamage: (id, amount, o) => inner.applyDamage(id, amount, o),
    applyHealing: (id, amount, o) => inner.applyHealing(id, amount, o),
    removeInstances: (ids, o) => inner.removeInstances(ids, o),
    listRemovedInstances: () => inner.listRemovedInstances(),
    restoreInstances: (ids, name, o) => inner.restoreInstances(ids, name, o),
    renameInstance: (id, name, o) => inner.renameInstance(id, name, o),
    setInitiative: (id, n, o) => inner.setInitiative(id, n, o),
    setHp: (id, hp, o) => inner.setHp(id, hp, o),
    setMaxHp: (id, maxHp, o) => inner.setMaxHp(id, maxHp, o),
    setArmorClass: (id, ac, o) => inner.setArmorClass(id, ac, o),
    setStatsVisible: (id, visible, o) => inner.setStatsVisible(id, visible, o),
    clearEncounter: (o) => {
      inner.clearEncounter(o);
    },
  };
}

function view(i: MonsterInstance): Record<string, unknown> {
  return {
    id: i.id,
    name: i.displayName,
    monsterKey: i.monsterKey,
    hp: i.currentHp,
    maxHp: i.maxHp,
    initiative: i.initiative,
  };
}

const stored = () =>
  ctx.repo
    .listInstances()
    .map((i) => [i.displayName, i.currentHp, i.maxHp, i.armorClass]);

describe("set_hp", () => {
  it("set_hp by id sets the exact current HP and reports HP before and after", async () => {
    const [shadow] = seed(item("Shadow 1", 9));
    if (!shadow) throw new Error("seed failed");

    const r = await call("set_hp", { target: shadow.id, hp: 4 });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe("Shadow 1: HP 9 -> 4/9");
    expect(ctx.repo.listInstances()[0]?.currentHp).toBe(4);
    expect(r.structuredContent).toEqual({
      instance: { ...view(shadow), hp: 4 },
      before: view(shadow),
    });
  });

  it("set_hp by exact name above max HP reports the engine's clamped value", async () => {
    const [shadow] = seed(item("Shadow 1", 10));
    ctx.repo.applyDamage(shadow?.id ?? "", 4, origin);

    const r = await call("set_hp", { target: "Shadow 1", hp: 25 });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe("Shadow 1: HP 6 -> 10/10");
    expect(ctx.repo.listInstances()[0]?.currentHp).toBe(10);
  });

  it("set_hp reports the HP read inside the write, not the HP listed before it", async () => {
    seed(item("Shadow 1", 10));
    const inner = ctx.repo;
    const snapshot = inner.listInstances();
    // Another writer changes HP after the tool listed the encounter.
    inner.applyDamage(snapshot[0]?.id ?? "", 3, origin);
    ctx.repo = staleRepo(inner, snapshot);

    const r = await call("set_hp", { target: "Shadow 1", hp: 4 });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe("Shadow 1: HP 7 -> 4/10");
    expect(inner.listInstances()[0]?.currentHp).toBe(4);
  });
});

describe("set_max_hp", () => {
  it("set_max_hp sets the exact max HP and reports max HP and HP before and after, with HP lowered to the new max", async () => {
    const [wolf] = seed(item("Wolf 1", 20));
    if (!wolf) throw new Error("seed failed");

    const r = await call("set_max_hp", { target: wolf.id, maxHp: 12 });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe("Wolf 1: max HP 20 -> 12, HP 20 -> 12/12");
    expect(stored()).toEqual([["Wolf 1", 12, 12, null]]);
    expect(r.structuredContent).toEqual({
      instance: { ...view(wolf), hp: 12, maxHp: 12 },
      before: view(wolf),
    });
  });
});

describe("reset_max_hp", () => {
  it("reset_max_hp with hp average by id and by exact name sets each monster's max HP to its average and reports max HP and HP before and after, one line per monster", async () => {
    // The Shadow's statblock average is 27.
    const [full, damaged] = seed(item("Shadow 1", 20), item("Shadow 2", 30));
    if (!full || !damaged) throw new Error("seed failed");
    ctx.repo.applyDamage(damaged.id, 10, origin);

    const r = await call("reset_max_hp", {
      targets: [full.id, "Shadow 2"],
      hp: "average",
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "Shadow 1: max HP 20 -> 27, HP 20 -> 27/27",
        "Shadow 2: max HP 30 -> 27, HP 20 -> 20/27",
      ].join("\n"),
    );
    expect(stored()).toEqual([
      ["Shadow 1", 27, 27, null],
      ["Shadow 2", 20, 27, null],
    ]);
  });

  it("reset_max_hp with hp rolled reports each monster's line and a Rolls line per HP roll", async () => {
    // Each call yields the next counter value; each die shows it plus one.
    let n = 0;
    ctx.rng = { nextInt: (max) => n++ % max };
    // Shadow HP is 5d8 + 5: 1+2+3+4+5+5 = 20, then 6+7+8+1+2+5 = 29.
    const [full, damaged] = seed(item("Shadow 1", 12), item("Shadow 2", 30));
    if (!full || !damaged) throw new Error("seed failed");
    ctx.repo.applyDamage(damaged.id, 10, origin);

    const r = await call("reset_max_hp", {
      targets: ["Shadow 1", "Shadow 2"],
      hp: "rolled",
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe(
      [
        "Shadow 1: max HP 12 -> 20, HP 12 -> 20/20",
        "Shadow 2: max HP 30 -> 29, HP 20 -> 20/29",
        "",
        "Rolls:",
        "- Shadow 1 HP: 5d8 + 5 = 20",
        "- Shadow 2 HP: 5d8 + 5 = 29",
      ].join("\n"),
    );
    expect(stored()).toEqual([
      ["Shadow 1", 20, 20, null],
      ["Shadow 2", 20, 29, null],
    ]);
  });

  it("reset_max_hp fails and changes nothing when a target is unknown or ambiguous", async () => {
    seed(item("Shadow 1", 20), item("Twin", 10), item("Twin", 10));
    const before = stored();

    const unknown = await call("reset_max_hp", {
      targets: ["Shadow 1", "Ghost"],
      hp: "average",
    });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('Unknown target "Ghost"');
    expect(text(unknown)).toMatch(/Nothing was changed\.$/);

    const ambiguous = await call("reset_max_hp", {
      targets: ["Shadow 1", "Twin"],
      hp: "rolled",
    });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toContain("Ambiguous");
    expect(text(ambiguous)).toMatch(/Nothing was changed\.$/);

    expect(stored()).toEqual(before);
  });

  it("reset_max_hp returns each monster after and before the reset and the roll log as structured content", async () => {
    // The Shadow's statblock average is 27.
    const [full, damaged] = seed(item("Shadow 1", 20), item("Shadow 2", 30));
    if (!full || !damaged) throw new Error("seed failed");
    ctx.repo.applyDamage(damaged.id, 10, origin);

    const average = await call("reset_max_hp", {
      targets: [full.id, damaged.id],
      hp: "average",
    });

    expect(average.structuredContent).toEqual({
      instances: [
        { ...view(full), hp: 27, maxHp: 27 },
        { ...view(damaged), hp: 20, maxHp: 27 },
      ],
      before: [
        { ...view(full), hp: 20, maxHp: 20 },
        { ...view(damaged), hp: 20, maxHp: 30 },
      ],
      rolls: [],
    });

    const rolled = await call("reset_max_hp", {
      targets: [full.id, damaged.id],
      hp: "rolled",
    });

    expect(rolled.structuredContent).toMatchObject({
      rolls: [{ label: "Shadow 1 HP" }, { label: "Shadow 2 HP" }],
    });
  });
});

describe("set_armor_class", () => {
  it("set_armor_class by id sets the exact armor class and reports AC before and after", async () => {
    const [shadow] = seed(item("Shadow 1", 10, 12));
    if (!shadow) throw new Error("seed failed");

    const r = await call("set_armor_class", {
      target: shadow.id,
      armorClass: 15,
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe("Shadow 1: AC 12 -> 15");
    expect(ctx.repo.listInstances()[0]?.armorClass).toBe(15);
    expect(r.structuredContent).toEqual({
      instance: view(shadow),
      armorClass: 15,
      before: 12,
    });
  });

  it("set_armor_class by exact name reports unset as the before value when the monster had no armor class", async () => {
    seed(item("Shadow 1", 10));

    const r = await call("set_armor_class", {
      target: "Shadow 1",
      armorClass: 14,
    });

    expect(r.isError).toBeUndefined();
    expect(text(r)).toBe("Shadow 1: AC unset -> 14");
    expect(r.structuredContent?.["before"]).toBeNull();
    expect(r.structuredContent?.["armorClass"]).toBe(14);
    expect(ctx.repo.listInstances()[0]?.armorClass).toBe(14);
  });
});

const exactValueCalls: [string, string, number][] = [
  ["set_hp", "hp", 3],
  ["set_max_hp", "maxHp", 15],
  ["set_armor_class", "armorClass", 16],
];

describe("exact value failures", () => {
  it("set_hp, set_max_hp and set_armor_class fail on an unknown or an ambiguous target and change nothing", async () => {
    seed(item("Twin", 10, 12), item("Twin", 10, 12));
    const before = stored();

    for (const [name, key, value] of exactValueCalls) {
      const unknown = await call(name, { target: "Ghost", [key]: value });
      expect(unknown.isError, name).toBe(true);
      expect(text(unknown), name).toContain('Unknown target "Ghost"');

      const ambiguous = await call(name, { target: "Twin", [key]: value });
      expect(ambiguous.isError, name).toBe(true);
      expect(text(ambiguous), name).toContain("Ambiguous");
    }
    expect(stored()).toEqual(before);
  });

  it("set_hp, set_max_hp and set_armor_class reject a fractional value as invalid arguments and change nothing", async () => {
    seed(item("Shadow 1", 10, 12));
    const before = stored();

    for (const [name, key] of exactValueCalls) {
      const r = await call(name, { target: "Shadow 1", [key]: 2.5 });
      expect(r.isError, name).toBe(true);
      expect(text(r), name).toMatch(/^Invalid arguments/);
    }
    expect(stored()).toEqual(before);

    // The same calls with a whole number are accepted.
    for (const [name, key, value] of exactValueCalls) {
      const r = await call(name, { target: "Shadow 1", [key]: value });
      expect(r.isError, name).toBeUndefined();
    }
  });
});
