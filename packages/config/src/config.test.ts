import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeProfile, SETTINGS } from "./config.js";
import type { Profile } from "./config.js";

const settingsPage = fileURLToPath(
  new URL("../../../docs/settings.md", import.meta.url),
);

/** The code spans of each markdown table row on the page, one set per row. */
function tableRows(markdown: string): Set<string>[] {
  return markdown
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .map(
      (line) =>
        new Set(
          [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ""),
        ),
    );
}

describe("settings page", () => {
  it("docs/settings.md lists every setting the loader resolves, with its environment variable and file key", () => {
    expect(existsSync(settingsPage), "docs/settings.md exists").toBe(true);
    const rows = tableRows(
      existsSync(settingsPage) ? readFileSync(settingsPage, "utf8") : "",
    );

    for (const spec of SETTINGS) {
      const row = rows.find((spans) => spans.has(spec.env));
      expect(row, `a table row names ${spec.env}`).toBeDefined();
      expect(
        row?.has(spec.name),
        `the ${spec.env} row names ${spec.name}`,
      ).toBe(true);
      if (spec.fileKey !== undefined) {
        expect(
          row?.has(spec.fileKey),
          `the ${spec.env} row names the file key ${spec.fileKey}`,
        ).toBe(true);
      }
    }
  });
});

describe("describeProfile", () => {
  it("describeProfile names the profile and why it was chosen, for each of the three reasons", () => {
    const cases: [Profile, string][] = [
      [{ name: "dev", reason: "environment" }, "dev (TTRPG_AGENTS_PROFILE)"],
      [
        { name: "default", reason: "environment" },
        "default (TTRPG_AGENTS_PROFILE)",
      ],
      [{ name: "dev", reason: "worktree" }, "dev (linked git worktree)"],
      [
        { name: "default", reason: "none" },
        "default (not a linked git worktree)",
      ],
    ];
    for (const [profile, text] of cases)
      expect(describeProfile(profile), JSON.stringify(profile)).toBe(text);
  });
});
