/**
 * Imports a local library of token art images into the shared database. Each
 * file is named `<monster key>.<png|jpg|jpeg|webp>`; existing art is kept
 * unless --replace is given. Rejected files are listed in the summary, and the
 * exit code is 0 when the run completes; usage errors exit 1, and a file that
 * cannot be read stops the run with an error.
 * Usage: npm run import:token-art -w @ttrpg-agents/store-sqlite -- <directory> [--replace]
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  defaultDbPath,
  formatTokenArtImportSummary,
  importTokenArtLibrary,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";

const USAGE =
  "Usage: npm run import:token-art -w @ttrpg-agents/store-sqlite -- <directory> [--replace]";

function usageError(reason?: string): never {
  if (reason !== undefined) process.stderr.write(`${reason}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
}

function parseCommandLine(argv: string[]) {
  return parseArgs({
    args: argv,
    options: { replace: { type: "boolean", default: false } },
    allowPositionals: true,
    strict: true,
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

let parsed: ReturnType<typeof parseCommandLine>;
try {
  parsed = parseCommandLine(process.argv.slice(2));
} catch (error) {
  usageError(error instanceof Error ? error.message : undefined);
}

const [argument, ...extra] = parsed.positionals;
if (argument === undefined || extra.length > 0) usageError();

// npm runs a workspace script in its package directory and sets INIT_CWD to
// the directory it was started from, which is where a relative path belongs.
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), argument);
if (!isDirectory(dir)) usageError(`Not a directory: ${dir}`);

const db = openDatabase();
const summary = importTokenArtLibrary(db, dir, {
  replace: parsed.values.replace,
});
console.log(`Imported token art from ${dir} into ${defaultDbPath()}`);
console.log(formatTokenArtImportSummary(summary));
db.close();
