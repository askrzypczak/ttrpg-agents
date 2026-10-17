import { describe, expect, it } from "vitest";
import { STALLED_HINT, panelView } from "./panel-state.js";

describe("panelView", () => {
  it("shows a gm-only notice to players regardless of socket state", () => {
    const v = panelView({
      role: "player",
      socketState: "open",
      disconnectedMs: 0,
    });
    expect(v.kind).toBe("gm-only");
    expect(v.hint).toBeUndefined();
  });

  it("asks the GM to reinstall when the token is missing", () => {
    const v = panelView({
      role: "gm",
      socketState: "connecting",
      disconnectedMs: 0,
      tokenMissing: true,
    });
    expect(v.kind).toBe("token-missing");
    expect(v.message).toContain("reinstall");
  });

  it("shows connected for the GM when open", () => {
    const v = panelView({ role: "gm", socketState: "open", disconnectedMs: 0 });
    expect(v.kind).toBe("connected");
  });

  it("shows closed", () => {
    const v = panelView({
      role: "gm",
      socketState: "closed",
      disconnectedMs: 99999,
    });
    expect(v.kind).toBe("closed");
    expect(v.hint).toBeUndefined();
  });

  it("shows connecting and reconnecting without a hint before the threshold", () => {
    for (const socketState of ["connecting", "reconnecting"] as const) {
      const v = panelView({ role: "gm", socketState, disconnectedMs: 7999 });
      expect(v.kind).toBe(socketState);
      expect(v.hint).toBeUndefined();
    }
  });

  it("adds the local-network hint at the threshold", () => {
    for (const socketState of ["connecting", "reconnecting"] as const) {
      const v = panelView({ role: "gm", socketState, disconnectedMs: 8000 });
      expect(v.kind).toBe(socketState);
      expect(v.hint).toBe(STALLED_HINT);
    }
    expect(STALLED_HINT).toMatch(/local network/i);
  });

  it("honours a custom threshold", () => {
    const v = panelView({
      role: "gm",
      socketState: "connecting",
      disconnectedMs: 1000,
      stalledAfterMs: 1000,
    });
    expect(v.hint).toBeDefined();
  });
});
