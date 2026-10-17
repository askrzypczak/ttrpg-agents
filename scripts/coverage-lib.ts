// Pure helpers for scripts/coverage.ts: Istanbul coverage merge and the
// per-kind summary table. No I/O, so it is unit-tested directly.
import libCoverage from "istanbul-lib-coverage";
import type { CoverageMapData, FileCoverageData } from "istanbul-lib-coverage";

export interface Metric {
  total: number;
  covered: number;
  pct: number;
}

export interface Summary {
  lines: Metric;
  branches: Metric;
  functions: Metric;
}

/** One table row; `summary` is null when that kind produced no coverage. */
export interface Row {
  kind: string;
  summary: Summary | null;
}

export function summarize(data: CoverageMapData): Summary {
  const s = libCoverage.createCoverageMap(data).getCoverageSummary();
  const pick = (m: Metric): Metric => ({
    total: m.total,
    covered: m.covered,
    // istanbul reports "Unknown" for empty metrics
    pct: m.total === 0 ? 100 : m.pct,
  });
  return {
    lines: pick(s.lines),
    branches: pick(s.branches),
    functions: pick(s.functions),
  };
}

/**
 * Merges coverage maps. Items (statements, functions, branches) are matched by
 * source location and their hit counts summed, so maps produced by different
 * converters for the same file are unioned instead of corrupted.
 */
export function mergeCoverage(...maps: CoverageMapData[]): CoverageMapData {
  const out: Record<string, FileCoverageData> = {};
  for (const map of maps) {
    for (const [file, data] of Object.entries(map)) {
      const existing = out[file];
      out[file] = existing ? mergeFile(existing, data) : cloneFile(data);
    }
  }
  return out as CoverageMapData;
}

function cloneFile(data: FileCoverageData): FileCoverageData {
  return mergeFile(emptyFile(data.path), data);
}

function emptyFile(path: string): FileCoverageData {
  return {
    path,
    statementMap: {},
    fnMap: {},
    branchMap: {},
    s: {},
    f: {},
    b: {},
  };
}

function mergeFile(a: FileCoverageData, b: FileCoverageData): FileCoverageData {
  const out = emptyFile(a.path);

  const statements = new Map<string, string>();
  const addStatements = (d: FileCoverageData) => {
    for (const [id, loc] of Object.entries(d.statementMap)) {
      const key = JSON.stringify(loc);
      let target = statements.get(key);
      if (target === undefined) {
        target = String(statements.size);
        statements.set(key, target);
        out.statementMap[target] = loc;
        out.s[target] = 0;
      }
      out.s[target] = (out.s[target] ?? 0) + (d.s[id] ?? 0);
    }
  };

  const fns = new Map<string, string>();
  const addFns = (d: FileCoverageData) => {
    for (const [id, fn] of Object.entries(d.fnMap)) {
      const key = JSON.stringify(fn.loc);
      let target = fns.get(key);
      if (target === undefined) {
        target = String(fns.size);
        fns.set(key, target);
        out.fnMap[target] = fn;
        out.f[target] = 0;
      }
      out.f[target] = (out.f[target] ?? 0) + (d.f[id] ?? 0);
    }
  };

  const branches = new Map<string, string>();
  const addBranches = (d: FileCoverageData) => {
    for (const [id, br] of Object.entries(d.branchMap)) {
      const key = JSON.stringify([br.type, br.locations]);
      let target = branches.get(key);
      if (target === undefined) {
        target = String(branches.size);
        branches.set(key, target);
        out.branchMap[target] = br;
        out.b[target] = br.locations.map(() => 0);
      }
      const counts = out.b[target] ?? [];
      (d.b[id] ?? []).forEach((n, i) => {
        counts[i] = (counts[i] ?? 0) + n;
      });
      out.b[target] = counts;
    }
  };

  for (const d of [a, b]) {
    addStatements(d);
    addFns(d);
    addBranches(d);
  }
  return out;
}

const COLUMNS = ["lines", "branches", "functions"] as const;

function cell(m: Metric): string {
  return `${m.pct.toFixed(2)}% (${m.covered}/${m.total})`;
}

function cells(row: Row): string[] {
  return COLUMNS.map((c) => (row.summary ? cell(row.summary[c]) : "n/a"));
}

export function formatTable(rows: Row[]): string {
  const header = ["kind", ...COLUMNS];
  const body = rows.map((r) => [r.kind, ...cells(r)]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((r) => (r[i] ?? "").length)),
  );
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [
    line(header),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...body.map(line),
  ].join("\n");
}

export function formatMarkdown(rows: Row[]): string {
  const line = (r: string[]) => `| ${r.join(" | ")} |`;
  return [
    "## Coverage",
    "",
    line(["kind", ...COLUMNS]),
    line(["---", "---:", "---:", "---:"]),
    ...rows.map((r) => line([r.kind, ...cells(r)])),
    "",
  ].join("\n");
}

/** The sticky PR comment body: the markdown table plus a footer line. */
export function formatComment(rows: Row[]): string {
  return `${formatMarkdown(rows)}\n_Informational only; updated on every push._\n`;
}
