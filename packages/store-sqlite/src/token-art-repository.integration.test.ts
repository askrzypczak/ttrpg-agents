import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TokenArt } from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteTokenArtRepository } from "./token-art-repository.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const shadowArt: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

const ghoulArt: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ghoul.webp",
  mime: "image/webp",
  width: 512,
  height: 512,
};

describe("SqliteTokenArtRepository", () => {
  it("lists no art on a fresh database", () => {
    const repo = new SqliteTokenArtRepository(openDatabase(":memory:"));
    expect(repo.listTokenArt()).toEqual({});
  });

  it("stores art and lists it by monster key", () => {
    const repo = new SqliteTokenArtRepository(openDatabase(":memory:"));
    repo.setTokenArt("shadow", shadowArt);
    repo.setTokenArt("ghoul", ghoulArt);
    expect(repo.listTokenArt()).toEqual({
      shadow: shadowArt,
      ghoul: ghoulArt,
    });
  });

  it("replaces the art of a monster key that already has some", () => {
    const repo = new SqliteTokenArtRepository(openDatabase(":memory:"));
    repo.setTokenArt("shadow", shadowArt);
    repo.setTokenArt("shadow", ghoulArt);
    expect(repo.listTokenArt()).toEqual({ shadow: ghoulArt });
  });

  it("keeps the art after the database is reopened", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-art-"));
    dirs.push(dir);
    const path = join(dir, "enc.db");
    const first = openDatabase(path);
    new SqliteTokenArtRepository(first).setTokenArt("shadow", shadowArt);
    first.close();

    const second = openDatabase(path);
    expect(new SqliteTokenArtRepository(second).listTokenArt()).toEqual({
      shadow: shadowArt,
    });
    second.close();
  });
});
