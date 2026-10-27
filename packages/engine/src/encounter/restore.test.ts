import { describe, expect, it } from "vitest";
import { makeTestInstance } from "../testing/index.js";
import type { ChangeOrigin } from "./origin.js";
import type { RemovedInstance } from "./repository.js";
import { canRestoreEncounter } from "./restore.js";

const removedBy: ChangeOrigin = { source: "mcp", commandId: "cmd-1" };

const removed = (n: number, cleared: boolean): RemovedInstance => ({
  instance: makeTestInstance({
    id: `wolf-${String(n)}`,
    monsterKey: "srd-2024_wolf",
    displayName: `Wolf ${String(n)}`,
    createdAt: n,
  }),
  removedBy,
  cleared,
});

const repoHolding = (list: RemovedInstance[]) => ({
  listRemovedInstances: () => list,
});

describe("canRestoreEncounter", () => {
  it("canRestoreEncounter is true while the last clear left monsters not restored since, and false otherwise", () => {
    // The last clear's monsters, not restored since.
    expect(canRestoreEncounter(repoHolding([removed(1, true)]))).toBe(true);
    expect(
      canRestoreEncounter(repoHolding([removed(1, false), removed(2, true)])),
    ).toBe(true);

    // Nothing removed, or only monsters removed one by one.
    expect(canRestoreEncounter(repoHolding([]))).toBe(false);
    expect(
      canRestoreEncounter(repoHolding([removed(1, false), removed(2, false)])),
    ).toBe(false);
  });
});
