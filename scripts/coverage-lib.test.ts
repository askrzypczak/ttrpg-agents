import { describe, expect, it } from "vitest";
import type { CoverageMapData } from "istanbul-lib-coverage";
import {
  formatComment,
  formatDelta,
  formatHeadline,
  formatMarkdown,
  formatPatch,
  formatTable,
  makeBaseline,
  mergeCoverage,
  parseBaseline,
  parseDiffAddedLines,
  patchCoverage,
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

describe("formatComment", () => {
  const unit = summarize(map(file("/a.ts", [1, 0], [1, 0])));
  const rows: Row[] = [
    { kind: "unit", summary: unit },
    { kind: "e2e", summary: null },
  ];

  it("contains the markdown table from formatMarkdown", () => {
    expect(formatComment(rows)).toContain(formatMarkdown(rows, false));
  });

  it("puts the headline first and the table inside collapsed details", () => {
    const out = formatComment(rows, { delta: "50.00% (+1.00)", patch: "x" });
    expect(
      out.startsWith("## Coverage\n\n**Line coverage:** 50.00% (+1.00)\n"),
    ).toBe(true);
    expect(out.match(/## Coverage/g)).toHaveLength(1);
    const open = out.indexOf("<details><summary>Per-kind coverage</summary>");
    const close = out.indexOf("</details>");
    const table = out.indexOf("| kind |");
    expect(open).toBeGreaterThan(0);
    expect(table).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(table);
  });

  it("omits the headline when none is given", () => {
    expect(formatComment(rows).startsWith("## Coverage\n\n<details>")).toBe(
      true,
    );
  });

  it("ends with the informational footer after the details", () => {
    expect(formatComment(rows)).toMatch(
      /<\/details>\n\n_Informational only; updated on every push\._\n$/,
    );
  });

  it("renders a null summary as n/a", () => {
    expect(formatComment(rows)).toContain("| e2e | n/a | n/a | n/a |");
  });
});

describe("parseDiffAddedLines", () => {
  const head = (a: string, b = a) =>
    `diff --git a/${a} b/${b}\nindex 1..2 100644\n--- a/${a}\n+++ b/${b}\n`;

  it("parses a single hunk with a count", () => {
    const d = head("a.ts") + "@@ -1,2 +10,3 @@\n+x\n+y\n+z\n";
    expect(parseDiffAddedLines(d).get("a.ts")).toEqual([10, 11, 12]);
  });

  it("treats an omitted count as one line", () => {
    const d = head("a.ts") + "@@ -5 +7 @@\n-x\n+y\n";
    expect(parseDiffAddedLines(d).get("a.ts")).toEqual([7]);
  });

  it("ignores pure deletions (count 0)", () => {
    const d = head("a.ts") + "@@ -5,2 +4,0 @@\n-x\n-y\n";
    expect(parseDiffAddedLines(d).has("a.ts")).toBe(false);
  });

  it("collects multiple hunks and files", () => {
    const d =
      head("a.ts") +
      "@@ -1 +1,2 @@\n+a\n+b\n@@ -9,0 +20 @@\n+c\n" +
      head("b.ts") +
      "@@ -0,0 +1 @@\n+d\n";
    const m = parseDiffAddedLines(d);
    expect(m.get("a.ts")).toEqual([1, 2, 20]);
    expect(m.get("b.ts")).toEqual([1]);
  });

  it("handles new files", () => {
    const d =
      "diff --git a/n.ts b/n.ts\nnew file mode 100644\nindex 0..2\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n";
    expect(parseDiffAddedLines(d).get("n.ts")).toEqual([1, 2]);
  });

  it("skips deleted files", () => {
    const d =
      "diff --git a/d.ts b/d.ts\ndeleted file mode 100644\nindex 1..0\n--- a/d.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n";
    expect(parseDiffAddedLines(d).size).toBe(0);
  });

  it("uses the new path for renames with edits", () => {
    const d =
      "diff --git a/old.ts b/new.ts\nsimilarity index 80%\nrename from old.ts\nrename to new.ts\nindex 1..2 100644\n--- a/old.ts\n+++ b/new.ts\n@@ -3 +3 @@\n-a\n+b\n";
    const m = parseDiffAddedLines(d);
    expect(m.get("new.ts")).toEqual([3]);
    expect(m.has("old.ts")).toBe(false);
  });

  it("ignores binary files", () => {
    const d =
      "diff --git a/i.png b/i.png\nindex 1..2\nBinary files a/i.png and b/i.png differ\n" +
      head("a.ts") +
      "@@ -1 +1 @@\n+x\n";
    expect([...parseDiffAddedLines(d).keys()]).toEqual(["a.ts"]);
  });

  it("does not mistake an added line starting with ++ for a header", () => {
    const d = head("a.ts") + "@@ -1 +1,2 @@\n+++ b/fake\n+y\n";
    const m = parseDiffAddedLines(d);
    expect([...m.keys()]).toEqual(["a.ts"]);
    expect(m.get("a.ts")).toEqual([1, 2]);
  });

  it("returns an empty map for an empty diff", () => {
    expect(parseDiffAddedLines("").size).toBe(0);
  });
});

describe("patchCoverage", () => {
  // statements on lines 1..4 with hits 1,0,1,0; other lines are not coverable
  const m = map(file("/repo/src/a.ts", [1, 0, 1, 0]));

  it("counts covered and uncovered coverable changed lines", () => {
    const r = patchCoverage(m, new Map([["src/a.ts", [1, 2, 3, 4]]]), "/repo");
    expect(r).toEqual({ covered: 2, total: 4 });
  });

  it("reports all covered", () => {
    const r = patchCoverage(m, new Map([["src/a.ts", [1, 3]]]), "/repo/");
    expect(r).toEqual({ covered: 2, total: 2 });
  });

  it("ignores changed lines that are not coverable", () => {
    const r = patchCoverage(
      m,
      new Map([["src/a.ts", [3, 5, 6, 100]]]),
      "/repo",
    );
    expect(r).toEqual({ covered: 1, total: 1 });
  });

  it("ignores files absent from the map", () => {
    const r = patchCoverage(m, new Map([["README.md", [1, 2]]]), "/repo");
    expect(r).toEqual({ covered: 0, total: 0 });
  });

  it("returns zero totals for an empty patch", () => {
    expect(patchCoverage(m, new Map(), "/repo")).toEqual({
      covered: 0,
      total: 0,
    });
  });
});

describe("baseline", () => {
  it("round-trips the combined line percentage", () => {
    const s = summarize(map(file("/a.ts", [1, 0])));
    expect(parseBaseline(makeBaseline(s))).toBe(50);
  });

  it.each([
    ["not json", "{nope"],
    ["wrong shape", '{"foo":1}'],
    ["non-numeric pct", '{"lines":{"pct":"90"}}'],
    ["empty", ""],
    ["null", "null"],
  ])("returns null for %s", (_n, json) => {
    expect(parseBaseline(json)).toBeNull();
  });
});

describe("formatDelta", () => {
  it("shows a positive delta", () => {
    expect(formatDelta(84.12, 83.72)).toBe("84.12% (+0.40)");
  });
  it("shows a negative delta", () => {
    expect(formatDelta(83.72, 84.12)).toBe("83.72% (-0.40)");
  });
  it("shows plus-minus zero when equal", () => {
    expect(formatDelta(80, 80)).toBe("80.00% (±0.00)");
  });
  it("rounds tiny differences to zero", () => {
    expect(formatDelta(80.001, 80)).toBe("80.00% (±0.00)");
  });
  it("handles a missing baseline", () => {
    expect(formatDelta(84.123, null)).toBe("84.12% (no baseline)");
  });
});

describe("formatPatch", () => {
  it("formats covered/total", () => {
    expect(formatPatch({ covered: 24, total: 26 })).toBe("92.3% (24/26 lines)");
  });
  it("explains an empty patch", () => {
    expect(formatPatch({ covered: 0, total: 0 })).toBe(
      "no coverable lines changed",
    );
    expect(formatPatch(null)).toBe("no coverable lines changed");
  });
});

describe("formatHeadline", () => {
  it("renders both lines", () => {
    expect(formatHeadline({ delta: "d", patch: "p" })).toBe(
      "**Line coverage:** d\n**Patch coverage:** p\n",
    );
  });
});
