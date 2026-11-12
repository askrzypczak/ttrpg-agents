import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

    const facts = createDatabaseProbe(
      path,
      join(dirname(path), "backups"),
    ).check();

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

    expect(
      createDatabaseProbe(path, join(dirname(path), "backups")).check(),
    ).toEqual({
      path,
      expectedVersion: LATEST_VERSION,
      file: { kind: "found", version: LATEST_VERSION },
    });
  });

  it("a database with a newer user_version reports its version and this build's", () => {
    const path = join(tempDir(), "encounters.db");
    databaseAt(path, LATEST_VERSION + 3);

    expect(
      createDatabaseProbe(path, join(dirname(path), "backups")).check(),
    ).toEqual({
      path,
      expectedVersion: LATEST_VERSION,
      file: { kind: "found", version: LATEST_VERSION + 3 },
    });
  });

  it("an older database is reported with its version and is not migrated", () => {
    const path = join(tempDir(), "encounters.db");
    databaseAt(path, LATEST_VERSION - 1);
    const before = snapshot(path);

    const facts = createDatabaseProbe(
      path,
      join(dirname(path), "backups"),
    ).check();

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

    const facts = createDatabaseProbe(
      path,
      join(dirname(path), "backups"),
    ).check();

    expect(facts.path).toBe(path);
    expect(facts.expectedVersion).toBe(LATEST_VERSION);
    expect(facts.file.kind).toBe("unreadable");
    if (facts.file.kind !== "unreadable") return;
    expect(facts.file.reason).toMatch(/not a database/i);
  });

  it("checkBackups names the encounters-*.db file with the latest modification time and gives that time in ISO 8601 UTC, ignoring other files in the directory", () => {
    const dir = tempDir();
    const backupDir = join(dir, "backups");
    mkdirSync(backupDir);
    const at = (path: string, iso: string) => {
      writeFileSync(path, "backup");
      const time = new Date(iso);
      utimesSync(path, time, time);
    };
    const older = join(backupDir, "encounters-20261110T080000Z.db");
    const newest = join(backupDir, "encounters-20261101T080000Z.db");
    at(older, "2026-11-10T08:00:00.000Z");
    at(newest, "2026-11-11T07:30:00.000Z");
    at(join(backupDir, "encounters.db"), "2026-11-12T09:00:00.000Z");
    at(
      join(backupDir, "encounters-20261112T090000Z.db-wal"),
      "2026-11-12T09:00:00.000Z",
    );
    at(join(backupDir, "notes.txt"), "2026-11-12T09:00:00.000Z");
    at(
      join(backupDir, "other-20261112T090000Z.db"),
      "2026-11-12T09:00:00.000Z",
    );
    mkdirSync(join(backupDir, "encounters-20261112T100000Z.db"));
    const subdir = new Date("2026-11-12T10:00:00.000Z");
    utimesSync(
      join(backupDir, "encounters-20261112T100000Z.db"),
      subdir,
      subdir,
    );

    const facts = createDatabaseProbe(
      join(dir, "encounters.db"),
      backupDir,
    ).checkBackups();

    expect(facts).toEqual({
      dir: backupDir,
      newest: {
        kind: "found",
        path: newest,
        takenAt: "2026-11-11T07:30:00.000Z",
      },
    });
  });

  it("checkBackups reports none for a missing or empty backup directory and creates no directory", () => {
    const dir = tempDir();
    const missing = join(dir, "not-there", "backups");

    expect(
      createDatabaseProbe(join(dir, "encounters.db"), missing).checkBackups(),
    ).toEqual({ dir: missing, newest: { kind: "none" } });
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(join(dir, "not-there"))).toBe(false);

    const empty = join(dir, "empty");
    mkdirSync(empty);
    expect(
      createDatabaseProbe(join(dir, "encounters.db"), empty).checkBackups(),
    ).toEqual({ dir: empty, newest: { kind: "none" } });
  });

  it("checkBackups reports unreadable with the reason when the backup directory path is a file", () => {
    const dir = tempDir();
    const backupDir = join(dir, "backups");
    writeFileSync(backupDir, "not a directory");

    const facts = createDatabaseProbe(
      join(dir, "encounters.db"),
      backupDir,
    ).checkBackups();

    expect(facts.dir).toBe(backupDir);
    expect(facts.newest.kind).toBe("unreadable");
    if (facts.newest.kind !== "unreadable") return;
    expect(facts.newest.reason).toMatch(/ENOTDIR|not a directory/i);
  });
});
