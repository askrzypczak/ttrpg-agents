import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemBrowser } from "./system-browser.js";

/** Characters a shell would act on, so a shell in the way would show. */
const URL_WITH_SHELL_CHARS =
  "https://www.dndbeyond.com/monsters/1-a?x=1&y=$(id)";

let savedPath: string | undefined;
let dirs: string[];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "system-browser-"));
  dirs.push(dir);
  return dir;
}

/**
 * Puts a fake `open` first on PATH. It writes each argument on its own line
 * to the returned file, then exits with `exitCode`.
 */
function fakeOpen(exitCode = 0): string {
  const dir = tempDir();
  const out = join(dir, "args.txt");
  const script = join(dir, "open");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `for a in "$@"; do printf '%s\\n' "$a" >> '${out}'; done`,
      `exit ${String(exitCode)}`,
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  process.env["PATH"] = `${dir}${delimiter}${savedPath ?? ""}`;
  return out;
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  savedPath = process.env["PATH"];
  dirs = [];
});

afterEach(() => {
  if (savedPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = savedPath;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("createSystemBrowser", () => {
  it("showPage on macOS runs open with the URL as one argument", async () => {
    const out = fakeOpen();
    await createSystemBrowser("darwin").showPage(URL_WITH_SHELL_CHARS);
    expect(readFileSync(out, "utf8")).toBe(`${URL_WITH_SHELL_CHARS}\n`);
  });

  it("showPage on macOS rejects naming open when it cannot be started", async () => {
    process.env["PATH"] = tempDir();
    const err = await rejection(
      createSystemBrowser("darwin").showPage(URL_WITH_SHELL_CHARS),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/\bopen\b/);
    expect(err.message).not.toBe("not implemented");
  });

  it("showPage on macOS rejects when open exits non-zero", async () => {
    const out = fakeOpen(3);
    const err = await rejection(
      createSystemBrowser("darwin").showPage(URL_WITH_SHELL_CHARS),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/\bopen\b/);
    expect(err.message).toMatch(/\b3\b/);
    expect(existsSync(out)).toBe(true);
  });

  it("showPage on other platforms rejects with no browser opener for the platform", async () => {
    const out = fakeOpen();
    const err = await rejection(
      createSystemBrowser("linux").showPage(URL_WITH_SHELL_CHARS),
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("no browser opener for linux");
    expect(existsSync(out)).toBe(false);
  });
});
