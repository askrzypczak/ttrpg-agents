import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  defaultAgentTokenPath,
  defaultTokenPath,
  loadOrCreateToken,
} from "./token-file.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadOrCreateToken", () => {
  it("creates a 64-hex token with mode 0600, and reuses it", async () => {
    const path = join(dir, "nested", "bridge-token");
    const first = await loadOrCreateToken(path);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadOrCreateToken(path)).toBe(first);
    expect((await readFile(path, "utf8")).trim()).toBe(first);
  });

  it("the agent token file is created with mode 0600 and reused (AC5)", async () => {
    expect(basename(defaultAgentTokenPath())).toBe("agent-token");
    expect(dirname(defaultAgentTokenPath())).toBe(dirname(defaultTokenPath()));
    expect(defaultAgentTokenPath()).not.toBe(defaultTokenPath());
    const path = join(dir, "agent-token");
    const first = await loadOrCreateToken(path);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadOrCreateToken(path)).toBe(first);
    expect((await readFile(path, "utf8")).trim()).toBe(first);
  });

  it("tightens permissions on an existing token file", async () => {
    const path = join(dir, "bridge-token");
    await writeFile(path, "abc\n", { mode: 0o644 });
    expect(await loadOrCreateToken(path)).toBe("abc");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
