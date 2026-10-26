// Extra cases, kept out of the contract file status.test.ts.
import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import { getTableStatus } from "./index.js";

describe("getTableStatus (extra cases)", () => {
  it("reports out of sync when the token count equals the encounter count but the applied count differs", async () => {
    const repo = {
      listInstances: () =>
        Array.from({ length: 3 }, (_, i) =>
          makeTestInstance({
            id: `id-${String(i)}`,
            encounterId: "enc",
            monsterKey: "srd-2024_shadow",
            displayName: `Shadow ${String(i)}`,
            maxHp: 10,
            currentHp: 10,
            createdAt: 1000 + i,
          }),
        ),
    };
    const table = {
      sceneStatus: () =>
        Promise.resolve({
          sceneReady: true,
          tokenCount: 3,
          appliedInstanceCount: 2,
        }),
      sceneMap: () => Promise.reject(new Error("not stubbed")),
      sceneTokens: () => Promise.reject(new Error("not stubbed")),
    };
    const status = await getTableStatus(repo, table);
    expect(status.encounterCount).toBe(3);
    expect(status.inSync).toBe(false);
  });
});
