import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

// Guards the inline-directive policy in CLAUDE.md, Architecture. The config
// ignores directives in production source (so a boundary rule cannot be bypassed
// with a comment), reports each one as a warning, and `npm run lint` runs with
// --max-warnings 0. Tests may still use directives.

// Both must be existing files: the type-aware projectService rejects unknown paths.
const PRODUCTION = "packages/engine/src/errors.ts";
const TEST_FILE = "packages/engine/src/index.test.ts";

const eslint = new ESLint({ cwd: root });

async function lint(text: string, filePath: string) {
  const [result] = await eslint.lintText(text, { filePath });
  return result?.messages ?? [];
}

describe("inline eslint-disable policy", () => {
  it("an eslint-disable of no-restricted-imports does not suppress a forbidden workspace import in production code", async () => {
    const messages = await lint(
      '// eslint-disable-next-line no-restricted-imports\nimport "@ttrpg-agents/protocol";\n',
      PRODUCTION,
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-imports", severity: 2 }),
    );
  });

  it("an eslint-disable in production code is reported as a warning, and the lint script fails on any warning", async () => {
    const messages = await lint(
      "// eslint-disable-next-line no-console\nexport const x = 1;\n",
      PRODUCTION,
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        severity: 1,
        message: expect.stringContaining("noInlineConfig"),
      }),
    );

    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts.lint).toContain("--max-warnings 0");
  });

  it("an eslint-disable in a test file is still honoured", async () => {
    // Control: the rule fires on this text without the directive, so the
    // assertions below cannot pass vacuously.
    const control = await lint("const {} = {};\nexport {};\n", TEST_FILE);
    expect(control).toContainEqual(
      expect.objectContaining({ ruleId: "no-empty-pattern" }),
    );

    const messages = await lint(
      "// eslint-disable-next-line no-empty-pattern\nconst {} = {};\nexport {};\n",
      TEST_FILE,
    );
    expect(
      messages.filter((m) => m.message.includes("noInlineConfig")),
    ).toEqual([]);
    expect(messages.filter((m) => m.ruleId === "no-empty-pattern")).toEqual([]);
  });
});

// Must exist on disk for the project service (see above).
const EXTENSION_TSX = "packages/owlbear/src/panel.tsx";

describe("lint policy for .tsx files", () => {
  it("a .tsx file in the extension other than obr-adapter.ts may not import the Owlbear SDK", async () => {
    const messages = await lint(
      'import OBR from "@owlbear-rodeo/sdk";\nexport const sdk = OBR;\n',
      EXTENSION_TSX,
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-imports", severity: 2 }),
    );
  });

  it("an eslint-disable in a production .tsx file is ignored and reported as a warning", async () => {
    const messages = await lint(
      '// eslint-disable-next-line no-restricted-imports\nimport OBR from "@owlbear-rodeo/sdk";\nexport const sdk = OBR;\n',
      EXTENSION_TSX,
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-imports", severity: 2 }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        severity: 1,
        message: expect.stringContaining("noInlineConfig"),
      }),
    );
  });

  it("the type-aware promise rules apply to .tsx files", async () => {
    const messages = await lint(
      "async function load(): Promise<void> {}\nload();\nexport const handler: () => void = async () => {};\n",
      EXTENSION_TSX,
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "@typescript-eslint/no-floating-promises",
        severity: 2,
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        ruleId: "@typescript-eslint/no-misused-promises",
        severity: 2,
      }),
    );
  });
});

// The settings loader hands plain values to composition roots; no other file in
// packages/*/src may import it. Every path must exist on disk (see above).
const CONFIG_IMPORT =
  'import { loadConfig } from "@ttrpg-agents/config";\nexport const load = loadConfig;\n';

