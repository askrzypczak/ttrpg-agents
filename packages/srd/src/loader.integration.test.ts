import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dndBeyondUrl, type Monster } from "@ttrpg-agents/engine";
import {
  MonsterLoadError,
  loadAliases,
  loadDndBeyondPages,
  loadMonsters,
  loadSrdMonsters,
} from "./loader.js";

function monster(key: string, name = key): Monster {
  return {
    key,
    name,
    source: "private",
    size: "medium",
    type: "beast",
    alignment: "unaligned",
    ac: 10,
    armorDetail: "",
    hp: { average: 5, dice: "1d8 + 1" },
    speeds: { walk: 30 },
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    initiativeModifier: 0,
    cr: 0,
    saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: {},
    senses: {},
    languages: "",
    damageVulnerabilities: [],
    damageResistances: [],
    damageImmunities: [],
    conditionImmunities: [],
    sections: {
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
    },
  };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "monsters-"));
}

function write(dir: string, file: string, data: unknown): string {
  const path = join(dir, file);
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
  return path;
}

describe("loadMonsters", () => {
  it("merges files and directories into one index", () => {
    const dir = tmp();
    const a = write(dir, "a.json", [monster("a"), monster("b")]);
    const privDir = tmp();
    write(privDir, "x.json", [monster("c")]);
    write(privDir, "y.json", [monster("d")]);
    write(privDir, "notes.txt", "ignored");
    const index = loadMonsters([{ path: a }, { path: privDir }]);
    expect(index.monsters.map((m) => m.key)).toEqual(["a", "b", "c", "d"]);
    expect(index.byKey.get("c")?.name).toBe("c");
  });

  it("throws on duplicate keys across sources", () => {
    const one = write(tmp(), "one.json", [monster("dup")]);
    const two = write(tmp(), "two.json", [monster("dup")]);
    expect(() => loadMonsters([{ path: one }, { path: two }])).toThrow(
      /duplicate monster key "dup"/,
    );
  });

  it("reports file path and monster key for invalid data", () => {
    const bad = { ...monster("broken"), ac: "twelve" };
    const path = write(tmp(), "bad.json", [monster("ok"), bad]);
    const err = (() => {
      try {
        loadMonsters([{ path }]);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(MonsterLoadError);
    expect((err as Error).message).toContain(path);
    expect((err as Error).message).toContain('"broken"');
    expect((err as Error).message).toContain("ac");
  });

  it("rejects unparseable JSON, non-arrays and missing paths", () => {
    const dir = tmp();
    const junk = write(dir, "junk.json", "{nope");
    const obj = write(dir, "obj.json", {});
    expect(() => loadMonsters([{ path: junk }])).toThrow(/invalid JSON/);
    expect(() => loadMonsters([{ path: obj }])).toThrow(/array/);
    expect(() => loadMonsters([{ path: join(dir, "missing") }])).toThrow(
      MonsterLoadError,
    );
  });

  it("load fails naming the monster key and hp.dice for an unparseable hp.dice", () => {
    const bad = { ...monster("bad-dice"), hp: { average: 5, dice: "lots" } };
    const path = write(tmp(), "bad-dice.json", [monster("ok"), bad]);
    const err = (() => {
      try {
        loadMonsters([{ path }]);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(MonsterLoadError);
    expect((err as Error).message).toContain('"bad-dice"');
    expect((err as Error).message).toContain("hp.dice");
  });
});

describe("SRD snapshot", () => {
  it("loadSrdMonsters does not throw: every SRD monster passes the refined schema", () => {
    expect(() => loadSrdMonsters()).not.toThrow();
  });

  // Lazy so a load failure shows as the test above failing, not a collection error.
  let loaded: ReturnType<typeof loadSrdMonsters> | undefined;
  const srd = () => (loaded ??= loadSrdMonsters());

  it("has the full creature list with unique keys", () => {
    const index = srd();
    expect(index.monsters.length).toBeGreaterThanOrEqual(300);
    expect(new Set(index.monsters.map((m) => m.key)).size).toBe(
      index.monsters.length,
    );
    expect(index.monsters.every((m) => m.source === "srd-5.2")).toBe(true);
  });

  it("contains the shadow with known stats", () => {
    const shadow = srd().byKey.get("srd-2024_shadow");
    expect(shadow?.ac).toBe(12);
    expect(shadow?.hp).toEqual({ average: 27, dice: "5d8 + 5" });
  });

  it("keeps usage limits such as recharge on dragon breath", () => {
    const dragon = srd().byKey.get("srd-2024_adult-red-dragon");
    const breath = dragon?.sections.actions.find(
      (a) => a.name === "Fire Breath",
    );
    expect(breath?.usage).toEqual({ type: "RECHARGE_ON_ROLL", param: 5 });
  });

  it("is sorted by key so regeneration diffs stay clean", () => {
    const keys = srd().monsters.map((m) => m.key);
    expect(keys).toEqual([...keys].sort());
  });

  it("every committed alias resolves to a monster in the snapshot", () => {
    const index = srd();
    expect(index.aliases.size).toBeGreaterThan(0);
    expect(index.aliases.get("Thug")).toBe("srd-2024_tough");
    for (const [name, key] of index.aliases) {
      expect(index.byKey.has(key), `${name} -> ${key}`).toBe(true);
    }
  });

  it("the SRD snapshot's D&D Beyond URLs for Aboleth, Goblin Warrior, Adult Red Dragon, Will-o'-Wisp and Warhorse Skeleton are their 2024 pages", () => {
    const index = srd();
    const url = (key: string) => {
      const m = index.byKey.get(key);
      expect(m, key).toBeDefined();
      return dndBeyondUrl(index, m as Monster);
    };
    expect({
      aboleth: url("srd-2024_aboleth"),
      goblinWarrior: url("srd-2024_goblin-warrior"),
      adultRedDragon: url("srd-2024_adult-red-dragon"),
      willOWisp: url("srd-2024_will-o-wisp"),
      warhorseSkeleton: url("srd-2024_warhorse-skeleton"),
    }).toEqual({
      aboleth: "https://www.dndbeyond.com/monsters/5194867-aboleth",
      goblinWarrior:
        "https://www.dndbeyond.com/monsters/5195050-goblin-warrior",
      adultRedDragon:
        "https://www.dndbeyond.com/monsters/5194875-adult-red-dragon",
      willOWisp: "https://www.dndbeyond.com/monsters/5195270-will-o-wisp",
      warhorseSkeleton:
        "https://www.dndbeyond.com/monsters/5195257-warhorse-skeleton",
    });
  });

  it("every SRD monster has a D&D Beyond URL except Giant Fly, which has no 2024 page", () => {
    const index = srd();
    const without = index.monsters
      .filter((m) => dndBeyondUrl(index, m) === undefined)
      .map((m) => m.key);
    expect(without).toEqual(["srd-2024_giant-fly"]);
  });
});

describe("loadAliases", () => {
  const base = () =>
    loadMonsters([
      {
        path: write(tmp(), "monsters.json", [
          monster("srd-2024_tough", "Tough"),
          monster("srd-2024_warrior-veteran", "Warrior Veteran"),
        ]),
      },
    ]);

  function loadError(entries: unknown): { err: unknown; file: string } {
    const file = write(tmp(), "aliases.json", entries);
    const index = base();
    try {
      loadAliases(file, index);
    } catch (e) {
      return { err: e, file };
    }
    return { err: undefined, file };
  }

  it("loadAliases fails naming the file and entry when an alias points to an unknown key", () => {
    const { err, file } = loadError([
      { name: "Thug", key: "srd-2024_tough", note: "SRD 5.1 name" },
      { name: "Bandit Boss", key: "srd-2024_nope", note: "SRD 5.1 name" },
    ]);
    expect(err).toBeInstanceOf(MonsterLoadError);
    expect((err as Error).message).toContain(file);
    expect((err as Error).message).toContain("Bandit Boss");
  });

  it("loadAliases fails naming the file and entry when an alias is the current name of a monster", () => {
    const { err, file } = loadError([
      { name: "Thug", key: "srd-2024_tough", note: "SRD 5.1 name" },
      {
        name: "warrior veteran",
        key: "srd-2024_tough",
        note: "SRD 5.1 name",
      },
    ]);
    expect(err).toBeInstanceOf(MonsterLoadError);
    expect((err as Error).message).toContain(file);
    expect((err as Error).message).toContain("warrior veteran");
  });

  it("loadAliases fails naming the file and entry when an old name appears twice", () => {
    const { err, file } = loadError([
      { name: "Thug", key: "srd-2024_tough", note: "SRD 5.1 name" },
      { name: "Veteran", key: "srd-2024_warrior-veteran", note: "SRD 5.1" },
      { name: "THUG", key: "srd-2024_warrior-veteran", note: "SRD 5.1 name" },
    ]);
    expect(err).toBeInstanceOf(MonsterLoadError);
    expect((err as Error).message).toContain(file);
    expect((err as Error).message).toContain("THUG");
  });

  it("loadAliases fails naming the file and entry when the file is not an array or an entry is malformed", () => {
    const notArray = loadError({});
    expect(notArray.err).toBeInstanceOf(MonsterLoadError);
    expect((notArray.err as Error).message).toContain(notArray.file);

    const malformed = loadError([{ key: "srd-2024_tough", note: "x" }]);
    expect(malformed.err).toBeInstanceOf(MonsterLoadError);
    expect((malformed.err as Error).message).toContain(malformed.file);
    expect((malformed.err as Error).message).toContain("#0");
  });
});

describe("loadDndBeyondPages", () => {
  const base = () =>
    loadMonsters([
      {
        path: write(tmp(), "monsters.json", [
          monster("srd-2024_aboleth", "Aboleth"),
          monster("srd-2024_goblin-warrior", "Goblin Warrior"),
        ]),
      },
    ]);

  function loadError(data: unknown): { err: unknown; file: string } {
    const file = write(tmp(), "dndbeyond.json", data);
    const index = base();
    try {
      loadDndBeyondPages(file, index);
    } catch (e) {
      return { err: e, file };
    }
    return { err: undefined, file };
  }

  it("loadDndBeyondPages fails naming the file and key when a key is not in the snapshot", () => {
    const { err, file } = loadError({
      "srd-2024_aboleth": "5194867-aboleth",
      "srd-2024_nope": "5199999-nope",
    });
    expect(err).toBeInstanceOf(MonsterLoadError);
    expect((err as Error).message).toContain(file);
    expect((err as Error).message).toContain("srd-2024_nope");
  });

  it("loadDndBeyondPages fails naming the file when the file is not an object or a page is not `<id>-<slug>`", () => {
    const cases: unknown[] = [
      ["srd-2024_aboleth", "5194867-aboleth"],
      { "srd-2024_aboleth": "https://evil.example/x" },
      { "srd-2024_aboleth": "../5194867-aboleth" },
      { "srd-2024_aboleth": 5194867 },
    ];
    for (const data of cases) {
      const { err, file } = loadError(data);
      expect(err, JSON.stringify(data)).toBeInstanceOf(MonsterLoadError);
      expect((err as Error).message, JSON.stringify(data)).toContain(file);
    }
  });
});
