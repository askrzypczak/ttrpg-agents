import { describe, expect, it } from "vitest";
import { makeTestInstance, makeTestMonsterIndex } from "../testing/index.js";
import type { ChangeOrigin } from "./origin.js";
import type { EncounterRepository, RemovedInstance } from "./repository.js";
import {
  RestoreMonstersError,
  canRestoreEncounter,
  restoreEncounter,
} from "./restore.js";

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

describe("restoreEncounter", () => {
  it("restoreEncounter of an instance whose stored creature is quarantined throws RestoreMonstersError unknown_monster naming the quarantine reason", () => {
    const quarantine = {
      key: "homebrew_thornling",
      message:
        'Stored creature "homebrew_thornling" is quarantined: its statblock\'s key is "homebrew_bramble"',
    };
    const monsters = {
      ...makeTestMonsterIndex([]),
      quarantined: () => [quarantine],
    };
    const thornling: RemovedInstance = {
      instance: makeTestInstance({
        id: "thornling-1",
        monsterKey: "homebrew_thornling",
        displayName: "Thornling 1",
      }),
      removedBy,
      cleared: true,
    };
    const repo = repoHolding([thornling]) as unknown as EncounterRepository;

    let error: unknown;
    try {
      restoreEncounter({ repo, monsters }, removedBy);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestoreMonstersError);
    expect((error as RestoreMonstersError).code).toBe("unknown_monster");
    expect((error as RestoreMonstersError).message).toContain(
      quarantine.message,
    );
  });
});
