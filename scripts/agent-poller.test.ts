import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "agent-poller.sh");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "poller-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "claude"),
    `#!/usr/bin/env bash\ncat "${dir}/sessions.json"\n`,
  );
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash
echo "$*" >>"${dir}/gh.log"
if [ "$1 $2" = "issue view" ]; then cat "${dir}/issue.json"
elif [ "$1 $2" = "issue list" ]; then echo '[]'
fi
`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(dir, "gh.log"), "");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Opts {
  state?: string; // session state; omit for no session
  ageSec?: number;
  labels?: string[];
  issueState?: string;
}

function run(opts: Opts) {
  const sessions = opts.state
    ? [{ name: "ttrpg-5", state: opts.state, startedAt: 1 }]
    : [];
  writeFileSync(join(dir, "sessions.json"), JSON.stringify(sessions));
  const at = Math.floor(Date.now() / 1000) - (opts.ageSec ?? 3600);
  writeFileSync(
    join(dir, "launched.json"),
    JSON.stringify({ "5": { name: "ttrpg-5", at } }),
  );
  writeFileSync(
    join(dir, "issue.json"),
    JSON.stringify({
      state: opts.issueState ?? "OPEN",
      labels: (opts.labels ?? ["in-progress"]).map((name) => ({ name })),
    }),
  );
  const res = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      EXTRA_PATH: join(dir, "bin"),
      STATE_DIR: dir,
      REPO_DIR: dir,
    },
  });
  expect(res.status).toBe(0);
  const calls = readFileSync(join(dir, "gh.log"), "utf8")
    .split("\n")
    .filter(Boolean);
  const launched = JSON.parse(
    readFileSync(join(dir, "launched.json"), "utf8"),
  ) as Record<string, unknown>;
  return {
    stdout: res.stdout,
    failed: calls.some((c) => c.includes("agent-failed")),
    commented: calls.some((c) => c.startsWith("issue comment 5")),
    kept: "5" in launched,
  };
}

describe("agent-poller reconcile", () => {
  it.each(["waiting", "idle", "something-new", "working", "blocked"])(
    "keeps a session in state %s without failing it",
    (state) => {
      const r = run({ state });
      expect(r.failed).toBe(false);
      expect(r.commented).toBe(false);
      expect(r.kept).toBe(true);
    },
  );

  it("removes the entry without failure when done and needs-review", () => {
    const r = run({ state: "done", labels: ["needs-review"] });
    expect(r.failed).toBe(false);
    expect(r.kept).toBe(false);
  });

  it("removes the entry without failure when done and issue closed", () => {
    const r = run({ state: "done", issueState: "CLOSED", labels: [] });
    expect(r.failed).toBe(false);
    expect(r.kept).toBe(false);
  });

  it("fails a done session whose ticket was not handed off", () => {
    const r = run({ state: "done" });
    expect(r.failed).toBe(true);
    expect(r.commented).toBe(true);
    expect(r.kept).toBe(false);
  });

  it.each(["failed", "stopped"])("fails a %s session", (state) => {
    const r = run({ state });
    expect(r.failed).toBe(true);
    expect(r.commented).toBe(true);
    expect(r.kept).toBe(false);
  });

  it("fails a missing session older than 10 minutes", () => {
    const r = run({ ageSec: 700 });
    expect(r.failed).toBe(true);
    expect(r.kept).toBe(false);
  });

  it("keeps a missing session younger than 10 minutes", () => {
    const r = run({ ageSec: 60 });
    expect(r.failed).toBe(false);
    expect(r.kept).toBe(true);
  });

  it("logs the observed state", () => {
    expect(run({ state: "waiting" }).stdout).toContain(
      "#5: ttrpg-5 state=waiting",
    );
    expect(run({ ageSec: 60 }).stdout).toContain("state=<none>");
  });
});
