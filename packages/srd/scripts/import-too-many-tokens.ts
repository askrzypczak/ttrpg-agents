/**
 * Regenerates data/too-many-tokens/index.json: the folders and WebP file names
 * of the TooManyTokens pack at its head commit (no images).
 * Usage: npm run import:too-many-tokens -w @ttrpg-agents/srd
 * Needs network, so it runs by hand when the pack changes. The same commit
 * gives the same file.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tooManyTokensIndexSchema } from "@ttrpg-agents/engine";
import { z } from "zod";
import { loadSrdMonsters } from "../src/loader.ts";
import { importTooManyTokensIndex } from "../src/too-many-tokens-import.ts";

const DATA_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/too-many-tokens",
);
const FOLDER_KEYS = resolve(DATA_DIR, "folder-keys.json");
const OUT = resolve(DATA_DIR, "index.json");

const { monsters, aliases } = loadSrdMonsters();
const folderKeys = z
  .record(z.string(), z.string().min(1))
  .parse(JSON.parse(await readFile(FOLDER_KEYS, "utf8")));

const text = await importTooManyTokensIndex(fetch, {
  monsters,
  aliases,
  folderKeys,
});
await writeFile(OUT, text);

const index = tooManyTokensIndexSchema.parse(JSON.parse(text));
const fileCount = index.folders.reduce((n, f) => n + f.files.length, 0);
console.log(
  `Wrote ${index.folders.length} folders and ${fileCount} files at commit ${index.commit} to ${OUT}`,
);
