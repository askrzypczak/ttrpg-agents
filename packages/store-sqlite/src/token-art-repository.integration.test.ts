import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ChangeOrigin,
  NewTokenImage,
  TokenArt,
} from "@ttrpg-agents/engine";
import { openDatabase } from "./db.js";
import { SqliteEncounterLog } from "./sqlite-log.js";
import { SqliteTokenArtRepository } from "./token-art-repository.js";
import { SqliteTokenImageRepository } from "./token-image-repository.js";

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

const storedImage: NewTokenImage = {
  bytes: new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  ),
  mime: "image/png",
  width: 1,
  height: 1,
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

  it("lists the image hash of an art row that refers to a stored image", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const repo = new SqliteTokenArtRepository(db);
    repo.setTokenArt("shadow", { ...shadowArt, sha256 });
    expect(repo.listTokenArt()).toEqual({
      shadow: { ...shadowArt, sha256 },
    });
  });

  it("lists an art row without an image without a hash", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const repo = new SqliteTokenArtRepository(db);
    repo.setTokenArt("shadow", shadowArt);
    repo.setTokenArt("ghoul", { ...ghoulArt, sha256 });
    const listed = repo.listTokenArt();
    expect(listed.shadow).toEqual(shadowArt);
    expect(Object.keys(listed.shadow ?? {})).not.toContain("sha256");
    // Control: the row that has an image lists its hash.
    expect(listed.ghoul?.sha256).toBe(sha256);
  });

  it("replacing art with art that has no hash clears the image link", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const repo = new SqliteTokenArtRepository(db);
    repo.setTokenArt("shadow", { ...shadowArt, sha256 });
    expect(repo.listTokenArt().shadow?.sha256).toBe(sha256);
    repo.setTokenArt("shadow", ghoulArt);
    const listed = repo.listTokenArt();
    expect(listed.shadow).toEqual(ghoulArt);
    expect(Object.keys(listed.shadow ?? {})).not.toContain("sha256");
  });

  it("refuses art that refers to a hash with no stored image", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteTokenArtRepository(db);
    repo.setTokenArt("shadow", shadowArt);
    let error: unknown;
    try {
      repo.setTokenArt("ghoul", { ...ghoulArt, sha256: "a".repeat(64) });
    } catch (e) {
      error = e;
    }
    // SQLITE_CONSTRAINT_FOREIGNKEY
    expect(error).toMatchObject({ errcode: 787 });
    expect(repo.listTokenArt()).toEqual({ shadow: shadowArt });
  });

  it("stores art for a monster key that no monster source knows", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const repo = new SqliteTokenArtRepository(db);
    const key = "homebrew: the Unlisted One / 7";
    repo.setTokenArt(key, { ...shadowArt, sha256 });
    expect(repo.listTokenArt()).toEqual({
      [key]: { ...shadowArt, sha256 },
    });
  });

  it("listing art reads no image bytes", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const prepared: string[] = [];
    const spied = new Proxy(db, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        const fn = value as (...args: unknown[]) => unknown;
        if (prop !== "prepare") return fn.bind(target);
        return (sql: string) => {
          prepared.push(sql);
          return target.prepare(sql);
        };
      },
    });
    const repo = new SqliteTokenArtRepository(spied);
    repo.setTokenArt("shadow", { ...shadowArt, sha256 });
    repo.setTokenArt("ghoul", ghoulArt);

    prepared.length = 0;
    const listed = repo.listTokenArt();

    expect(prepared.length).toBeGreaterThan(0);
    for (const sql of prepared) expect(sql).not.toMatch(/\bbytes\b/i);
    const allowed = ["url", "mime", "width", "height", "sha256"];
    for (const art of Object.values(listed))
      for (const key of Object.keys(art)) expect(allowed).toContain(key);
    expect(listed.shadow?.sha256).toBe(sha256);
  });

  it("stores art with an image hash and no url and lists it with only its hash", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const repo = new SqliteTokenArtRepository(db);
    repo.setTokenArt("shadow", { sha256 });
    repo.setTokenArt("ghoul", ghoulArt);
    const listed = repo.listTokenArt();
    expect(listed).toEqual({ shadow: { sha256 }, ghoul: ghoulArt });
    expect(Object.keys(listed.shadow ?? {})).toEqual(["sha256"]);
  });

  it("art without a url is completed by art with a url and the same hash", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const repo = new SqliteTokenArtRepository(db);
    repo.setTokenArt("shadow", { sha256 });
    repo.setTokenArt("shadow", { ...shadowArt, sha256 });
    expect(repo.listTokenArt()).toEqual({ shadow: { ...shadowArt, sha256 } });
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

const mcpOrigin: ChangeOrigin = { source: "mcp", commandId: "cmd-1" };
const tableOrigin: ChangeOrigin = { source: "table", commandId: "msg-1" };

describe("SqliteTokenArtRepository sources and the change log", () => {
  it("setTokenArt stores the art with its source and logs one art-changed event with a null encounter id, read back through SqliteEncounterLog", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteTokenArtRepository(db);
    const log = new SqliteEncounterLog(db);
    const before = log.latestSeq();

    repo.setTokenArt("shadow", shadowArt, "agent", mcpOrigin);

    const events = log.eventsSince(before);
    expect(events).toEqual([
      {
        seq: expect.any(Number) as number,
        encounterId: null,
        event: {
          type: "art-changed",
          monsterKey: "shadow",
          art: shadowArt,
          origin: mcpOrigin,
        },
      },
    ]);
    expect(repo.getTokenArt("shadow")).toEqual({
      art: shadowArt,
      source: "agent",
    });
    expect(repo.listTokenArt()).toEqual({ shadow: shadowArt });
  });

  it("setTokenArt logs the origin without its command name", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteTokenArtRepository(db);

    repo.setTokenArt("shadow", shadowArt, "agent", {
      ...mcpOrigin,
      command: "set_token_art",
    });

    const rows = db.prepare("SELECT event FROM encounter_events").all() as {
      event: string;
    }[];
    expect(rows).toHaveLength(1);
    const logged = JSON.parse(rows[0]?.event ?? "null") as {
      origin: unknown;
    };
    expect(logged.origin).toEqual({ source: "mcp", commandId: "cmd-1" });
  });

  it("a setTokenArt that token_art refuses (a hash with no stored image) stores no art and logs no event", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteTokenArtRepository(db);
    const log = new SqliteEncounterLog(db);
    repo.setTokenArt("shadow", shadowArt, "table", tableOrigin);
    const after = log.latestSeq();
    expect(log.eventsSince(0)).toHaveLength(1);

    let error: unknown;
    try {
      repo.setTokenArt(
        "ghoul",
        { ...ghoulArt, sha256: "a".repeat(64) },
        "agent",
        mcpOrigin,
      );
    } catch (e) {
      error = e;
    }

    // SQLITE_CONSTRAINT_FOREIGNKEY
    expect(error).toMatchObject({ errcode: 787 });
    expect(log.eventsSince(after)).toEqual([]);
    expect(repo.listTokenArt()).toEqual({ shadow: shadowArt });
    expect(repo.getTokenArt("ghoul")).toBeUndefined();
  });

  it("getTokenArt answers the art and its source, and undefined for a key with none", () => {
    const db = openDatabase(":memory:");
    const sha256 = new SqliteTokenImageRepository(db).saveTokenImage(
      storedImage,
    );
    const repo = new SqliteTokenArtRepository(db);
    repo.setTokenArt("shadow", { ...shadowArt, sha256 }, "table", tableOrigin);
    repo.setTokenArt("ghoul", { sha256 }, "agent", mcpOrigin);
    repo.setTokenArt("wight", ghoulArt, "default", mcpOrigin);

    expect(repo.getTokenArt("shadow")).toEqual({
      art: { ...shadowArt, sha256 },
      source: "table",
    });
    expect(repo.getTokenArt("ghoul")).toEqual({
      art: { sha256 },
      source: "agent",
    });
    expect(repo.getTokenArt("wight")).toEqual({
      art: ghoulArt,
      source: "default",
    });
    expect(repo.getTokenArt("wraith")).toBeUndefined();
    expect(repo.getTokenArt("constructor")).toBeUndefined();
  });

  it("transaction rolls back every art write and event of a throwing function", () => {
    const db = openDatabase(":memory:");
    const repo = new SqliteTokenArtRepository(db);
    const log = new SqliteEncounterLog(db);
    repo.setTokenArt("shadow", shadowArt, "table", tableOrigin);
    const before = log.latestSeq();
    const failure = new Error("boom");

    let caught: unknown;
    try {
      repo.transaction(() => {
        repo.setTokenArt("ghoul", ghoulArt, "agent", mcpOrigin);
        repo.setTokenArt("shadow", ghoulArt, "agent", mcpOrigin);
        throw failure;
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(failure);
    expect(repo.listTokenArt()).toEqual({ shadow: shadowArt });
    expect(log.eventsSince(before)).toEqual([]);
    expect(log.latestSeq()).toBe(before);
    expect(db.isTransaction).toBe(false);
    // Control: the same writes outside a throwing function are kept.
    const result = repo.transaction(() => {
      repo.setTokenArt("ghoul", ghoulArt, "agent", mcpOrigin);
      return "done";
    });
    expect(result).toBe("done");
    expect(repo.listTokenArt()).toEqual({ shadow: shadowArt, ghoul: ghoulArt });
    expect(log.eventsSince(before)).toHaveLength(1);
  });
});
