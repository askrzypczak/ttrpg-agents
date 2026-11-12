import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseProbe } from "./database-probe.js";
import { openDatabase } from "./db.js";
import { LATEST_VERSION, getUserVersion } from "./migrations.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ttrpg-probe-"));
  dirs.push(dir);
  return dir;
}

/** A migrated database at `path`, then its user_version set to `version`. */
function databaseAt(path: string, version: number): void {
  const db = openDatabase(path);
  db.exec(`PRAGMA user_version = ${String(version)}`);
  db.close();
}

/** The user_version and the schema, read with a plain connection. */
function snapshot(path: string): { version: number; schema: unknown[] } {
  const db = new DatabaseSync(path);
  try {
    return {
      version: getUserVersion(db),
      schema: db
        .prepare(
          "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
        )
        .all(),
    };
  } finally {
    db.close();
  }
}

describe("database probe", () => {
  it("a missing file is reported missing with the expected version, and neither the file nor its directory is created", () => {
    const dir = tempDir();
    const parent = join(dir, "not-there");
    const path = join(parent, "encounters.db");

    const facts = createDatabaseProbe(path).check();

    expect(facts).toEqual({
      path,
      expectedVersion: LATEST_VERSION,
      file: { kind: "missing" },
    });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(parent)).toBe(false);
  });

  it("a database at this build's version is reported found with that version", () => {
    const path = join(tempDir(), "encounters.db");
    openDatabase(path).close();

    expect(createDatabaseProbe(path).check()).toEqual({
      path,
      expectedVersion: LATEST_VERSION,
      file: { kind: "found", version: LATEST_VERSION },
    });
  });

  it("a database with a newer user_version reports its version and this build's", () => {
    const path = join(tempDir(), "encounters.db");
    databaseAt(path, LATEST_VERSION + 3);

    expect(createDatabaseProbe(path).check()).toEqual({
      path,
      expectedVersion: LATEST_VERSION,
      file: { kind: "found", version: LATEST_VERSION + 3 },
    });
  });

  it("an older database is reported with its version and is not migrated", () => {
    const path = join(tempDir(), "encounters.db");
    databaseAt(path, LATEST_VERSION - 1);
    const before = snapshot(path);

    const facts = createDatabaseProbe(path).check();

    expect(facts).toEqual({
      path,
      expectedVersion: LATEST_VERSION,
      file: { kind: "found", version: LATEST_VERSION - 1 },
    });
    expect(snapshot(path)).toEqual(before);
    expect(before.version).toBe(LATEST_VERSION - 1);
  });

  it("a file that is not a SQLite database is reported unreadable with SQLite's reason", () => {
    const path = join(tempDir(), "encounters.db");
    writeFileSync(path, "this is not a database, just some text\n".repeat(50));

    const facts = createDatabaseProbe(path).check();

    expect(facts.path).toBe(path);
    expect(facts.expectedVersion).toBe(LATEST_VERSION);
    expect(facts.file.kind).toBe("unreadable");
    if (facts.file.kind !== "unreadable") return;
    expect(facts.file.reason).toMatch(/not a database/i);
  });
});
