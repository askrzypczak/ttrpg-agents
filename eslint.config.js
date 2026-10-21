import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const SDK_MESSAGE =
  "Import the SDK only in obr-adapter.ts; depend on ObrAdapter elsewhere.";
const NODE_BUILTIN_MESSAGE =
  "The extension runs in the browser; Node builtins are not available.";
const OWLBEAR_MESSAGE =
  "The browser extension may import only @ttrpg-agents/engine and @ttrpg-agents/protocol (both browser-safe).";
const ENGINE_MESSAGE =
  "The engine is Node-free and imports no other workspace package.";
const PROTOCOL_MESSAGE =
  "@ttrpg-agents/protocol is loaded by the browser extension and must stay browser-safe; it may import only @ttrpg-agents/engine.";
const ADAPTER_MESSAGE =
  "Adapters depend on @ttrpg-agents/engine only (and, in tests, on each other and on srd).";
const MCP_MESSAGE =
  "@ttrpg-agents/mcp must not import the bridge; the bridge is a separate process.";
const BRIDGE_MESSAGE =
  "@ttrpg-agents/bridge must not import mcp; the two are separate entry points.";

const sdkPath = { name: "@owlbear-rodeo/sdk", message: SDK_MESSAGE };
const sdkPattern = { group: ["@owlbear-rodeo/sdk/*"], message: SDK_MESSAGE };
const nodeBuiltinsPattern = {
  group: ["node:*"],
  message: NODE_BUILTIN_MESSAGE,
};

/**
 * Bans every workspace package except the `allowed` ones (names without the
 * scope). The `!` entries are gitignore-style negations that re-allow those
 * packages after the broad `@ttrpg-agents/*` ban.
 */
function workspaceBan(allowed, message) {
  return {
    group: [
      "@ttrpg-agents/*",
      ...allowed.map((name) => `!@ttrpg-agents/${name}`),
    ],
    message,
  };
}

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
    // Dependency direction (see CLAUDE.md, Architecture). The engine imports
    // no workspace package at all; its tests are exempt. The build
    // (packages/engine/tsconfig.build.json, types: []) keeps it free of Node.
    files: ["packages/engine/src/**/*.ts"],
    ignores: ["packages/engine/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [workspaceBan([], ENGINE_MESSAGE)] },
      ],
    },
  },
  {
    // The protocol package is bundled into the browser extension, so it must
    // stay browser-safe: no Node builtins, no ws or MCP SDK, and no workspace
    // package except the (Node-free) engine.
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
            workspaceBan(["engine"], PROTOCOL_MESSAGE),
          ],
        },
      ],
    },
  },
  {
    // Adapters (store, SRD data) depend on the engine only. Their tests may
    // also use each other and the SRD data.
    files: ["packages/store-sqlite/src/**/*.ts", "packages/srd/src/**/*.ts"],
    ignores: ["packages/*/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [workspaceBan(["engine"], ADAPTER_MESSAGE)] },
      ],
    },
  },
  {
    files: [
      "packages/store-sqlite/src/**/*.test.ts",
      "packages/srd/src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            workspaceBan(["engine", "srd", "store-sqlite"], ADAPTER_MESSAGE),
          ],
        },
      ],
    },
  },
  {
    // The MCP server and the bridge are separate entry points; neither imports
    // the other.
    files: ["packages/mcp/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ttrpg-agents/bridge", "@ttrpg-agents/bridge/**"],
              message: MCP_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/bridge/src/**/*.ts"],
    ignores: ["packages/bridge/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ttrpg-agents/mcp", "@ttrpg-agents/mcp/**"],
              message: BRIDGE_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // Only the adapter may touch the SDK; everything else uses ObrAdapter so
    // it can be unit-tested with the fake (see packages/owlbear/README.md).
    // The extension runs in the browser: it may import only the browser-safe
    // engine and protocol packages, and no Node builtins.
    files: ["packages/owlbear/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [sdkPath],
          patterns: [
            sdkPattern,
            nodeBuiltinsPattern,
            workspaceBan(["engine", "protocol"], OWLBEAR_MESSAGE),
          ],
        },
      ],
    },
  },
  {
    // Later matching configs replace earlier rule options, so restate the
    // workspace and node:* restrictions without the SDK entries.
    files: ["packages/owlbear/src/obr-adapter.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            nodeBuiltinsPattern,
            workspaceBan(["engine", "protocol"], OWLBEAR_MESSAGE),
          ],
        },
      ],
    },
  },
);
