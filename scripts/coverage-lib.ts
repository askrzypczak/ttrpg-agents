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

/**
 * True when unit, integration and e2e were all collected. Only a complete run
 * may become the main baseline; extra keys are ignored.
 */
export function isCompleteRun(
  maps: Record<string, CoverageMapData | null>,
): boolean {
  return ["unit", "integration", "e2e"].every(
    (k) => (maps[k] ?? null) !== null,
  );
}

/**
 * Process exit code for the coverage script: 1 when any test run failed
 * (`failedRuns` lists the kinds whose run failed, e.g. ["unit"]), else 0.
 */
export function exitCode(failedRuns: readonly string[]): 0 | 1 {
  return failedRuns.length > 0 ? 1 : 0;
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

export function formatMarkdown(rows: Row[], heading = true): string {
  const line = (r: string[]) => `| ${r.join(" | ")} |`;
  return [
    ...(heading ? ["## Coverage", ""] : []),
    line(["kind", ...COLUMNS]),
    line(["---", "---:", "---:", "---:"]),
    ...rows.map((r) => line([r.kind, ...cells(r)])),
    "",
  ].join("\n");
}

export interface PatchResult {
  covered: number;
  total: number;
}

/**
 * Parses `git diff -U0` output into the added/changed line numbers (new side)
 * per repo-relative path. Deleted files, pure deletions and binary files
 * yield no entries.
 */
export function parseDiffAddedLines(diff: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let inHeader = false;
  let current: number[] | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      current = null;
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      const target = line.slice(4).split("\t")[0] ?? "";
      if (target.startsWith("b/")) {
        const path = target.slice(2);
        current = out.get(path) ?? [];
        out.set(path, current);
      } else {
        current = null; // /dev/null: file deleted
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      inHeader = false;
      if (!current) continue;
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let n = start; n < start + count; n++) current.push(n);
    }
  }
  for (const [path, lines] of out) if (lines.length === 0) out.delete(path);
  return out;
}

/**
 * Coverage of the added lines. Only lines Istanbul considers coverable (they
 * carry a statement) count; files absent from the map contribute nothing.
 * `root` resolves repo-relative diff paths to the map's absolute keys.
 */
export function patchCoverage(
  map: CoverageMapData,
  added: Map<string, number[]>,
  root: string,
): PatchResult {
  const base = root.endsWith("/") ? root : `${root}/`;
  const result = { covered: 0, total: 0 };
  for (const [path, lines] of added) {
    const data = map[`${base}${path}`];
    if (!data) continue;
    const hits = libCoverage.createFileCoverage(data).getLineCoverage();
    for (const n of lines) {
      const h = hits[n];
      if (h === undefined) continue;
      result.total++;
      if (h > 0) result.covered++;
    }
  }
  return result;
}

/** Serialises the combined summary for use as a later baseline. */
export function makeBaseline(summary: Summary): string {
  return JSON.stringify(summary, null, 2);
}

/** Baseline line coverage percent from baseline JSON, or null if unusable. */
export function parseBaseline(json: string): number | null {
  try {
    const pct = (JSON.parse(json) as { lines?: { pct?: unknown } } | null)
      ?.lines?.pct;
    return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
  } catch {
    return null;
  }
}

export function formatDelta(pct: number, base: number | null): string {
  if (base === null) return `${pct.toFixed(2)}% (no baseline)`;
  const diff = Number((pct - base).toFixed(2));
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
  return `${pct.toFixed(2)}% (${sign}${Math.abs(diff).toFixed(2)})`;
}

export function formatPatch(res: PatchResult | null): string {
  if (res === null || res.total === 0) return "no coverable lines changed";
  const pct = ((res.covered / res.total) * 100).toFixed(1);
  return `${pct}% (${res.covered}/${res.total} lines)`;
}

export interface Headline {
  /** Combined line coverage, already formatted by formatDelta. */
  delta: string;
  /** Already formatted by formatPatch. */
  patch: string;
}

export function formatHeadline(h: Headline): string {
  return `**Line coverage:** ${h.delta}\n**Patch coverage:** ${h.patch}\n`;
}

/**
 * The sticky PR comment body: headline (repo delta and patch coverage), the
 * per-kind table collapsed, and an informational footer.
 */
export function formatComment(rows: Row[], headline?: Headline): string {
  return [
    "## Coverage\n",
    ...(headline ? [formatHeadline(headline)] : []),
    "<details><summary>Per-kind coverage</summary>\n",
    formatMarkdown(rows, false),
    "</details>\n",
    "_Informational only; updated on every push._\n",
  ].join("\n");
}
