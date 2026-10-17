// `npm run coverage`: unit, integration and e2e coverage plus a merged total.
// Informational only (no thresholds). Reports land in reports/coverage/<kind>.
// Pure summary/merge logic lives in coverage-lib.ts.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";
import type { CoverageMapData } from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { CoverageReport } from "monocart-coverage-reports";
import {
  formatMarkdown,
  formatTable,
  mergeCoverage,
  summarize,
  type Row,
} from "./coverage-lib.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "reports", "coverage");
const owlbearDir = join(root, "packages", "owlbear");
const EXTENSION_ORIGIN = "http://localhost:5199/";

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

function vitestKind(kind: "unit" | "integration"): CoverageMapData | null {
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
  return readMap(join(dir, "coverage-final.json"));
}

async function e2eKind(): Promise<CoverageMapData | null> {
  const dir = join(out, "e2e");
  const rawDir = join(out, "e2e-raw");
  const ok = run("npm", ["run", "test:e2e"], { E2E_COVERAGE: "1" });
  if (!ok) console.error("coverage: e2e tests failed");
  const files = existsSync(rawDir)
    ? readdirSync(rawDir).filter((f) => f.endsWith(".json"))
    : [];
  if (files.length === 0) {
    console.error("coverage: no e2e coverage data collected");
    return null;
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
      entry.url.startsWith(EXTENSION_ORIGIN),
    cleanCache: true,
    logging: "error",
  });
  for (const f of files) {
    await mcr.add(JSON.parse(readFileSync(join(rawDir, f), "utf8")));
  }
  await mcr.generate();
  return readMap(join(dir, "coverage-final.json"));
}

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const want = (k: string) => only.length === 0 || only.includes(k);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const maps: Record<string, CoverageMapData | null> = {
    unit: want("unit") ? vitestKind("unit") : null,
    integration: want("integration") ? vitestKind("integration") : null,
    e2e: want("e2e") ? await e2eKind() : null,
  };

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
}

await main();
