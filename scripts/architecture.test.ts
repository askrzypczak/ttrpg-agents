import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

// Workspace edges are the `@ttrpg-agents/*` entries in each packages/*/package.json.
// The lint rules in eslint.config.js check source imports; this test checks what
// the manifests declare. Adding or removing an edge means editing ALLOWED below,
// so the change shows up in review. See CLAUDE.md, Architecture.

const FIELDS: (keyof Edges)[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const SCOPE = "@ttrpg-agents/";
const SEE_CLAUDE = "See the Architecture section of CLAUDE.md.";

type Edges = Record<
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies",
  string[]
>;

/** Edges with every field present; `set` overrides the empty default. */
function edges(set: Partial<Edges> = {}): Edges {
  return {
    dependencies: [],
    devDependencies: [],
    peerDependencies: [],
    optionalDependencies: [],
    ...set,
  };
}

// Keyed by directory name under packages/. Edge names are short (the scope is
// stripped). Every other field is empty.
const ALLOWED: Record<string, Edges> = {
  engine: edges(),
  protocol: edges({ dependencies: ["engine"] }),
  "store-sqlite": edges({
    dependencies: ["engine"],
    // Tests only: add-monsters.integration.test.ts loads the SRD monsters.
    devDependencies: ["srd"],
  }),
  srd: edges({ dependencies: ["engine"] }),
  owlbear: edges({
    dependencies: ["engine", "protocol"],
    // e2e only: packages/owlbear/e2e/db.ts seeds a SQLite file for the bridge.
    devDependencies: ["store-sqlite"],
  }),
  bridge: edges({
    dependencies: ["engine", "protocol", "store-sqlite"],
    // Tests only: live-sync.integration.test.ts drives the MCP server.
    devDependencies: ["mcp"],
  }),
  mcp: edges({
    // bridge: only mcp/src/stdio.ts (the composition root) imports
    // @ttrpg-agents/bridge/client, the adapter that implements the engine's
    // TablePort; lint enforces that file-level rule.
    dependencies: ["bridge", "engine", "srd", "store-sqlite"],
  }),
};

/** The short-named workspace edges declared in a parsed package.json, sorted. */
function workspaceEdges(manifest: unknown): Edges {
  const declared = manifest as Partial<
    Record<keyof Edges, Record<string, string>>
  >;
  const result = edges();
  for (const field of FIELDS) {
    result[field] = Object.keys(declared[field] ?? {})
      .filter((name) => name.startsWith(SCOPE))
      .map((name) => name.slice(SCOPE.length))
      .sort();
  }
  return result;
}

/** Reads packages/<dir>/package.json for each directory that has one. */
function loadManifests(root: string): Record<string, Edges> {
  const packagesDir = join(root, "packages");
  const manifests: Record<string, Edges> = {};
  for (const dir of readdirSync(packagesDir)) {
    const file = join(packagesDir, dir, "package.json");
    // Leftover directories (stale dist or node_modules) are not packages.
    if (!existsSync(file)) continue;
    manifests[dir] = workspaceEdges(JSON.parse(readFileSync(file, "utf8")));
  }
  return manifests;
}

/** Compares the allowlist with the declared edges; returns one message per difference. */
function checkEdges(
  allowed: Record<string, Edges>,
  actual: Record<string, Edges>,
): string[] {
  const problems: string[] = [];
  const names = [
    ...new Set([...Object.keys(allowed), ...Object.keys(actual)]),
  ].sort();
  for (const pkg of names) {
    const want = allowed[pkg];
    const have = actual[pkg];
    if (!have) {
      problems.push(
        `ALLOWED has an entry for ${pkg}, but packages/${pkg}/package.json does not exist. Remove the entry if the package is gone. ${SEE_CLAUDE}`,
      );
      continue;
    }
    if (!want) {
      problems.push(
        `packages/${pkg} has a package.json but no entry in ALLOWED. Add one in scripts/architecture.test.ts, with no edges if it has none. ${SEE_CLAUDE}`,
      );
      continue;
    }
    for (const field of FIELDS) {
      const wanted = new Set(want[field]);
      const declared = new Set(have[field]);
      for (const dep of have[field]) {
        if (!wanted.has(dep)) {
          problems.push(
            `edge ${pkg} -> ${dep} (${field}) is not in the allowlist. Add it to ALLOWED in scripts/architecture.test.ts if it is intended. ${SEE_CLAUDE}`,
          );
        }
      }
      for (const dep of want[field]) {
        if (!declared.has(dep)) {
          problems.push(
            `edge ${pkg} -> ${dep} (${field}) is in the allowlist, but packages/${pkg}/package.json does not declare it there. Remove it from ALLOWED if it is gone. ${SEE_CLAUDE}`,
          );
        }
      }
    }
  }
  return problems;
}

describe("workspace package edges", () => {
  it("real manifests match the allowlist", () => {
    expect(checkEdges(ALLOWED, loadManifests(root))).toEqual([]);
  });

  it("reports a dependency missing from the allowlist, naming package and edge, and points at CLAUDE.md's Architecture section", () => {
    const problems = checkEdges(
      { bridge: edges() },
      { bridge: edges({ dependencies: ["engine"] }) },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bridge -> engine (dependencies)");
    expect(problems[0]).toMatch(/Architecture section of CLAUDE\.md\.$/);
  });

  it("reports a devDependency missing from the allowlist", () => {
    const problems = checkEdges(
      { bridge: edges() },
      { bridge: edges({ devDependencies: ["mcp"] }) },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bridge -> mcp (devDependencies)");
  });

  it("reports an allowlisted edge that package.json no longer declares", () => {
    const problems = checkEdges(
      { bridge: edges({ dependencies: ["engine"] }) },
      { bridge: edges() },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bridge -> engine (dependencies)");
    expect(problems[0]).toContain("does not declare it");
  });

  it("reports an edge declared in a different field than allowlisted", () => {
    const problems = checkEdges(
      { owlbear: edges({ devDependencies: ["store-sqlite"] }) },
      { owlbear: edges({ dependencies: ["store-sqlite"] }) },
    );
    expect(problems).toHaveLength(2);
    expect(problems).toContainEqual(
      expect.stringContaining("owlbear -> store-sqlite (dependencies)"),
    );
    expect(problems).toContainEqual(
      expect.stringContaining("owlbear -> store-sqlite (devDependencies)"),
    );
  });

  it("reports a peerDependency or optionalDependency missing from the allowlist", () => {
    const problems = checkEdges(
      { srd: edges() },
      {
        srd: edges({
          peerDependencies: ["engine"],
          optionalDependencies: ["protocol"],
        }),
      },
    );
    expect(problems).toHaveLength(2);
    expect(problems).toContainEqual(
      expect.stringContaining("srd -> engine (peerDependencies)"),
    );
    expect(problems).toContainEqual(
      expect.stringContaining("srd -> protocol (optionalDependencies)"),
    );
  });

  it("reports an allowlist entry whose package has no package.json", () => {
    const problems = checkEdges(
      { engine: edges(), ghost: edges() },
      { engine: edges() },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ghost");
    expect(problems[0]).toContain("does not exist");
  });

  it("reports a packages/*/package.json whose package has no allowlist entry", () => {
    const problems = checkEdges(
      { engine: edges() },
      { engine: edges(), newcomer: edges() },
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("packages/newcomer");
  });

  // The skip of a bare packages/* directory (no package.json) cannot be forced
  // here: that needs a temp dir, which CLAUDE.md classes as integration. This
  // checks the rule against whatever directories the checkout has.
  it("loadManifests reads the real packages and skips non-package directories", () => {
    const manifests = loadManifests(root);
    expect(Object.keys(manifests).sort()).toEqual([
      "bridge",
      "engine",
      "mcp",
      "owlbear",
      "protocol",
      "srd",
      "store-sqlite",
    ]);
    for (const dir of readdirSync(join(root, "packages"))) {
      const hasManifest = existsSync(
        join(root, "packages", dir, "package.json"),
      );
      expect(Object.keys(manifests).includes(dir), dir).toBe(hasManifest);
    }
  });
});
