import { describe, expect, it } from "vitest";
import {
  agentCommandResponseSchema,
  commandResultSchema,
  commandSchema,
  sceneStatusSchema,
} from "./protocol.js";

const status = { sceneReady: true, tokenCount: 2, appliedInstanceCount: 2 };

describe("command schemas", () => {
  it("accepts only the known command", () => {
    expect(commandSchema.safeParse({ name: "scene-status" }).success).toBe(
      true,
    );
    for (const bad of [{ name: "nope" }, {}, [], null, "scene-status"]) {
      expect(commandSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("scene status requires three well-formed fields", () => {
    expect(sceneStatusSchema.safeParse(status).success).toBe(true);
    expect(
      sceneStatusSchema.safeParse({ ...status, tokenCount: 0 }).success,
    ).toBe(true);
    for (const bad of [
      { ...status, tokenCount: -1 },
      { ...status, appliedInstanceCount: -1 },
      { ...status, tokenCount: 1.5 },
      { ...status, sceneReady: "yes" },
      { sceneReady: true, tokenCount: 1 },
      { sceneReady: true, appliedInstanceCount: 1 },
      { tokenCount: 1, appliedInstanceCount: 1 },
      {},
    ]) {
      expect(
        sceneStatusSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("a command result carries its name and a valid result", () => {
    expect(
      commandResultSchema.safeParse({ name: "scene-status", result: status })
        .success,
    ).toBe(true);
    for (const bad of [
      { name: "scene-status" },
      { name: "scene-status", result: { ...status, tokenCount: -1 } },
      { name: "nope", result: status },
      { result: status },
    ]) {
      expect(
        commandResultSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("an ok response needs a result and an error response needs code and message", () => {
    const result = { name: "scene-status", result: status };
    expect(
      agentCommandResponseSchema.safeParse({ ok: true, result }).success,
    ).toBe(true);
    for (const bad of [
      { ok: true },
      { ok: true, result: { name: "scene-status" } },
      { ok: false },
      { ok: false, error: { code: "timeout" } },
      { ok: false, error: { message: "m" } },
      { ok: false, error: { code: "nope", message: "m" } },
      { error: { code: "timeout", message: "m" } },
    ]) {
      expect(
        agentCommandResponseSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});
