import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  vi.unstubAllEnvs();
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
    // homedir() follows $HOME, so the default path lands in the temp dir.
    vi.stubEnv("HOME", dir);
    const path = defaultAgentTokenPath();
    expect(path).toBe(join(dir, ".config", "ttrpg-agents", "agent-token"));
    expect(path).not.toBe(defaultTokenPath());
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
