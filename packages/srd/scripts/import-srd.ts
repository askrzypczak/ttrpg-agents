/**
 * Regenerates data/srd-5.2/monsters.json from the Open5e v2 API, and
 * data/srd-5.2/monsters.meta.json with its provenance (source, url, fetchedAt,
 * count).
 * Usage: npm run import:srd -w @ttrpg-agents/srd
 * Output is deterministic (sorted by key), so re-running yields no diff
 * unless upstream data changed (fetchedAt aside).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { monsterSchema } from "@ttrpg-agents/engine";
import { mapOpen5eCreature, type Open5eCreature } from "../src/map-open5e.ts";
import { open5ePageSchema } from "../src/open5e-page.ts";

const START_URL =
  "https://api.open5e.com/v2/creatures/?document__key=srd-2024&limit=100";
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/srd-5.2/monsters.json",
);
const META_OUT = resolve(dirname(OUT), "monsters.meta.json");

async function fetchAll(): Promise<Open5eCreature[]> {
  const all: Open5eCreature[] = [];
  let url: string | null = START_URL;
  while (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    const page = open5ePageSchema.parse(await res.json());
    // monsterSchema checks each mapped creature, so the cast only names the type.
    all.push(...(page.results as Open5eCreature[]));
    url = page.next;
  }
  return all;
}

const monsters = (await fetchAll())
  .map((c) => monsterSchema.parse(mapOpen5eCreature(c)))
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

const meta = {
  source: "open5e-v2",
  url: START_URL,
  fetchedAt: new Date().toISOString().slice(0, 10),
  count: monsters.length,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(monsters, null, 2) + "\n");
await writeFile(META_OUT, JSON.stringify(meta, null, 2) + "\n");
console.log(`Wrote ${monsters.length} monsters to ${OUT} (meta: ${META_OUT})`);
