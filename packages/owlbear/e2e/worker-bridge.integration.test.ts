import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { startWorkerBridge, type WorkerBridge } from "./worker-bridge.ts";

// Real child processes (the built bridge CLI) and sockets; a temp static dir
// with a manifest.json stands in for packages/owlbear/dist.
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const MANIFEST = { name: "worker-bridge test", version: "0.0.0" };

let root: string;
let staticDir: string;
const started: WorkerBridge[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "e2e-worker-bridge-"));
  staticDir = join(root, "static");
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, "manifest.json"), JSON.stringify(MANIFEST));
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((bridge) => bridge.stop()));
  rmSync(root, { recursive: true, force: true });
});

it("two worker bridges started at once have distinct origins and each serves its manifest (AC1)", async () => {
  const results = await Promise.allSettled(
    ["worker-0", "worker-1"].map((name) => {
      const dir = join(root, name);
      mkdirSync(dir);
      return startWorkerBridge({ repo, staticDir, dir });
    }),
  );
  for (const result of results)
    if (result.status === "fulfilled") started.push(result.value);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;

  const [first, second] = started;
  expect(first!.origin).toMatch(/^http:\/\/localhost:\d+$/);
  expect(second!.origin).toMatch(/^http:\/\/localhost:\d+$/);
  expect(first!.origin).not.toBe(second!.origin);
  for (const bridge of started) {
    const response = await fetch(`${bridge.origin}/manifest.json`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MANIFEST);
  }
}, 20_000);
