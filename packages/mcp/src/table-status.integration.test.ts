import type { BridgeClient } from "@ttrpg-agents/bridge/client";
import { loadSrdMonsters } from "@ttrpg-agents/srd";
import {
  SqliteEncounterRepository,
  openDatabase,
} from "@ttrpg-agents/store-sqlite";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "./context.js";
import { tools } from "./tools.js";

type Response = Awaited<ReturnType<BridgeClient["command"]>>;

function makeCtx(response: Response, dbCount: number): ToolContext {
  const repo = new SqliteEncounterRepository(openDatabase(":memory:"));
  repo.addInstances(() =>
    Array.from({ length: dbCount }, (_, i) => ({
      monsterKey: "srd-2024_shadow",
      displayName: `Shadow ${String(i)}`,
      maxHp: 10,
      initiative: null,
    })),
  );
  return {
    bridge: { command: () => Promise.resolve(response) },
    repo,
    monsters: loadSrdMonsters(),
    rng: { nextInt: () => 0 },
    now: () => new Date("2026-01-01T00:00:00Z"),
    newGroupId: () => "g",
  };
}

const ready = (tokenCount: number, applied: number): Response => ({
  ok: true,
  result: {
    name: "scene-status",
    result: {
      sceneReady: true,
      tokenCount,
      appliedInstanceCount: applied,
    },
  },
});

async function tableStatus(ctx: ToolContext) {
  const tool = tools.find((t) => t.name === "table_status");
  if (!tool) throw new Error("no table_status");
  return tool.handler(ctx, {});
}

describe("table_status structured content", () => {
  it("reports the counts and `inSync: true` when all agree", async () => {
    const r = await tableStatus(makeCtx(ready(2, 2), 2));
    expect(r.structuredContent).toEqual({
      sceneReady: true,
      tokenCount: 2,
      appliedInstanceCount: 2,
      encounterCount: 2,
      inSync: true,
    });
  });

  it("reports `inSync: false` with the counts when they differ", async () => {
    const r = await tableStatus(makeCtx(ready(1, 2), 3));
    expect(r.structuredContent).toEqual({
      sceneReady: true,
      tokenCount: 1,
      appliedInstanceCount: 2,
      encounterCount: 3,
      inSync: false,
    });
    expect(r.content[0]?.text).toContain("out of sync");
  });

  it("an empty scene and encounter are in sync", async () => {
    const r = await tableStatus(makeCtx(ready(0, 0), 0));
    expect(r.structuredContent?.["inSync"]).toBe(true);
  });

  it("an error response is an isError result without structured content", async () => {
    const r = await tableStatus(
      makeCtx(
        { ok: false, error: { code: "timeout", message: "too slow" } },
        0,
      ),
    );
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    expect(r.content[0]?.text).toBe("too slow");
  });
});
