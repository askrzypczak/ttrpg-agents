import { describe, expect, it } from "vitest";
import type { CoverageMapData } from "istanbul-lib-coverage";
import {
  formatMarkdown,
  formatTable,
  mergeCoverage,
  summarize,
  type Row,
} from "./coverage-lib.ts";

const loc = (line: number) => ({
  start: { line, column: 0 },
  end: { line, column: 10 },
});

/** A file with statements on lines 1..n; hits[i] is the count for line i+1. */
function file(path: string, hits: number[], branchHits?: number[]) {
  return {
    path,
    statementMap: Object.fromEntries(hits.map((_, i) => [i, loc(i + 1)])),
    s: Object.fromEntries(hits.map((h, i) => [i, h])),
    fnMap: { 0: { name: "f", decl: loc(1), loc: loc(1), line: 1 } },
    f: { 0: hits[0] ?? 0 },
    branchMap: branchHits
      ? {
          0: {
            type: "if",
            loc: loc(1),
            locations: branchHits.map(() => loc(1)),
            line: 1,
          },
        }
      : {},
    b: branchHits ? { 0: branchHits } : {},
  };
}

const map = (...files: ReturnType<typeof file>[]): CoverageMapData =>
  Object.fromEntries(files.map((f) => [f.path, f])) as CoverageMapData;

describe("summarize", () => {
  it("computes covered/total/pct per metric", () => {
    const s = summarize(map(file("/a.ts", [1, 0, 1, 1], [1, 0])));
    expect(s.lines).toMatchObject({ total: 4, covered: 3, pct: 75 });
    expect(s.branches).toMatchObject({ total: 2, covered: 1, pct: 50 });
    expect(s.functions).toMatchObject({ total: 1, covered: 1, pct: 100 });
  });

  it("reports an empty map as 100% of nothing, not NaN", () => {
    const s = summarize({});
    expect(s.lines).toEqual({ total: 0, covered: 0, pct: 100 });
  });
});

describe("mergeCoverage", () => {
  it("unions hits for the same file so the total beats each kind", () => {
    const unit = map(file("/a.ts", [1, 0, 0], [1, 0]));
    const e2e = map(file("/a.ts", [0, 1, 0], [0, 1]));
    const total = summarize(mergeCoverage(unit, e2e));
    expect(total.lines.covered).toBe(2);
    expect(total.lines.covered).toBeGreaterThan(summarize(unit).lines.covered);
    expect(total.branches.covered).toBe(2);
  });

  it("sums hit counts for matching items", () => {
    const merged = mergeCoverage(
      map(file("/a.ts", [2])),
      map(file("/a.ts", [3])),
    );
    expect(merged["/a.ts"]?.s).toEqual({ 0: 5 });
    expect(merged["/a.ts"]?.f).toEqual({ 0: 5 });
  });

  it("keeps files that appear in only one map", () => {
    const merged = mergeCoverage(
      map(file("/a.ts", [1])),
      map(file("/b.ts", [0])),
    );
    expect(Object.keys(merged).sort()).toEqual(["/a.ts", "/b.ts"]);
  });

  it("unions items with different locations instead of corrupting them", () => {
    const merged = mergeCoverage(
      map(file("/a.ts", [1])),
      map(file("/a.ts", [0, 1])),
    );
    expect(Object.keys(merged["/a.ts"]?.statementMap ?? {})).toHaveLength(2);
    expect(summarize(merged).lines).toMatchObject({ total: 2, covered: 2 });
  });

  it("does not mutate its inputs", () => {
    const a = map(file("/a.ts", [1]));
    const before = JSON.stringify(a);
    mergeCoverage(a, map(file("/a.ts", [4])));
    expect(JSON.stringify(a)).toBe(before);
  });

  it("returns an empty map for no input", () => {
    expect(mergeCoverage()).toEqual({});
  });
});

describe("formatTable / formatMarkdown", () => {
  const unit = summarize(map(file("/a.ts", [1, 0], [1, 0])));
  const rows: Row[] = [
    { kind: "unit", summary: unit },
    { kind: "e2e", summary: null },
  ];

  it("prints one row per kind with all three metrics", () => {
    const out = formatTable(rows).split("\n");
    expect(out[0]).toMatch(/^kind\s+lines\s+branches\s+functions$/);
    expect(out[2]).toContain("50.00% (1/2)");
    expect(out[2]).toContain("100.00% (1/1)");
  });

  it("shows n/a for a kind that was skipped instead of crashing", () => {
    const out = formatTable(rows).split("\n");
    expect(out[3]).toMatch(/^e2e\s+n\/a\s+n\/a\s+n\/a$/);
  });

  it("renders a markdown table", () => {
    const md = formatMarkdown(rows).split("\n");
    expect(md).toContain("| kind | lines | branches | functions |");
    expect(md).toContain(
      "| unit | 50.00% (1/2) | 50.00% (1/2) | 100.00% (1/1) |",
    );
    expect(md).toContain("| e2e | n/a | n/a | n/a |");
  });
});
