import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Rng } from "../dice/rng.js";
import { loadSrdMonsters } from "../monsters/index.js";
import {
  addMonsters,
  createNumberedNaming,
  type AddMonstersDeps,
  type NamingStrategy,
} from "./add-monsters.js";
import { openDatabase } from "./db.js";
import type { EncounterRepository } from "./repository.js";
import { SqliteEncounterRepository } from "./sqlite-repository.js";

const SHADOW = "srd-2024_shadow";
const monsters = loadSrdMonsters();
const rng: Rng = { nextInt: () => 0 };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function deps(
  repo: EncounterRepository,
  naming?: NamingStrategy,
): AddMonstersDeps {
  return {
    repo,
    monsters,
    rng,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    ...(naming ? { naming } : {}),
  };
}

describe("addMonsters across connections", () => {
  it("a concurrent add is blocked while another add holds the write transaction, and the next add continues the numbering with no duplicate names", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-add-"));
    dirs.push(dir);
    const path = join(dir, "enc.db");
    const a = openDatabase(path);
    // Opened directly so a locked database fails at once instead of waiting.
    const b = new DatabaseSync(path, { timeout: 0 });
    const repoA = new SqliteEncounterRepository(a);
    const repoB = new SqliteEncounterRepository(b);

    let concurrentError: unknown;
    let attempted = false;
    const numbered = createNumberedNaming();
    // Runs during A's naming step: another process adds a shadow right then.
    const racing: NamingStrategy = (ctx) => {
      if (!attempted) {
        attempted = true;
        try {
          addMonsters(deps(repoB), [
            { monster: SHADOW, count: 1, hp: "average" },
          ]);
        } catch (err) {
          concurrentError = err;
        }
      }
      return numbered(ctx);
    };

    const first = addMonsters(deps(repoA, racing), [
      { monster: SHADOW, count: 1, hp: "average" },
    ]);
    expect(attempted).toBe(true);
    // SQLITE_BUSY: B could not take the write lock A was holding.
    expect(concurrentError).toMatchObject({ errcode: 5 });

    const second = addMonsters(deps(repoB), [
      { monster: SHADOW, count: 1, hp: "average" },
    ]);
    expect(first.instances.map((i) => i.name)).toEqual(["Shadow 1"]);
    expect(second.instances.map((i) => i.name)).toEqual(["Shadow 2"]);
    expect(repoA.listInstances().map((i) => i.displayName)).toEqual([
      "Shadow 1",
      "Shadow 2",
    ]);
    b.close();
    a.close();
  });
});
