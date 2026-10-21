import { describe, expect, it } from "vitest";
import {
  formatMutationSummary,
  MAX_LISTED,
  type MutationReport,
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

const mutant = (
  status: string,
  line: number,
  mutatorName = "BlockStatement",
) => ({ status, mutatorName, location: { start: { line } } });

describe("formatMutationSummary", () => {
  const report: MutationReport = {
    files: {
      "packages/a/src/b.ts": {
        mutants: [
          mutant("Killed", 1),
          mutant("Timeout", 2),
          mutant("Survived", 5, "EqualityOperator"),
          mutant("NoCoverage", 9),
          mutant("NoCoverage", 9),
          mutant("CompileError", 11),
        ],
      },
      "packages/a/src/a.ts": { mutants: [mutant("Killed", 3)] },
    },
  };

  it("reports totals, score and per-file counts without any source", () => {
    const out = formatMutationSummary(report);
    // 3 detected of 6 valid overall; b.ts alone is 2 of 5 (compile error excluded)
    expect(out).toContain("**Score 50.0%** over 7 mutants");
    expect(out).toContain("2 killed, 1 timeout, 1 survived, 2 no coverage");
    expect(out).toContain("| packages/a/src/b.ts | 6 | 3 | 40.0% |");
    expect(out).toContain("| packages/a/src/a.ts | 1 | 0 | 100.0% |");
  });

  it("lists uncaught locations compactly, grouped per line and sorted", () => {
    const out = formatMutationSummary(report);
    expect(out).toContain(
      "packages/a/src/b.ts:5 EqualityOperator (Survived)\n" +
        "packages/a/src/b.ts:9 BlockStatement (NoCoverage) x2\n",
    );
  });

  it("omits the location list when nothing is uncaught", () => {
    const out = formatMutationSummary({
      files: { "x.ts": { mutants: [mutant("Killed", 1)] } },
    });
    expect(out).not.toContain("```");
    expect(out).toContain("**Score 100.0%**");
  });

  it("caps the location list and counts the rest", () => {
    const mutants = Array.from({ length: MAX_LISTED + 5 }, (_, i) =>
      mutant("Survived", i + 1),
    );
    const out = formatMutationSummary({ files: { "x.ts": { mutants } } });
    expect(out.match(/^x\.ts:\d+ /gm)).toHaveLength(MAX_LISTED);
    expect(out).toContain("... and 5 more locations");
  });

  it("shows n/a for a report with no valid mutants", () => {
    expect(formatMutationSummary({ files: {} })).toContain("**Score n/a**");
  });
});
