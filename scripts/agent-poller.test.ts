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
    `#!/usr/bin/env bash
if [ "$1" = "--bg" ]; then echo "$*" >>"${dir}/claude.log"; else cat "${dir}/sessions.json"; fi
`,
  );
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash
echo "$*" >>"${dir}/gh.log"
if [ "$1 $2" = "issue view" ]; then if [ -f "${dir}/fail-issue-$3" ]; then exit 1; fi; cat "${dir}/issue.json"
elif [ "$1 $2" = "issue list" ]; then echo '[]'
elif [ "$1 $2" = "pr list" ]; then if [ -f "${dir}/prs.json" ]; then cat "${dir}/prs.json"; else echo '[]'; fi
elif [ "$1 $2" = "pr view" ]; then cat "${dir}/pr.json"
elif [ "$1" = "api" ]; then if [ -f "${dir}/api-fail" ]; then exit 1; fi; echo "{\\"sha\\":\\"$(cat "${dir}/sha")\\"}"
fi
`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(dir, "gh.log"), "");
  writeFileSync(join(dir, "claude.log"), "");
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

interface ConflictOpts {
  mergeable?: string;
  branch?: string;
  sessions?: { name: string; state: string }[];
  labels?: string[];
  author?: string;
  sha?: string;
  attempts?: Record<string, { pr: string; mainSha: string }>;
  launched?: Record<string, unknown>;
  prViewMergeable?: string;
  prViewState?: string;
  failIssues?: number[];
  failApi?: boolean;
  extraPrs?: { number: number; headRefName: string }[];
  dry?: boolean;
}

function runConflict(opts: ConflictOpts) {
  writeFileSync(
    join(dir, "sessions.json"),
    JSON.stringify((opts.sessions ?? []).map((s) => ({ ...s, startedAt: 1 }))),
  );
  writeFileSync(
    join(dir, "launched.json"),
    JSON.stringify(opts.launched ?? {}),
  );
  writeFileSync(
    join(dir, "conflicts.json"),
    JSON.stringify(opts.attempts ?? {}),
  );
  writeFileSync(join(dir, "sha"), opts.sha ?? "sha1");
  writeFileSync(
    join(dir, "prs.json"),
    JSON.stringify([
      {
        number: 9,
        headRefName: opts.branch ?? "issue-5-thing",
        mergeable: opts.mergeable ?? "CONFLICTING",
        mergeStateStatus: "DIRTY",
      },
      ...(opts.extraPrs ?? []).map((p) => ({
        ...p,
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
      })),
    ]),
  );
  writeFileSync(
    join(dir, "pr.json"),
    JSON.stringify({
      state: opts.prViewState ?? "OPEN",
      mergeable: opts.prViewMergeable ?? "CONFLICTING",
    }),
  );
  for (const n of opts.failIssues ?? [])
    writeFileSync(join(dir, `fail-issue-${n}`), "");
  if (opts.failApi) writeFileSync(join(dir, "api-fail"), "");
  writeFileSync(
    join(dir, "issue.json"),
    JSON.stringify({
      state: "OPEN",
      author: { login: opts.author ?? "askrzypczak" },
      labels: (opts.labels ?? ["agent-ok", "needs-review"]).map((name) => ({
        name,
      })),
    }),
  );
  const res = spawnSync("bash", [SCRIPT, ...(opts.dry ? ["--dry-run"] : [])], {
    encoding: "utf8",
    env: {
      ...process.env,
      EXTRA_PATH: join(dir, "bin"),
      STATE_DIR: dir,
      REPO_DIR: dir,
    },
  });
  expect(res.status).toBe(0);
  const read = (f: string) =>
    readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean);
  const json = (f: string) =>
    JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<
      string,
      { name: string; pr: string; mainSha: string }
    >;
  return {
    stdout: res.stdout,
    launches: read("claude.log"),
    calls: read("gh.log"),
    state: json("launched.json"),
    attempts: json("conflicts.json"),
  };
}

describe("agent-poller conflict phase", () => {
  it("launches resolve-conflicts for a CONFLICTING issue PR and records it", () => {
    const r = runConflict({});
    expect(r.launches).toEqual([
      "--bg --name ttrpg-5-conflict /ticket-workflow:resolve-conflicts 5",
    ]);
    expect(r.state["conflict-5"]).toMatchObject({
      name: "ttrpg-5-conflict",
      pr: "9",
      mainSha: "sha1",
    });
    expect(r.attempts["5"]).toEqual({ pr: "9", mainSha: "sha1" });
  });

  it.each(["UNKNOWN", "MERGEABLE"])("does not launch for %s", (mergeable) => {
    const r = runConflict({ mergeable });
    expect(r.launches).toEqual([]);
    if (mergeable === "UNKNOWN") expect(r.stdout).toContain("retry next poll");
  });

  it("ignores branches that are not issue-N-*", () => {
    expect(runConflict({ branch: "feature-x" }).launches).toEqual([]);
  });

  it.each(["working", "blocked"])(
    "skips when the ticket session is %s",
    (state) => {
      const r = runConflict({ sessions: [{ name: "ttrpg-5", state }] });
      expect(r.launches).toEqual([]);
    },
  );

  it.each(["idle", "done"])(
    "still launches when the ticket session is %s",
    (state) => {
      const r = runConflict({ sessions: [{ name: "ttrpg-5", state }] });
      expect(r.launches).toHaveLength(1);
    },
  );

  it("skips when a live conflict session exists", () => {
    const r = runConflict({
      sessions: [{ name: "ttrpg-5-conflict", state: "working" }],
    });
    expect(r.launches).toEqual([]);
  });

  it("skips when a conflict entry is already tracked", () => {
    const r = runConflict({
      launched: {
        "conflict-5": {
          name: "ttrpg-5-conflict",
          at: Math.floor(Date.now() / 1000),
          pr: "9",
          mainSha: "sha1",
        },
      },
    });
    expect(r.launches).toEqual([]);
  });

  it("does not repeat an attempt against the same main SHA", () => {
    const r = runConflict({ attempts: { "5": { pr: "9", mainSha: "sha1" } } });
    expect(r.launches).toEqual([]);
  });

  it("retries when main has moved", () => {
    const r = runConflict({
      attempts: { "5": { pr: "9", mainSha: "old" } },
      sha: "sha2",
    });
    expect(r.launches).toHaveLength(1);
    expect(r.attempts["5"]).toEqual({ pr: "9", mainSha: "sha2" });
  });

  it("skips a PR whose issue cannot be read and still launches later ones", () => {
    const r = runConflict({
      branch: "issue-7-gone",
      failIssues: [7],
      extraPrs: [{ number: 10, headRefName: "issue-5-thing" }],
    });
    expect(r.stdout).toContain("#7: cannot read issue");
    expect(r.launches).toEqual([
      "--bg --name ttrpg-5-conflict /ticket-workflow:resolve-conflicts 5",
    ]);
  });

  it("skips the phase without failing when main SHA cannot be read", () => {
    const r = runConflict({ failApi: true });
    expect(r.stdout).toContain("cannot read main SHA");
    expect(r.launches).toEqual([]);
  });

  it("skips tickets that are not agent-ok", () => {
    expect(runConflict({ labels: ["needs-review"] }).launches).toEqual([]);
  });

  it("skips tickets with agent-failed", () => {
    expect(
      runConflict({ labels: ["agent-ok", "agent-failed"] }).launches,
    ).toEqual([]);
  });

  it("skips tickets by another author", () => {
    expect(runConflict({ author: "someone" }).launches).toEqual([]);
  });

  it("dry-run logs the launch without launching or writing state", () => {
    const r = runConflict({ dry: true });
    expect(r.stdout).toContain("[dry-run]");
    expect(r.stdout).toContain("resolve-conflicts 5");
    expect(r.launches).toEqual([]);
    expect(r.state).toEqual({});
    expect(r.attempts).toEqual({});
  });
});

describe("agent-poller conflict reconcile", () => {
  const entry = {
    "conflict-5": {
      name: "ttrpg-5-conflict",
      at: Math.floor(Date.now() / 1000) - 3600,
      pr: "9",
      mainSha: "sha1",
    },
  };
  // PR is still CONFLICTING in these, but the attempt cap blocks a relaunch.
  const attempts = { "5": { pr: "9", mainSha: "sha1" } };

  it.each(["failed", "stopped"])(
    "fails a %s conflict session on the PR and issue",
    (state) => {
      const r = runConflict({
        launched: entry,
        attempts,
        sessions: [{ name: "ttrpg-5-conflict", state }],
      });
      expect(r.calls).toContain(
        "issue edit 5 --repo askrzypczak/ttrpg-agents --add-label agent-failed",
      );
      expect(r.calls.some((c) => c.startsWith("pr comment 9"))).toBe(true);
      expect(r.calls.some((c) => c.startsWith("issue comment 5"))).toBe(true);
      expect(r.state).toEqual({});
    },
  );

  it("fails a done session whose PR still conflicts", () => {
    const r = runConflict({
      launched: entry,
      attempts,
      sessions: [{ name: "ttrpg-5-conflict", state: "done" }],
    });
    expect(r.calls.some((c) => c.includes("agent-failed"))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("pr comment 9"))).toBe(true);
    expect(r.state).toEqual({});
  });

  it("cleans up a done session whose conflict is resolved", () => {
    const r = runConflict({
      launched: entry,
      attempts,
      sessions: [{ name: "ttrpg-5-conflict", state: "done" }],
      prViewMergeable: "MERGEABLE",
      mergeable: "MERGEABLE",
    });
    expect(r.calls.some((c) => c.includes("agent-failed"))).toBe(false);
    expect(r.state).toEqual({});
  });

  it.each(["CLOSED", "MERGED"])(
    "does not fail a done session whose PR is %s",
    (prViewState) => {
      const r = runConflict({
        launched: entry,
        attempts,
        sessions: [{ name: "ttrpg-5-conflict", state: "done" }],
        prViewState,
        mergeable: "MERGEABLE",
      });
      expect(r.calls.some((c) => c.includes("agent-failed"))).toBe(false);
      expect(r.state).toEqual({});
    },
  );

  it("keeps a working conflict session", () => {
    const r = runConflict({
      launched: entry,
      attempts,
      sessions: [{ name: "ttrpg-5-conflict", state: "working" }],
    });
    expect(r.calls.some((c) => c.includes("agent-failed"))).toBe(false);
    expect(r.state["conflict-5"]).toBeDefined();
  });
});
