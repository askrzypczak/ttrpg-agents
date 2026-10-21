import { describe, expect, it } from "vitest";
import {
  COMMENT_LIMIT,
  formatMutationComment,
  selectMutateFiles,
} from "./mutate-lib.ts";

const PATTERNS = [
  "packages/*/src/**/*.ts",
  "!packages/*/src/**/*.test.ts",
  "!packages/*/src/**/index.ts",
  "!packages/owlbear/src/obr-adapter.ts",
];

const PROD = "packages/engine/src/dice/roll.ts";

const lines = (...ls: string[]) => ls.join("\n") + "\n";

describe("selectMutateFiles", () => {
  it("selects an added production file", () => {
    expect(selectMutateFiles(lines(`A\t${PROD}`), PATTERNS)).toEqual([PROD]);
  });

  it("selects a modified production file", () => {
    expect(selectMutateFiles(lines(`M\t${PROD}`), PATTERNS)).toEqual([PROD]);
  });

  it("drops a deleted file", () => {
    expect(
      selectMutateFiles(
        lines(`D\tpackages/engine/src/gone.ts`, `M\t${PROD}`),
        PATTERNS,
      ),
    ).toEqual([PROD]);
  });

  it("takes the new path of a renamed file", () => {
    expect(
      selectMutateFiles(
        lines(`R100\tpackages/engine/src/old.ts\tpackages/engine/src/new.ts`),
        PATTERNS,
      ),
    ).toEqual(["packages/engine/src/new.ts"]);
  });

  it("drops *.test.ts and *.integration.test.ts files", () => {
    expect(
      selectMutateFiles(
        lines(
          `A\tpackages/engine/src/dice/roll.test.ts`,
          `M\tpackages/store-sqlite/src/store.integration.test.ts`,
          `M\t${PROD}`,
        ),
        PATTERNS,
      ),
    ).toEqual([PROD]);
  });

  it("drops index.ts files", () => {
    expect(
      selectMutateFiles(
        lines(
          `M\tpackages/engine/src/index.ts`,
          `A\tpackages/engine/src/dice/index.ts`,
          `M\t${PROD}`,
        ),
        PATTERNS,
      ),
    ).toEqual([PROD]);
  });

  it("drops a file excluded by a negated config pattern", () => {
    expect(
      selectMutateFiles(
        lines(
          `M\tpackages/owlbear/src/obr-adapter.ts`,
          `M\tpackages/owlbear/src/scene.ts`,
        ),
        PATTERNS,
      ),
    ).toEqual(["packages/owlbear/src/scene.ts"]);
  });

  it("drops files outside the mutate globs (e.g. scripts/x.ts, README.md, packages/a/src/data.json)", () => {
    expect(
      selectMutateFiles(
        lines(
          `M\tscripts/x.ts`,
          `M\tREADME.md`,
          `A\tpackages/a/src/data.json`,
          `M\t${PROD}`,
        ),
        PATTERNS,
      ),
    ).toEqual([PROD]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(
      selectMutateFiles(
        lines(`M\tREADME.md`, `D\t${PROD}`, `M\tscripts/x.ts`),
        PATTERNS,
      ),
    ).toEqual([]);
  });
});

describe("formatMutationComment", () => {
  const fenced = (body: string): string => {
    const open = body.indexOf("```");
    const close = body.lastIndexOf("```");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    return body.slice(open, close + 3);
  };

  it("formatMutationComment strips ANSI colour codes", () => {
    const out = formatMutationComment(
      "\u001b[32mKilled\u001b[39m: 3\n\u001b[31mSurvived\u001b[39m: 1\n",
    );
    expect(out).not.toContain("\u001b");
    expect(out).toContain("Killed: 3");
    expect(out).toContain("Survived: 1");
  });

  it("formatMutationComment truncates input longer than COMMENT_LIMIT with a notice", () => {
    const report = "Survived mutant line\n".repeat(
      Math.ceil((COMMENT_LIMIT * 2) / 21),
    );
    const out = formatMutationComment(report);
    expect(out.length).toBeLessThanOrEqual(COMMENT_LIMIT);
    expect(fenced(out)).toContain("Survived mutant line");
    expect(out).toMatch(/artifact/i);
  });

  it("formatMutationComment keeps a short report whole in a fenced block", () => {
    const report =
      "Mutation score: 81.25%\nSurvived: src/a.ts:3 ConditionalExpression";
    const out = formatMutationComment(report);
    expect(fenced(out)).toContain(report);
    expect(out.length).toBeLessThanOrEqual(COMMENT_LIMIT);
  });
});
