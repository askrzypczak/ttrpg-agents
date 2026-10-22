import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBridgeClient, readAgentToken } from "./client.js";

let dir: string;
let tokenPath: string;
let fake: Server | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bridge-client-extra-"));
  tokenPath = join(dir, "agent-token");
  await writeFile(tokenPath, "tok\n", { mode: 0o600 });
});

afterEach(async () => {
  fake?.closeAllConnections();
  await new Promise((resolve) => (fake ? fake.close(resolve) : resolve(0)));
  fake = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** A stand-in "bridge" that answers every request with `status` and `body`. */
async function fakeBridge(
  status: number,
  body: string,
  seen: { auth?: string; body?: string } = {},
): Promise<number> {
  fake = createServer((req, res) => {
    seen.auth = req.headers.authorization;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.body = Buffer.concat(chunks).toString("utf8");
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => fake?.listen(0, "127.0.0.1", resolve));
  return (fake.address() as AddressInfo).port;
}

describe("readAgentToken", () => {
  it("trims surrounding whitespace and newlines", async () => {
    await writeFile(tokenPath, "  tok\n\n");
    expect(await readAgentToken(tokenPath)).toBe("tok");
  });
});

describe("bridge client request", () => {
  it("sends the trimmed token as a bearer and the query as JSON", async () => {
    const seen: { auth?: string; body?: string } = {};
    const port = await fakeBridge(
      200,
      JSON.stringify({
        ok: true,
        result: {
          name: "scene-status",
          result: { sceneReady: true, tokenCount: 1, appliedInstanceCount: 1 },
        },
      }),
      seen,
    );
    const client = createBridgeClient({ port, tokenPath });
    const response = await client.query({ name: "scene-status" });
    expect(response.ok).toBe(true);
    expect(seen.auth).toBe("Bearer tok");
    expect(JSON.parse(seen.body ?? "")).toEqual({ name: "scene-status" });
  });

  it("relays an error response from the bridge unchanged", async () => {
    const port = await fakeBridge(
      503,
      JSON.stringify({
        ok: false,
        error: { code: "not-connected", message: "no tab" },
      }),
    );
    const client = createBridgeClient({ port, tokenPath });
    expect(await client.query({ name: "scene-status" })).toEqual({
      ok: false,
      error: { code: "not-connected", message: "no tab" },
    });
  });

  it.each([
    ["JSON of the wrong shape", '{"hello":1}'],
    ["a non-JSON body", "<html>nope</html>"],
    ["an empty body", ""],
  ])(
    "%s -> `bridge-unreachable` naming the status, not a crash",
    async (_label, body) => {
      const port = await fakeBridge(200, body);
      const client = createBridgeClient({ port, tokenPath });
      const response = await client.query({ name: "scene-status" });
      if (response.ok) throw new Error("expected an error response");
      expect(response.error.code).toBe("bridge-unreachable");
      expect(response.error.message).toContain(String(port));
      expect(response.error.message).toContain("200");
    },
  );
});
