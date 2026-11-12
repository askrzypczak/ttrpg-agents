// `npm run db:backup`: copies the profile's database into the backupDir
// setting (docs/settings.md) while the bridge and the MCP server run. Opens the
// database read-only itself, never through the store, which would create and
// migrate it. Hand recovery: docs/architecture.md, "Two halves of one save".
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../packages/config/src/config.ts";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The real path of `path`, resolving symlinks in its nearest existing ancestor; the missing rest is joined back on. */
function realPathOf(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

/** True when `path` is `dir` or lies under it. */
function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

/** `encounters-YYYYMMDDTHHMMSSZ.db` for `date` in UTC. */
function backupName(date: Date): string {
  const stamp = date.toISOString().slice(0, 19).replace(/[-:]/g, "");
  return `encounters-${stamp}Z.db`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const { settings, problems } = loadConfig({
    env: process.env,
    home: homedir(),
    checkout,
  });
  for (const problem of problems) console.error(problem.message);
  if (problems.some((p) => p.level === "error")) process.exit(1);
  const { database, backupDir } = settings;

  if (isInside(realpathSync(checkout), realPathOf(backupDir)))
    fail(
      `db:backup: the backup directory ${backupDir} is inside the checkout ${checkout}; set backupDir to a folder outside it (see docs/settings.md)`,
    );
  if (!existsSync(database))
    fail(`db:backup: no database at ${database}; nothing to back up`);

  // A directory created here gets 0700; an existing one keeps its mode.
  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    fail(`db:backup: cannot create ${backupDir}: ${message(error)}`);
  }
  const target = join(backupDir, backupName(new Date()));
  // Exclusive create at 0600: SQLite writes into the existing file, so the copy keeps the mode.
  try {
    closeSync(openSync(target, "wx", 0o600));
  } catch (error) {
    fail(`db:backup: cannot create ${target}: ${message(error)}`);
  }
  try {
    const source = new DatabaseSync(database, { readOnly: true });
    try {
      await backup(source, target);
    } finally {
      source.close();
    }
    const { size } = statSync(target);
    console.log(`backup written: ${target} (${String(size)} bytes)`);
  } catch (error) {
    rmSync(target, { force: true });
    fail(`db:backup: backup of ${database} failed: ${message(error)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main();
