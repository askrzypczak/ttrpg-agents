import { describe, expect, it } from "vitest";
import { monsterTypeName } from "./type-name.js";

const OGRE = "srd-2024_ogre";
const WOLF = "srd-2024_wolf";

describe("monsterTypeName", () => {
  it("monsterTypeName names a type by its first instance's display name without the number suffix", () => {
    const instances = [
      { monsterKey: WOLF, displayName: "Wolf 1" },
      { monsterKey: OGRE, displayName: "Ogre Chief" },
      { monsterKey: OGRE, displayName: "Ogre 2" },
      { monsterKey: OGRE, displayName: "Big Ogre 3" },
    ];

    expect(monsterTypeName(instances, WOLF)).toBe("Wolf");
    // The first instance of the type whose name ends in a number.
    expect(monsterTypeName(instances, OGRE)).toBe("Ogre");
    expect(
      monsterTypeName(
        [
          {
            monsterKey: "srd-2024_giant-spider",
            displayName: "Giant Spider 12",
          },
        ],
        "srd-2024_giant-spider",
      ),
    ).toBe("Giant Spider");
  });

  it("monsterTypeName falls back to the monster key when no instance of the type has a display name ending in a number", () => {
    const instances = [
      { monsterKey: WOLF, displayName: "Wolf 1" },
      { monsterKey: OGRE, displayName: "Grok" },
      { monsterKey: OGRE, displayName: "Ogre Chief" },
    ];

    expect(monsterTypeName(instances, OGRE)).toBe(OGRE);
    // No instance of the type at all.
    expect(monsterTypeName(instances, "srd-2024_owlbear")).toBe(
      "srd-2024_owlbear",
    );
    expect(monsterTypeName([], WOLF)).toBe(WOLF);
  });
});
