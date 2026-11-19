import { describe, expect, it } from "vitest";
import type { ChangeOrigin } from "./origin.js";
import {
  assignTokenArt,
  tokenArtSchema,
  type StoredTokenArt,
  type TokenArt,
  type TokenArtRepository,
  type TokenArtSource,
} from "./token-art.js";

const art = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

const withImage = (over: Partial<typeof art>) => ({
  ...art,
  ...over,
});

describe("tokenArtSchema", () => {
  it("accepts an https image reference", () => {
    expect(tokenArtSchema.parse(art)).toEqual(art);
  });

  it("accepts art with an image hash of 64 lowercase hex characters", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    expect(sha256).toHaveLength(64);
    expect(tokenArtSchema.parse({ ...art, sha256 })).toEqual({
      ...art,
      sha256,
    });
  });

  it("rejects an image hash that is not 64 lowercase hex characters", () => {
    const valid = "0123456789abcdef".repeat(4);
    for (const sha256 of [
      valid.slice(1),
      valid + "0",
      valid.toUpperCase(),
      "g".repeat(64),
      "",
    ])
      expect(tokenArtSchema.safeParse({ ...art, sha256 }).success).toBe(false);
    // Control: the valid hash is accepted.
    expect(tokenArtSchema.safeParse({ ...art, sha256: valid }).success).toBe(
      true,
    );
  });

  it("rejects a url that is not https", () => {
    const http = withImage({ url: "http://cdn.owlbear.rodeo/shadow.png" });
    const script = withImage({ url: "javascript:alert(1)" });
    expect(tokenArtSchema.safeParse(http).success).toBe(false);
    expect(tokenArtSchema.safeParse(script).success).toBe(false);
    // Control: the same reference over https is accepted.
    const https = withImage({ url: "https://cdn.owlbear.rodeo/shadow.png" });
    expect(tokenArtSchema.safeParse(https).success).toBe(true);
  });

  it("rejects a url over the length bound", () => {
    const base = "https://cdn.owlbear.rodeo/";
    const atBound = base + "a".repeat(2048 - base.length);
    expect(atBound).toHaveLength(2048);
    expect(tokenArtSchema.safeParse(withImage({ url: atBound })).success).toBe(
      true,
    );
    expect(
      tokenArtSchema.safeParse(withImage({ url: atBound + "a" })).success,
    ).toBe(false);
  });

  it("rejects a mime type that is not an image", () => {
    expect(
      tokenArtSchema.safeParse(withImage({ mime: "text/html" })).success,
    ).toBe(false);
    expect(
      tokenArtSchema.safeParse(withImage({ mime: "application/javascript" }))
        .success,
    ).toBe(false);
    // Control: another image type is accepted.
    expect(
      tokenArtSchema.safeParse(withImage({ mime: "image/webp" })).success,
    ).toBe(true);
  });

  it("accepts art with an image hash and no url, mime, width or height", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    expect(tokenArtSchema.parse({ sha256 })).toEqual({ sha256 });
  });

  it("rejects art with neither a url nor an image hash", () => {
    expect(tokenArtSchema.safeParse({}).success).toBe(false);
    const noUrl = { mime: art.mime, width: art.width, height: art.height };
    expect(tokenArtSchema.safeParse(noUrl).success).toBe(false);
    // Control: the same art with an image hash and no reference is accepted.
    const sha256 = "0123456789abcdef".repeat(4);
    expect(tokenArtSchema.safeParse({ sha256 }).success).toBe(true);
  });

  it("rejects art with an image hash and only part of url, mime, width and height", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    const fields = ["url", "mime", "width", "height"] as const;
    for (const left of fields) {
      const partial: Record<string, unknown> = { ...art, sha256 };
      delete partial[left];
      expect(tokenArtSchema.safeParse(partial).success, left).toBe(false);
    }
    for (const only of fields)
      expect(
        tokenArtSchema.safeParse({ sha256, [only]: art[only] }).success,
        only,
      ).toBe(false);
    // Control: the hash alone, and the hash with the full reference, are accepted.
    expect(tokenArtSchema.safeParse({ sha256 }).success).toBe(true);
    expect(tokenArtSchema.safeParse({ ...art, sha256 }).success).toBe(true);
  });

  it("rejects art with an image hash and an invalid url instead of reading it as art without a url", () => {
    const sha256 = "0123456789abcdef".repeat(4);
    const http = { ...art, url: "http://cdn.owlbear.rodeo/shadow.png", sha256 };
    expect(tokenArtSchema.safeParse(http).success).toBe(false);
    expect(
      tokenArtSchema.safeParse({ sha256, url: "javascript:alert(1)" }).success,
    ).toBe(false);
    // Control: the hash alone is art without a url.
    expect(tokenArtSchema.safeParse({ sha256 }).success).toBe(true);
  });
});

const SOURCES: readonly TokenArtSource[] = ["table", "agent", "default"];

const storedHash = "a".repeat(64);
const incomingHash = "b".repeat(64);

const storedArt: TokenArt = { ...art, sha256: storedHash };
const incomingArt: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/wraith.png",
  mime: "image/webp",
  width: 512,
  height: 512,
  sha256: incomingHash,
};

const mcpOrigin: ChangeOrigin = { source: "mcp", commandId: "cmd-1" };

