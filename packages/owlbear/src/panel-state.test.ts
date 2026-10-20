import { describe, expect, it } from "vitest";
import {
  STALLED_HINT,
  describeError,
  panelView,
  type PanelInput,
} from "./panel-state.js";

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

  it("a bad-token rejection shows the reinstall message with no stalled hint", () => {
    const v = panelView({
      role: "gm",
      socketState: "rejected",
      rejection: "bad-token",
      disconnectedMs: 99999,
    });
    expect(v.kind).toBe("rejected-token");
    expect(v.message).toContain("reinstall");
    expect(v.hint).toBeUndefined();
  });

  it("a version rejection shows the rebuild message with no stalled hint", () => {
    const v = panelView({
      role: "gm",
      socketState: "rejected",
      rejection: "unsupported-version",
      disconnectedMs: 99999,
    });
    expect(v.kind).toBe("rejected-version");
    expect(v.message).toContain("rebuild");
    expect(v.hint).toBeUndefined();
  });
});

describe("panelView sync error", () => {
  it("shows the sync failure on connection views", () => {
    const v = panelView({
      role: "gm",
      socketState: "open",
      disconnectedMs: 0,
      syncError: "boom",
    });
    expect(v.kind).toBe("connected");
    expect(v.error).toBe("Encounter sync failed: boom");
  });

  it("has no error without a sync failure", () => {
    const v = panelView({ role: "gm", socketState: "open", disconnectedMs: 0 });
    expect(v.error).toBeUndefined();
  });

  it("leaves gm-only and token-missing views unaffected", () => {
    const base: PanelInput = {
      role: "player",
      socketState: "open",
      disconnectedMs: 0,
      syncError: "x",
    };
    const player = panelView(base);
    expect(player.kind).toBe("gm-only");
    expect(player.error).toBeUndefined();
    const noToken = panelView({ ...base, role: "gm", tokenMissing: true });
    expect(noToken.kind).toBe("token-missing");
    expect(noToken.error).toBeUndefined();
  });
});

describe("describeError", () => {
  it("handles Errors, SDK-style objects, strings and anything else", () => {
    expect(describeError(new Error("bad"))).toBe("bad");
    expect(
      describeError({ name: "MissingDataError", message: "No scene found" }),
    ).toBe("MissingDataError: No scene found");
    expect(describeError({ message: "only message" })).toBe("only message");
    expect(describeError("plain")).toBe("plain");
    expect(describeError(42)).toBe("42");
    expect(describeError({ foo: 1 })).toBe("[object Object]");
    expect(describeError(null)).toBe("null");
  });
});
