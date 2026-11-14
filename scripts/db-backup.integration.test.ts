import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveEncounter,
  type ChangeOrigin,
  type NewMonsterInstance,
} from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import {
  SqliteEncounterDirectory,
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `node scripts/db-backup.ts` as a child process, run from the repo root with
// the database and the backup directory in a temp directory, a temp HOME and
// XDG directories, no config.json and no other project environment variables.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 30_000;
const BACKUP_NAME = /^encounters-\d{8}T\d{6}Z\.db$/;

let dir: string;
const cleanup: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "db-backup-script-"));
  mkdirSync(join(dir, "home"));
});

afterEach(() => {
  for (const path of cleanup.splice(0))
    rmSync(path, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

function childEnv(database: string, backupDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (
      name.startsWith("TTRPG_AGENTS_") ||
      name.startsWith("BRIDGE_") ||
      name.startsWith("XDG_")
    )
      continue;
    env[name] = value;
  }
  env.HOME = join(dir, "home");
  env.XDG_CONFIG_HOME = join(dir, "xdg-config");
  env.XDG_DATA_HOME = join(dir, "xdg-data");
  env.TTRPG_AGENTS_DB = database;
  env.TTRPG_AGENTS_BACKUP_DIR = backupDir;
  return env;
}

function runBackup(
  database: string,
  backupDir: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["scripts/db-backup.ts"], {
    cwd: REPO,
    env: childEnv(database, backupDir),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  return new Promise((done) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
  });
}

const origin: ChangeOrigin = { source: "mcp", commandId: "seed" };

function newInstance(displayName: string, maxHp: number): NewMonsterInstance {
  const { monsterKey, initiative, armorClass, footprint, statsVisible } =
    makeTestInstance({ displayName, maxHp, initiative: 12, armorClass: 13 });
  return {
    monsterKey,
    displayName,
    maxHp,
    initiative,
    armorClass,
    footprint,
    statsVisible,
  };
}

/** A migrated, empty database at `path`, closed. */
function createDatabase(path: string): void {
  openDatabase(path).close();
}

/** A name for a directory in the checkout that does not exist yet. */
function uniqueCheckoutName(): string {
  const name = `.db-backup-test-${randomUUID()}`;
  expect(existsSync(join(REPO, name))).toBe(false);
  cleanup.push(join(REPO, name));
  return name;
}

describe("db:backup", () => {
  it(
    "with a second openDatabase connection holding the database open after a write, db:backup writes one encounters-<UTC timestamp>.db into the backup directory, prints its path and size, and the backup opens and holds the same instances",
    async () => {
      const database = join(dir, "data", "encounters.db");
      const backupDir = join(dir, "backups");
      mkdirSync(dirname(database));
      const live = openDatabase(database);
      try {
        const encounterId = resolveEncounter(
          new SqliteEncounterDirectory(live),
          {
            writes: true,
          },
        ).encounter.id;
        const repo = new SqliteEncounterRepository(live, encounterId);
        repo.addInstances(
          () => [newInstance("Shadow 1", 16), newInstance("Shadow 2", 18)],
          origin,
        );
        const expected = repo.listInstances();
        expect(expected).toHaveLength(2);

        const result = await runBackup(database, backupDir);

        expect(result.code, result.stderr).toBe(0);
        expect(existsSync(backupDir), "backup directory").toBe(true);
        const files = readdirSync(backupDir);
        expect(files).toHaveLength(1);
        const name = files[0] as string;
        expect(name).toMatch(BACKUP_NAME);
        const backup = join(backupDir, name);
        expect(result.stdout).toContain(backup);
        expect(result.stdout).toContain(String(statSync(backup).size));

        const copy = openDatabase(backup);
        try {
          expect(
            new SqliteEncounterRepository(copy, encounterId).listInstances(),
          ).toEqual(expected);
        } finally {
          copy.close();
        }
      } finally {
        live.close();
      }
    },
    TIMEOUT,
  );

  it(
    "db:backup creates the backup directory with mode 0700 and the backup file with mode 0600",
    async () => {
      const database = join(dir, "encounters.db");
      const backupDir = join(dir, "data", "backups");
      createDatabase(database);

      const result = await runBackup(database, backupDir);

      expect(result.code, result.stderr).toBe(0);
      expect(existsSync(backupDir), "backup directory").toBe(true);
      expect(statSync(backupDir).mode & 0o777).toBe(0o700);
      const files = readdirSync(backupDir);
      expect(files).toHaveLength(1);
      const name = files[0] as string;
      expect(name).toMatch(BACKUP_NAME);
      expect(statSync(join(backupDir, name)).mode & 0o777).toBe(0o600);
    },
    TIMEOUT,
  );

  it(
    "db:backup exits 1 with a message naming the directory when the backup directory is inside the checkout, and creates nothing there",
    async () => {
      const database = join(dir, "encounters.db");
      createDatabase(database);
      const backupDir = join(REPO, uniqueCheckoutName());

      const result = await runBackup(database, backupDir);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(backupDir);
      expect(existsSync(backupDir)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "db:backup exits 1 with a message naming the database when the database does not exist, and writes no backup",
    async () => {
      const database = join(dir, "data", "encounters.db");
      const backupDir = join(dir, "backups");

      const result = await runBackup(database, backupDir);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(database);
      expect(existsSync(backupDir)).toBe(false);
      expect(existsSync(database)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "db:backup exits 1 when the backup directory reaches the checkout through a symlink, and creates nothing there",
    async () => {
      const database = join(dir, "encounters.db");
      createDatabase(database);
      const link = join(dir, "checkout-link");
      symlinkSync(REPO, link, "dir");
      const name = uniqueCheckoutName();
      const backupDir = join(link, name);

      const result = await runBackup(database, backupDir);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(backupDir);
      expect(existsSync(join(REPO, name))).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "db:backup exits 1 and leaves no backup file when the database is not SQLite",
    async () => {
      const database = join(dir, "encounters.db");
      writeFileSync(database, "not a database\n".repeat(50));
      const backupDir = join(dir, "backups");

      const result = await runBackup(database, backupDir);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(database);
      expect(readdirSync(backupDir)).toEqual([]);
    },
    TIMEOUT,
  );
});
