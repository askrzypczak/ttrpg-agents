import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/",
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
    files: ["packages/owlbear/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@owlbear-rodeo/sdk",
              message:
                "Import the SDK only in obr-adapter.ts; depend on ObrAdapter elsewhere.",
            },
          ],
          patterns: [
            {
              group: ["@owlbear-rodeo/sdk/*"],
              message:
                "Import the SDK only in obr-adapter.ts; depend on ObrAdapter elsewhere.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/owlbear/src/obr-adapter.ts"],
    rules: { "no-restricted-imports": "off" },
  },
);
