import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMonsterByKey, searchMonsters } from "@ttrpg-agents/engine";
import { loadSrdMonsters } from "./loader.js";

const index = loadSrdMonsters();
const names = (q: string) => searchMonsters(index, q).map((m) => m.name);

describe("searchMonsters", () => {
  it("finds the shadow case-insensitively", () => {
    for (const q of ["Shadow", "SHADOW", "shadow", "  shadow "]) {
      expect(names(q)).toEqual(["Shadow"]);
    }
  });

  it("tolerates plurals", () => {
    expect(names("shadows")).toEqual(["Shadow"]);
    expect(names("harpies")).toContain("Harpy"); // -ies
    expect(names("mummies")).toContain("Mummy");
    expect(names("rexes")).toContain("Tyrannosaurus Rex"); // -es
    expect(names("ogres")[0]).toBe("Ogre"); // plain -s
  });

  it("handles -ves plurals", () => {
    expect(names("wolves")[0]).toBe("Wolf");
    expect(names("wolves")).toContain("Dire Wolf");
  });

  it("applies the short -es stem only after sibilants", () => {
    // "mag" must not be tried, or Magma Mephit / Magmin would match
    expect(names("mages")).toEqual(["Mage", "Archmage"]);
  });

  it("ranks exact, then prefix, then word, then substring", () => {
    expect(names("wolf")).toEqual([
      "Wolf",
      "Dire Wolf",
      "Winter Wolf",
      "Giant Wolf Spider",
      "Werewolf", // substring only, so last
    ]);
    const dragon = names("dragon");
    expect(dragon[0]).toBe("Dragon Turtle"); // prefix before word matches
    expect(dragon).toContain("Adult Red Dragon");
    // substring matches come last
    const ogre = names("ogre");
    expect(ogre.slice(0, 2)).toEqual(["Ogre", "Ogre Zombie"]);
  });

  it("separates near-miss names sharing a prefix", () => {
    expect(names("sha")).toEqual(
      expect.arrayContaining(["Shadow", "Shambling Mound"]),
    );
    expect(names("shad")).toEqual(["Shadow"]);
    expect(names("shamb")).toEqual(["Shambling Mound"]);
  });

  it("returns [] when nothing matches or the query is blank", () => {
    expect(searchMonsters(index, "zzzqx")).toEqual([]);
    expect(searchMonsters(index, "")).toEqual([]);
    expect(searchMonsters(index, "   ")).toEqual([]);
  });

  it("does not treat regex characters specially", () => {
    expect(searchMonsters(index, ".*")).toEqual([]);
  });
});

describe("getMonsterByKey", () => {
  it("returns the monster for a known key", () => {
    expect(getMonsterByKey(index, "srd-2024_shadow")?.name).toBe("Shadow");
  });

  it("returns undefined for an unknown key (names are not keys)", () => {
    expect(getMonsterByKey(index, "srd-2024_nope")).toBeUndefined();
    expect(getMonsterByKey(index, "Shadow")).toBeUndefined();
  });
});

describe("SRD attribution", () => {
  it("ships an ATTRIBUTION.md with the CC-BY-4.0 license URL", () => {
    const text = readFileSync(
      new URL("../data/srd-5.2/ATTRIBUTION.md", import.meta.url),
      "utf8",
    );
    expect(text).toContain(
      "https://creativecommons.org/licenses/by/4.0/legalcode",
    );
    expect(text).toContain("System Reference Document 5.2");
    expect(text).toContain("No endorsement by Wizards of the Coast");
  });
});
