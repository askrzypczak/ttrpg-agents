// `npm run coverage`: unit, integration and e2e coverage plus a merged total.
// Informational only (no thresholds). A failing test run makes it exit 1 after
// the reports are written. Reports land in reports/coverage/<kind>.
// Pure summary/merge logic lives in coverage-lib.ts.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";
import type { CoverageMapData } from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { CoverageReport } from "monocart-coverage-reports";
import {
  exitCode,
  formatComment,
  formatDelta,
  formatMarkdown,
  formatPatch,
  formatTable,
  isCompleteRun,
  makeBaseline,
  mergeCoverage,
  parseBaseline,
  parseDiffAddedLines,
  patchCoverage,
  summarize,
  type PatchResult,
  type Row,
} from "./coverage-lib.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "reports", "coverage");
const owlbearDir = join(root, "packages", "owlbear");
// No port: the bridge port differs per e2e run. fixtures.ts already keeps only
// the extension's entries in the raw files.
const EXTENSION_URL_PREFIX = "http://localhost:";

function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): boolean {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return r.status === 0;
}

function readMap(file: string): CoverageMapData | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as CoverageMapData;
}

function writeReports(map: CoverageMapData, dir: string): void {
  const context = libReport.createContext({
    dir,
    coverageMap: libCoverage.createCoverageMap(map),
  });
  for (const name of ["html", "lcovonly"] as const) {
    reports.create(name).execute(context);
  }
}

/** A kind's map (null if none was written) and whether its test run passed. */
type KindRun = { map: CoverageMapData | null; ok: boolean };

function vitestKind(kind: "unit" | "integration"): KindRun {
  const dir = join(out, kind);
  const ok = run("npx", [
    "vitest",
    "run",
    "--project",
    kind,
    "--coverage",
    "--coverage.reporter=json",
    "--coverage.reporter=html",
    "--coverage.reporter=lcovonly",
    `--coverage.reportsDirectory=${dir}`,
  ]);
  if (!ok) console.error(`coverage: ${kind} tests failed`);
  return { map: readMap(join(dir, "coverage-final.json")), ok };
}

async function e2eKind(): Promise<KindRun> {
  const dir = join(out, "e2e");
  // COVERAGE_E2E_RAW_DIR: raw data already collected (the CI e2e job); do not
  // re-run the e2e suite.
  const given = process.env.COVERAGE_E2E_RAW_DIR;
  const rawDir = given ? resolve(root, given) : join(out, "e2e-raw");
  let ok = true;
  if (!given) {
    ok = run("npm", ["run", "test:e2e"], { E2E_COVERAGE: "1" });
    if (!ok) console.error("coverage: e2e tests failed");
  }
  const files = existsSync(rawDir)
    ? readdirSync(rawDir).filter((f) => f.endsWith(".json"))
    : [];
  if (files.length === 0) {
    console.error("coverage: no e2e coverage data collected");
    return { map: null, ok };
  }
  const mcr = new CoverageReport({
    name: "e2e coverage",
    outputDir: dir,
    reports: ["json", "html", "lcovonly"],
    // Keep only the extension's own sources, mapped back from the bundle.
    sourceFilter: (path: string) =>
      (path.startsWith("src/") || path.startsWith(`${owlbearDir}/src/`)) &&
      !path.endsWith(".test.ts"),
    sourcePath: (path: string) =>
      path.startsWith("src/") ? join(owlbearDir, path) : path,
    entryFilter: (entry: { url: string }) =>
      entry.url.startsWith(EXTENSION_URL_PREFIX),
    cleanCache: true,
    logging: "error",
  });
  for (const f of files) {
    await mcr.add(JSON.parse(readFileSync(join(rawDir, f), "utf8")));
  }
  await mcr.generate();
  return { map: readMap(join(dir, "coverage-final.json")), ok };
}

/** Baseline line pct from COVERAGE_BASELINE; null on any problem. */
function readBaseline(): number | null {
  const file = process.env.COVERAGE_BASELINE;
  if (!file) return null;
  try {
    return parseBaseline(readFileSync(resolve(root, file), "utf8"));
  } catch {
    return null;
  }
}

/** Patch coverage vs COVERAGE_BASE_REF; null when unset or git fails. */
function readPatch(total: CoverageMapData): PatchResult | null {
  const base = process.env.COVERAGE_BASE_REF;
  if (!base) return null;
  const r = spawnSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      `${base}...HEAD`,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0 || typeof r.stdout !== "string") {
    console.error(`coverage: git diff against ${base} failed`);
    return null;
  }
  try {
    return patchCoverage(total, parseDiffAddedLines(r.stdout), root);
  } catch (err) {
    console.error(`coverage: patch coverage failed: ${String(err)}`);
    return null;
  }
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const want = (k: string) => only.length === 0 || only.includes(k);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const runs = {
    unit: want("unit") ? vitestKind("unit") : null,
    integration: want("integration") ? vitestKind("integration") : null,
    e2e: want("e2e") ? await e2eKind() : null,
  };
  const maps: Record<string, CoverageMapData | null> = {
    unit: runs.unit?.map ?? null,
    integration: runs.integration?.map ?? null,
    e2e: runs.e2e?.map ?? null,
  };
  // Kinds that were not wanted never ran, so they cannot fail.
  const failed = Object.entries(runs)
    .filter(([, r]) => r?.ok === false)
    .map(([kind]) => kind);

  const present = Object.values(maps).filter(
    (m): m is CoverageMapData => m !== null,
  );
  const total = present.length > 0 ? mergeCoverage(...present) : null;
  if (total) writeReports(total, join(out, "total"));

  const rows: Row[] = [
    ...Object.entries(maps).map(([kind, map]) => ({
      kind,
      summary: map ? summarize(map) : null,
    })),
    { kind: "combined", summary: total ? summarize(total) : null },
  ];
  console.log(`\n${formatTable(rows)}\n`);
  console.log(`HTML and lcov reports: ${out}/{unit,integration,e2e,total}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatMarkdown(rows));
  }
  // Body for the CI sticky PR comment (posted by the comment job in ci.yml).
  const combined = total ? summarize(total) : null;
  if (total && combined) {
    // The summary is the baseline artifact uploaded from main (see ci.yml).
    // Only a complete run may be the baseline: a partial total would skew it.
    if (isCompleteRun(maps)) {
      writeFileSync(join(out, "coverage-summary.json"), makeBaseline(combined));
    } else {
      const missing = Object.keys(maps).filter((k) => maps[k] === null);
      console.error(
        `coverage: not writing coverage-summary.json, missing: ${missing.join(", ")}`,
      );
    }
    writeFileSync(
      join(out, "total", "coverage-final.json"),
      JSON.stringify(total),
    );
  }
  const headline =
    total && combined
      ? {
          delta: formatDelta(combined.lines.pct, readBaseline()),
          patch: formatPatch(readPatch(total)),
        }
      : undefined;
  writeFileSync(join(out, "summary.md"), formatComment(rows, headline));
  // Last, so the reports and summary.md are written even when a run failed.
  if (failed.length > 0) {
    console.error(`coverage: test runs failed: ${failed.join(", ")}`);
  }
  process.exitCode = exitCode(failed);
}

await main();
