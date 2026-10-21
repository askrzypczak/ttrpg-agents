// `npm run mutate:changed [base-ref]`: run Stryker on the production files
// changed since the merge-base with <base-ref> (default origin/main).
// Informational only: always exits 0. Writes reports/mutation/comment.md, the
// body for the CI sticky PR comment (posted by the comment job in ci.yml).
// Pure selection/formatting logic lives in mutate-lib.ts.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatMutationComment, selectMutateFiles } from "./mutate-lib.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "reports", "mutation");
const commentFile = join(outDir, "comment.md");
const HEADING = "## Mutation testing (changed files)\n\n";

function writeComment(body: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(commentFile, body);
}

function failed(why: string): void {
  console.error(`mutate:changed: ${why}`);
  writeComment(`${HEADING}The mutation run failed: ${why}\n`);
}

async function main(): Promise<void> {
  const base = process.argv[2] ?? "origin/main";
  const diff = spawnSync(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "--diff-filter=ACMRD",
      `${base}...HEAD`,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (diff.status !== 0) {
    failed(`git diff against ${base} failed: ${diff.stderr}`.trim());
    return;
  }
  const config = JSON.parse(
    readFileSync(join(root, "stryker.config.json"), "utf8"),
  ) as { mutate: string[] };
  const files = selectMutateFiles(diff.stdout, config.mutate);
  if (files.length === 0) {
    console.log(
      "mutate:changed: nothing to mutate (no production files changed)",
    );
    writeComment(
      `${HEADING}No production source files changed; nothing was mutated.\n`,
    );
    return;
  }
  console.log(`mutate:changed: mutating ${files.length} file(s):`);
  for (const f of files) console.log(`  ${f}`);
  mkdirSync(outDir, { recursive: true });

  const child = spawn(
    "npx",
    [
      "stryker",
      "run",
      "--mutate",
      files.join(","),
      "--incrementalFile",
      "reports/mutation/changed-incremental.json",
    ],
    { cwd: root, stdio: ["inherit", "pipe", "inherit"] },
  );
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    process.stdout.write(chunk);
  });
  const result = await new Promise<{ code: number | null; error?: Error }>(
    (done) => {
      child.on("error", (error) => done({ code: null, error }));
      child.on("close", (code) => done({ code }));
    },
  );
  if (result.error) {
    failed(`could not start stryker: ${result.error.message}`);
  } else if (stdout.trim() === "") {
    failed(`stryker produced no output (exit code ${result.code})`);
  } else if (result.code !== 0) {
    // Stryker logs to stdout, so keep its output but flag the failure.
    const line = `The mutation run failed (exit code ${result.code}).`;
    console.error(`mutate:changed: ${line}`);
    const body = formatMutationComment(stdout);
    writeComment(
      body.startsWith(HEADING)
        ? `${HEADING}${line}\n\n${body.slice(HEADING.length)}`
        : `${HEADING}${line}\n\n${body}`,
    );
  } else {
    writeComment(formatMutationComment(stdout));
  }
}

await main();
