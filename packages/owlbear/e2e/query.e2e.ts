import { test, expect, openHarness } from "./fixtures.js";
import { readItems } from "./helpers.js";

test.describe("agent query -> bridge -> extension", () => {
  test("POST `scene-status` to the worker bridge with the agent token returns the real extension's counts", async ({
    page,
    bridge,
  }) => {
    await openHarness(page, { role: "gm" });
    // The seeded encounter has five instances, so five tokens once synced.
    await expect.poll(async () => (await readItems(page)).length).toBe(5);

    const post = async () => {
      const res = await fetch(`${bridge.origin}/agent/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bridge.agentToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "scene-status" }),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep the raw text so a failure shows what came back
      }
      return { status: res.status, body };
    };

    await expect.poll(post).toEqual({
      status: 200,
      body: {
        ok: true,
        result: {
          name: "scene-status",
          result: {
            sceneReady: true,
            tokenCount: 5,
            appliedInstanceCount: 5,
            artWaits: [],
          },
        },
      },
    });
  });
});
