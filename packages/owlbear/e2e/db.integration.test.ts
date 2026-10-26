import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChangeOrigin } from "@ttrpg-agents/engine";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { afterEach, expect, it } from "vitest";
import {
  SHADOW_IDS,
  e2eDbPath,
  listE2eInstanceIds,
  restoreE2eSeed,
  seedE2eDatabase,
} from "./db.js";

// Real SQLite files in temp dirs, removed after each test.
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const origin: ChangeOrigin = { source: "mcp", commandId: "spec" };

function withRepo<T>(
  dir: string,
  use: (repo: SqliteEncounterRepository) => T,
): T {
  const db = openDatabase(e2eDbPath(dir));
  try {
    return use(new SqliteEncounterRepository(db));
  } finally {
    db.close();
  }
}

it("restoreE2eSeed puts the five shadows back after a removal and a clear", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-db-"));
  created.push(dir);
  seedE2eDatabase(dir);
  withRepo(dir, (repo) => {
    repo.applyDamage(SHADOW_IDS[0]!, 5, origin);
    repo.removeInstances([SHADOW_IDS[1]!], origin);
    repo.clearEncounter(origin);
  });
  // The clear keeps its rows, under the ids the reseed adds again.
  expect(
    withRepo(dir, (repo) =>
      repo
        .listRemovedInstances()
        .map((r) => r.instance.id)
        .sort(),
    ),
  ).toEqual(SHADOW_IDS.filter((id) => id !== SHADOW_IDS[1]).sort());

  restoreE2eSeed(dir);

  expect(listE2eInstanceIds(dir)).toEqual(SHADOW_IDS);
  const live = withRepo(dir, (repo) => repo.listInstances());
  expect(live.map((i) => [i.displayName, i.currentHp, i.maxHp])).toEqual(
    SHADOW_IDS.map((_, i) => [`Shadow ${String(i + 1)}`, 16, 16]),
  );
  expect(withRepo(dir, (repo) => repo.listRemovedInstances())).toEqual([]);
});
