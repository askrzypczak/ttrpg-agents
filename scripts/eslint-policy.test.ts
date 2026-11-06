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
