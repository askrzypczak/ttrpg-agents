import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Monster } from "@ttrpg-agents/core";
import { MonsterLoadError, loadMonsters, loadSrdMonsters } from "./loader.js";

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
});

describe("SRD snapshot", () => {
  const index = loadSrdMonsters();

  it("has the full creature list with unique keys", () => {
    expect(index.monsters.length).toBeGreaterThanOrEqual(300);
    expect(new Set(index.monsters.map((m) => m.key)).size).toBe(
      index.monsters.length,
    );
    expect(index.monsters.every((m) => m.source === "srd-5.2")).toBe(true);
  });

  it("contains the shadow with known stats", () => {
    const shadow = index.byKey.get("srd-2024_shadow");
    expect(shadow?.ac).toBe(12);
    expect(shadow?.hp).toEqual({ average: 27, dice: "5d8 + 5" });
  });

  it("keeps usage limits such as recharge on dragon breath", () => {
    const dragon = index.byKey.get("srd-2024_adult-red-dragon");
    const breath = dragon?.sections.actions.find(
      (a) => a.name === "Fire Breath",
    );
    expect(breath?.usage).toEqual({ type: "RECHARGE_ON_ROLL", param: 5 });
  });

  it("is sorted by key so regeneration diffs stay clean", () => {
    const keys = index.monsters.map((m) => m.key);
    expect(keys).toEqual([...keys].sort());
  });
});
