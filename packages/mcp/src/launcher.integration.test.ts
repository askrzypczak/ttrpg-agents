import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const launcher = fileURLToPath(new URL("../bin/stdio.mjs", import.meta.url));

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("stdio launcher", () => {
  it("prints the build hint to stderr, nothing to stdout, and exits 1 when dist/stdio.js is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ttrpg-launcher-"));
    dirs.push(dir);
    mkdirSync(join(dir, "bin"));
    const copy = join(dir, "bin", "stdio.mjs");
    copyFileSync(launcher, copy);

    const result = spawnSync(process.execPath, [copy], {
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run `npm run build` first");
    expect(result.stdout).toBe("");
  });
});