/** An in-memory art repository that records every read, write and transaction. */
function fakeRepo(initial: Record<string, StoredTokenArt> = {}) {
  const stored: Record<string, StoredTokenArt> = { ...initial };
  const calls: { call: string; inTransaction: boolean }[] = [];
  const writes: {
    monsterKey: string;
    art: TokenArt;
    source: TokenArtSource;
    origin: ChangeOrigin;
    inTransaction: boolean;
  }[] = [];
  let depth = 0;
  const repo: TokenArtRepository = {
    listTokenArt() {
      calls.push({ call: "listTokenArt", inTransaction: depth > 0 });
      return Object.fromEntries(
        Object.entries(stored).map(([key, value]) => [key, value.art]),
      );
    },
    getTokenArt(monsterKey) {
      calls.push({ call: "getTokenArt", inTransaction: depth > 0 });
      return Object.hasOwn(stored, monsterKey) ? stored[monsterKey] : undefined;
    },
    setTokenArt(monsterKey, value, source, origin) {
      calls.push({ call: "setTokenArt", inTransaction: depth > 0 });
      writes.push({
        monsterKey,
        art: value,
        source,
        origin,
        inTransaction: depth > 0,
      });
      stored[monsterKey] = { art: value, source };
    },
    transaction<T>(fn: () => T): T {
      calls.push({ call: "transaction", inTransaction: depth > 0 });
      depth += 1;
      try {
        return fn();
      } finally {
        depth -= 1;
      }
    },
  };
  return { repo, stored, writes, calls };
}

describe("assignTokenArt", () => {
  it("assignTokenArt stores table, agent or default art on a type with no art and answers set with nothing replaced", () => {
    for (const source of SOURCES) {
      const { repo, stored, writes } = fakeRepo();

      const result = assignTokenArt(
        repo,
        "shadow",
        incomingArt,
        source,
        mcpOrigin,
      );

      expect(result, source).toEqual({ outcome: "set", replaced: null });
      expect(stored, source).toEqual({ shadow: { art: incomingArt, source } });
      expect(writes, source).toHaveLength(1);
    }
  });

  it("assignTokenArt keeps table, agent or default art when the incoming art is a default, answering kept and writing nothing", () => {
    for (const source of SOURCES) {
      const { repo, stored, writes } = fakeRepo({
        shadow: { art: storedArt, source },
      });

      const result = assignTokenArt(
        repo,
        "shadow",
        incomingArt,
        "default",
        mcpOrigin,
      );

      expect(result, source).toEqual({ outcome: "kept", reason: "has_art" });
      expect(writes, source).toEqual([]);
      expect(stored, source).toEqual({ shadow: { art: storedArt, source } });
    }
  });

  it("assignTokenArt replaces table, agent or default art with agent art and answers the replaced art and its source", () => {
    for (const source of SOURCES) {
      const { repo, stored } = fakeRepo({
        shadow: { art: storedArt, source },
      });

      const result = assignTokenArt(
        repo,
        "shadow",
        incomingArt,
        "agent",
        mcpOrigin,
      );

      expect(result, source).toEqual({
        outcome: "set",
        replaced: { art: storedArt, source },
      });
      expect(stored, source).toEqual({
        shadow: { art: incomingArt, source: "agent" },
      });
    }
  });

  it("assignTokenArt replaces table, agent or default art with table art and answers the replaced art and its source", () => {
    const tableOrigin: ChangeOrigin = { source: "table", commandId: "msg-1" };
    for (const source of SOURCES) {
      const { repo, stored } = fakeRepo({
        shadow: { art: storedArt, source },
      });

      const result = assignTokenArt(
        repo,
        "shadow",
        incomingArt,
        "table",
        tableOrigin,
      );

      expect(result, source).toEqual({
        outcome: "set",
        replaced: { art: storedArt, source },
      });
      expect(stored, source).toEqual({
        shadow: { art: incomingArt, source: "table" },
      });
    }
  });

  it("assignTokenArt keeps the stored source when a table set carries the stored art's hash", () => {
    const tableOrigin: ChangeOrigin = { source: "table", commandId: "msg-2" };
    // The same image, republished under a new reference.
    const republished: TokenArt = {
      url: "https://cdn.owlbear.rodeo/assets/shadow-again.png",
      mime: "image/png",
      width: 300,
      height: 280,
      sha256: storedHash,
    };
    for (const source of ["agent", "default"] as const) {
      const { repo, stored } = fakeRepo({
        shadow: { art: storedArt, source },
      });

      const result = assignTokenArt(
        repo,
        "shadow",
        republished,
        "table",
        tableOrigin,
      );

      expect(result, source).toEqual({
        outcome: "set",
        replaced: { art: storedArt, source },
      });
      expect(stored, source).toEqual({ shadow: { art: republished, source } });
    }
    // Control: a table set with another image stores the table source.
    const { repo, stored } = fakeRepo({
      shadow: { art: storedArt, source: "agent" },
    });
    assignTokenArt(repo, "shadow", incomingArt, "table", tableOrigin);
    expect(stored).toEqual({ shadow: { art: incomingArt, source: "table" } });
  });

  it("assignTokenArt reads and writes inside one repository transaction under the given origin", () => {
    const { repo, writes, calls } = fakeRepo({
      shadow: { art: storedArt, source: "table" },
    });

    assignTokenArt(repo, "shadow", incomingArt, "agent", mcpOrigin);

    expect(calls.filter((c) => c.call === "transaction")).toEqual([
      { call: "transaction", inTransaction: false },
    ]);
    const reads = calls.filter(
      (c) => c.call === "getTokenArt" || c.call === "listTokenArt",
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => c.inTransaction)).toBe(true);
    expect(writes).toEqual([
      {
        monsterKey: "shadow",
        art: incomingArt,
        source: "agent",
        origin: mcpOrigin,
        inTransaction: true,
      },
    ]);
  });
});
