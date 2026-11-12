import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dataFileMessage, dataFileViolations } from "./data-files.ts";

const REPO = fileURLToPath(new URL("..", import.meta.url));

describe("data-file check", () => {
  it("every committed data file is in an allowed directory or is an excepted config file", () => {
    const paths = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO,
      encoding: "utf8",
    })
      .split("\0")
      .filter((path) => path !== "");
    expect(paths.length).toBeGreaterThan(0);
    const violations = dataFileViolations(paths);
    expect(
      violations,
      violations.length > 0 ? dataFileMessage(violations) : undefined,
    ).toEqual([]);
  });

  it("flags a .json file outside the allowed directories", () => {
    const paths = [
      "packages/engine/src/monsters/extra.json",
      "packages/srd/data-extra/x.json",
      "packages/engine/src/package.json",
      "packages/engine/src/tsconfig.json",
      "docs/notes.json",
      "packages/engine/src/index.ts",
    ];
    expect(dataFileViolations(paths)).toEqual([
      "packages/engine/src/monsters/extra.json",
      "packages/srd/data-extra/x.json",
      "packages/engine/src/package.json",
      "packages/engine/src/tsconfig.json",
      "docs/notes.json",
    ]);
  });

  it("flags a committed .db file", () => {
    expect(
      dataFileViolations(["encounters.db", "packages/mcp/state.db"]),
    ).toEqual(["encounters.db", "packages/mcp/state.db"]);
  });

  it("matches data extensions in any letter case", () => {
    const paths = [
      "docs/Map.PNG",
      "notes/Data.Json",
      "packages/engine/src/table.CSV",
      "store.SQLite",
    ];
    expect(dataFileViolations(paths)).toEqual(paths);
  });

  it("accepts package.json and tsconfig files at the root and in a package, and the excepted root config files", () => {
    expect(
      dataFileViolations([
        "package.json",
        "tsconfig.json",
        "tsconfig.build.json",
        "packages/engine/package.json",
        "packages/engine/tsconfig.json",
        "packages/engine/tsconfig.build.json",
        "packages/owlbear/tsconfig.app.json",
        "package-lock.json",
        ".prettierrc.json",
        ".mcp.json",
        ".claude/settings.json",
      ]),
    ).toEqual([]);
  });

  it("accepts data files in each allowed directory", () => {
    expect(
      dataFileViolations([
        "packages/srd/data/srd-5.2/monsters.json",
        "packages/srd/src/fixtures/creature.json",
        "packages/owlbear/public/icon.svg",
        "packages/owlbear/public/manifest.json",
        "fixtures/test-book/creatures.json",
        "fixtures/test-book/map.png",
      ]),
    ).toEqual([]);
  });

  it("the failure message names each file and says a new directory needs a plan line", () => {
    const violations = ["docs/notes.json", "encounters.db"];
    const message = dataFileMessage(violations);
    for (const path of violations) {
      expect(message).toContain(path);
    }
    expect(message).toMatch(/approved plan/);
  });

  it("flags a .db or .sqlite file inside an allowed directory", () => {
    const paths = [
      "packages/srd/data/monsters.db",
      "fixtures/test-book/creatures.sqlite",
      "packages/owlbear/public/cache.DB",
      "packages/srd/src/fixtures/store.sqlite",
    ];
    expect(dataFileViolations(paths)).toEqual(paths);
  });
});
