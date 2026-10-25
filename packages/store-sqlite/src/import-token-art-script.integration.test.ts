import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { SqliteTokenArtRepository } from "./token-art-repository.js";

const script = fileURLToPath(
  new URL("../scripts/import-token-art.ts", import.meta.url),
);

const PNG_1X1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const NOT_AN_IMAGE = new TextEncoder().encode("not an image");

const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A temp root holding a `library` directory with the given files; the database path sits beside it. */
function setup(files: Record<string, Uint8Array>) {
  const root = mkdtempSync(join(tmpdir(), "ttrpg-token-art-script-"));
  dirs.push(root);
  const library = join(root, "library");
  mkdirSync(library);
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(library, name), bytes);
  return { root, library, dbPath: join(root, "x.db") };
}

function run(args: string[], env: Record<string, string>, cwd?: string) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
    ...(cwd === undefined ? {} : { cwd }),
  });
}

function artIn(dbPath: string) {
  const db = openDatabase(dbPath);
  try {
    return new SqliteTokenArtRepository(db).listTokenArt();
  } finally {
    db.close();
  }
}

describe("import-token-art script", () => {
  it("the script imports a directory into the database named by TTRPG_AGENTS_DB, prints the summary and exits 0", () => {
    const { library, dbPath } = setup({
      "bad.png": NOT_AN_IMAGE,
      "goblin.png": PNG_1X1,
    });

    const result = run([library], { TTRPG_AGENTS_DB: dbPath });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `Imported token art from ${library} into ${dbPath}`,
    );
    expect(result.stdout).toContain("stored   goblin.png -> goblin");
    expect(result.stdout).toContain(
      "rejected bad.png: Unsupported image type. Use PNG, JPEG or WebP.",
    );
    expect(result.stdout).toContain("Stored 1, skipped 0, rejected 1.");
    expect(artIn(dbPath)).toEqual({ goblin: { sha256: sha256Of(PNG_1X1) } });
  });

  it("the script with --replace replaces existing art", () => {
    const { library, dbPath } = setup({ "goblin.png": PNG_1X1 });
    const db = openDatabase(dbPath);
    new SqliteTokenArtRepository(db).setTokenArt("goblin", {
      url: "https://cdn.owlbear.rodeo/assets/goblin.png",
      mime: "image/png",
      width: 300,
      height: 280,
    });
    db.close();

    const kept = run([library], { TTRPG_AGENTS_DB: dbPath });
    expect(kept.status).toBe(0);
    expect(kept.stdout).toContain(
      "skipped  goblin.png -> goblin: already has art",
    );
    expect(artIn(dbPath).goblin?.url).toBe(
      "https://cdn.owlbear.rodeo/assets/goblin.png",
    );

    const replaced = run([library, "--replace"], { TTRPG_AGENTS_DB: dbPath });
    expect(replaced.status).toBe(0);
    expect(replaced.stdout).toContain("stored   goblin.png -> goblin");
    expect(artIn(dbPath)).toEqual({ goblin: { sha256: sha256Of(PNG_1X1) } });
  });

  it("the script resolves a relative directory from INIT_CWD", () => {
    const { root, library, dbPath } = setup({ "goblin.png": PNG_1X1 });
    const elsewhere = mkdtempSync(join(tmpdir(), "ttrpg-token-art-cwd-"));
    dirs.push(elsewhere);

    const result = run(
      ["library"],
      { TTRPG_AGENTS_DB: dbPath, INIT_CWD: root },
      elsewhere,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Imported token art from ${library} into`);
    expect(artIn(dbPath)).toEqual({ goblin: { sha256: sha256Of(PNG_1X1) } });
  });
});
