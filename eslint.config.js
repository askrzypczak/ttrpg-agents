import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const SDK_MESSAGE =
  "Import the SDK only in obr-adapter.ts; depend on ObrAdapter elsewhere.";
const CORE_ROOT_MESSAGE =
  "The @ttrpg-agents/core root pulls in the encounter store and node:sqlite; import a browser-safe subpath such as @ttrpg-agents/core/bridge.";
const NODE_BUILTIN_MESSAGE =
  "The extension runs in the browser; Node builtins are not available.";
const BRIDGE_MESSAGE =
  "bridge/** is loaded by the browser extension and must stay browser-safe.";

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
    // Only the adapter may touch the SDK; everything else uses ObrAdapter so
    // it can be unit-tested with the fake (see packages/owlbear/README.md).
    // The extension runs in the browser, so it must not pull in the core root
    // (encounter store, node:sqlite) or Node builtins either.
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
    // bridge/** is shipped to the browser extension via @ttrpg-agents/core/bridge.
    files: ["packages/core/src/bridge/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "ws", message: BRIDGE_MESSAGE }],
          patterns: [
            { group: ["node:*"], message: BRIDGE_MESSAGE },
            { group: ["ws/*"], message: BRIDGE_MESSAGE },
            { group: ["@modelcontextprotocol/*"], message: BRIDGE_MESSAGE },
            {
              group: [
                "../encounter",
                "../encounter/**",
                "../monsters",
                "../monsters/**",
                "../index.js",
              ],
              message: BRIDGE_MESSAGE,
            },
          ],
        },
      ],
    },
  },
);
