/**
 * Regenerates data/srd-5.2/monsters.json from the Open5e v2 API.
 * Usage: npm run import:srd -w @ttrpg-agents/srd
 * Output is deterministic (sorted by key), so re-running yields no diff
 * unless upstream data changed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { monsterSchema } from "@ttrpg-agents/engine";
import { mapOpen5eCreature, type Open5eCreature } from "../src/map-open5e.ts";

const START_URL =
  "https://api.open5e.com/v2/creatures/?document__key=srd-2024&limit=100";
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/srd-5.2/monsters.json",
);

interface Page {
  next: string | null;
  results: Open5eCreature[];
}

async function fetchAll(): Promise<Open5eCreature[]> {
  const all: Open5eCreature[] = [];
  let url: string | null = START_URL;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    const page = (await res.json()) as Page;
    all.push(...page.results);
    url = page.next;
  }
  return all;
}

const monsters = (await fetchAll())
  .map((c) => monsterSchema.parse(mapOpen5eCreature(c)))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(monsters, null, 2) + "\n");
console.log(`Wrote ${monsters.length} monsters to ${OUT}`);
