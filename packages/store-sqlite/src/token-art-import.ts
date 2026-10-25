import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { importTokenArt } from "@ttrpg-agents/engine";
import { SqliteTokenArtRepository } from "./token-art-repository.js";
import { SqliteTokenImageRepository } from "./token-image-repository.js";

type TokenArtImportSummary = {
  stored: { file: string; monsterKey: string }[];
  skipped: { file: string; monsterKey: string; reason: string }[];
  rejected: { file: string; reason: string }[];
};

const LIBRARY_FILE = /^(.+)\.(png|jpe?g|webp)$/i;
const NAMING_REASON = "not named <key>.png, .jpg, .jpeg or .webp";

/** The monster key a library file names: its name without the last extension. */
function keyOf(file: string): string | undefined {
  return LIBRARY_FILE.exec(file)?.[1];
}

/** Regular files at the top of `dir` that are not hidden, in code-unit name order. */
function listLibraryFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .sort()
    .filter((name) => isRegularFile(join(dir, name)));
}

/** A broken symlink has no stat result and is skipped like any other non-file. */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Imports each `<key>.<png|jpg|jpeg|webp>` file at the top of `dir` through `importTokenArt`; files in name order. */
export function importTokenArtLibrary(
  db: DatabaseSync,
  dir: string,
  options: { replace: boolean },
): TokenArtImportSummary {
  const files = listLibraryFiles(dir);

  const claims = new Map<string, string[]>();
  for (const file of files) {
    const key = keyOf(file);
    if (key === undefined) continue;
    claims.set(key, [...(claims.get(key) ?? []), file]);
  }

  const art = new SqliteTokenArtRepository(db);
  const images = new SqliteTokenImageRepository(db);
  const summary: TokenArtImportSummary = {
    stored: [],
    skipped: [],
    rejected: [],
  };

  for (const file of files) {
    const key = keyOf(file);
    if (key === undefined) {
      summary.rejected.push({ file, reason: NAMING_REASON });
      continue;
    }
    const owners = claims.get(key) ?? [];
    if (owners.length > 1) {
      summary.rejected.push({
        file,
        reason: `several files for key ${key}: ${owners.join(", ")}`,
      });
      continue;
    }

    // A copy: a Buffer may view a shared pool, and validation needs its own bytes.
    const result = importTokenArt(
      art,
      images,
      key,
      () => new Uint8Array(readFileSync(join(dir, file))),
      options,
    );
    switch (result.outcome) {
      case "stored":
        summary.stored.push({ file, monsterKey: key });
        break;
      case "skipped":
        summary.skipped.push({
          file,
          monsterKey: key,
          reason:
            result.reason === "has_art"
              ? "already has art"
              : "already has this image",
        });
        break;
      case "rejected":
        summary.rejected.push({ file, reason: result.message });
        break;
    }
  }
  return summary;
}

/** One line per file under its outcome, then the counts. */
export function formatTokenArtImportSummary(
  summary: TokenArtImportSummary,
): string {
  const lines = [
    ...summary.stored.map(
      ({ file, monsterKey }) => `stored   ${file} -> ${monsterKey}`,
    ),
    ...summary.skipped.map(
      ({ file, monsterKey, reason }) =>
        `skipped  ${file} -> ${monsterKey}: ${reason}`,
    ),
    ...summary.rejected.map(
      ({ file, reason }) => `rejected ${file}: ${reason}`,
    ),
    `Stored ${summary.stored.length}, skipped ${summary.skipped.length}, rejected ${summary.rejected.length}.`,
  ];
  return lines.join("\n");
}
