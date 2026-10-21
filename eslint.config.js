import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const SDK_MESSAGE =
  "Import the SDK only in obr-adapter.ts; depend on ObrAdapter elsewhere.";
const CORE_ROOT_MESSAGE =
  "The @ttrpg-agents/core root is not browser-safe yet (it imports Node builtins); import the browser-safe @ttrpg-agents/protocol for the wire contract.";
const NODE_BUILTIN_MESSAGE =
  "The extension runs in the browser; Node builtins are not available.";
const PROTOCOL_MESSAGE =
  "@ttrpg-agents/protocol is loaded by the browser extension and must stay browser-safe.";

const sdkPath = { name: "@owlbear-rodeo/sdk", message: SDK_MESSAGE };
const sdkPattern = { group: ["@owlbear-rodeo/sdk/*"], message: SDK_MESSAGE };
const coreRootPath = { name: "@ttrpg-agents/core", message: CORE_ROOT_MESSAGE };
const nodeBuiltinsPattern = {
  group: ["node:*"],
  message: NODE_BUILTIN_MESSAGE,
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
      "**/dist-e2e/",
      "**/test-results/",
      "**/playwright-report/",
      "**/node_modules/",
      ".claude/",
      ".stryker-tmp/",
      "reports/",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    // Promise-heavy code (bridge, sockets, sync): needs type information, so
    // scope it to the sources and scripts the root tsconfig covers.
    files: ["packages/*/src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // Only the adapter may touch the SDK; everything else uses ObrAdapter so
    // it can be unit-tested with the fake (see packages/owlbear/README.md).
    // The extension runs in the browser, so it must not pull in the core root
    // (it imports Node builtins) or Node builtins itself.
    files: ["packages/owlbear/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [sdkPath, coreRootPath],
          patterns: [sdkPattern, nodeBuiltinsPattern],
        },
      ],
    },
  },
  {
    // Later matching configs replace earlier rule options, so restate the
    // core-root and node:* restrictions without the SDK entries.
    files: ["packages/owlbear/src/obr-adapter.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [coreRootPath],
          patterns: [nodeBuiltinsPattern],
        },
      ],
    },
  },
  {
    // The protocol package is bundled into the browser extension, so it must
    // stay browser-safe: no Node builtins, no ws or MCP SDK, and no other
    // workspace package (that would pull in the core root).
    files: ["packages/protocol/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "ws", message: PROTOCOL_MESSAGE }],
          patterns: [
            { group: ["node:*"], message: PROTOCOL_MESSAGE },
            { group: ["ws/*"], message: PROTOCOL_MESSAGE },
            { group: ["@modelcontextprotocol/*"], message: PROTOCOL_MESSAGE },
            { group: ["@ttrpg-agents/*"], message: PROTOCOL_MESSAGE },
          ],
        },
      ],
    },
  },
);