function restrictedImports(messages: Awaited<ReturnType<typeof lint>>) {
  return messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("lint policy for the settings loader", () => {
  it.each([
    "packages/mcp/src/server.ts",
    "packages/bridge/src/server.ts",
    "packages/bridge/src/client.ts",
  ])(
    "a non-root file (%s) may not import @ttrpg-agents/config",
    async (file) => {
      const messages = await lint(CONFIG_IMPORT, file);
      expect(messages).toContainEqual(
        expect.objectContaining({
          ruleId: "no-restricted-imports",
          severity: 2,
        }),
      );
    },
  );

  it.each([
    ["packages/mcp/src/stdio.ts", "packages/mcp/src/server.ts"],
    ["packages/mcp/src/status-cli.ts", "packages/mcp/src/server.ts"],
    ["packages/bridge/src/cli.ts", "packages/bridge/src/server.ts"],
  ])(
    "the composition root %s may import @ttrpg-agents/config",
    async (rootFile, sibling) => {
      // Control: the same import is banned in a sibling of the same package,
      // so the root passing below shows an allowance, not a missing ban.
      const control = await lint(CONFIG_IMPORT, sibling);
      expect(restrictedImports(control)).not.toEqual([]);

      const messages = await lint(CONFIG_IMPORT, rootFile);
      expect(restrictedImports(messages)).toEqual([]);
    },
  );
});

// Only the mcp composition roots may import the bridge client or the settings
// loader; every other mcp file is refused, with a message naming both roots.
const BRIDGE_CLIENT_IMPORT =
  'import { createBridgeClient } from "@ttrpg-agents/bridge/client";\nexport const make = createBridgeClient;\n';
const MCP_ROOTS = [
  "packages/mcp/src/stdio.ts",
  "packages/mcp/src/status-cli.ts",
];

describe("lint policy for the mcp composition roots", () => {
  it("the composition roots stdio.ts and status-cli.ts may import @ttrpg-agents/bridge/client", async () => {
    // Control: a sibling is refused, so the roots passing is an allowance.
    const control = await lint(
      BRIDGE_CLIENT_IMPORT,
      "packages/mcp/src/server.ts",
    );
    expect(restrictedImports(control)).not.toEqual([]);

    for (const rootFile of MCP_ROOTS) {
      const messages = await lint(BRIDGE_CLIENT_IMPORT, rootFile);
      expect(restrictedImports(messages), rootFile).toEqual([]);
    }
  });

  it("an mcp file other than stdio.ts and status-cli.ts may not import @ttrpg-agents/bridge/client or @ttrpg-agents/config", async () => {
    for (const text of [BRIDGE_CLIENT_IMPORT, CONFIG_IMPORT]) {
      const refused = restrictedImports(
        await lint(text, "packages/mcp/src/server.ts"),
      );
      expect(refused, text).toContainEqual(
        expect.objectContaining({ severity: 2 }),
      );
      for (const m of refused) {
        expect(m.message, text).toContain("stdio.ts");
        expect(m.message, text).toContain("status-cli.ts");
      }
    }
  });
});

// Only composition roots read settings: process.env is refused elsewhere in
// packages/*/src (tests excepted). Every path must exist on disk (see above).
const ENV_READ = "export const x = process.env.HOME;\n";

function envReads(messages: Awaited<ReturnType<typeof lint>>) {
  return messages.filter((m) => m.ruleId === "no-restricted-properties");
}

describe("lint policy for process.env", () => {
  it("a file in packages/*/src other than the three composition roots may not read process.env (control: a non-root sibling in each of mcp and bridge is refused)", async () => {
    for (const file of [
      "packages/mcp/src/server.ts",
      "packages/bridge/src/server.ts",
    ]) {
      const messages = await lint(ENV_READ, file);
      expect(messages, file).toContainEqual(
        expect.objectContaining({
          ruleId: "no-restricted-properties",
          severity: 2,
        }),
      );
    }
  });

  it("each composition root (mcp/src/stdio.ts, mcp/src/status-cli.ts, bridge/src/cli.ts) may read process.env", async () => {
    for (const [rootFile, sibling] of [
      ["packages/mcp/src/stdio.ts", "packages/mcp/src/server.ts"],
      ["packages/mcp/src/status-cli.ts", "packages/mcp/src/server.ts"],
      ["packages/bridge/src/cli.ts", "packages/bridge/src/server.ts"],
    ] as const) {
      // Control: the same read is refused in a sibling of the same package.
      expect(envReads(await lint(ENV_READ, sibling)), sibling).not.toEqual([]);
      expect(envReads(await lint(ENV_READ, rootFile)), rootFile).toEqual([]);
    }
  });
});
