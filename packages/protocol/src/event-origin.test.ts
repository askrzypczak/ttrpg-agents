import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage } from "./protocol.js";

describe("encounter-event origin", () => {
  it("an encounter-event without origin fails decodeMessage", () => {
    const withOrigin = {
      v: 1,
      type: "encounter-event",
      payload: {
        type: "removed",
        id: "i1",
        origin: { source: "mcp", commandId: "c1" },
        seq: 1,
      },
    };
    // Control: the same event with an origin decodes.
    expect(decodeMessage(JSON.stringify(withOrigin)).ok).toBe(true);

    const { origin: _dropped, ...payload } = withOrigin.payload;
    void _dropped;
    const result = decodeMessage(JSON.stringify({ ...withOrigin, payload }));

    expect(result).toMatchObject({ ok: false, reason: "invalid-payload" });
  });

  it("an encounter-event with origin round-trips through decodeMessage", () => {
    const message = {
      v: 1 as const,
      type: "encounter-event" as const,
      payload: {
        type: "instance-changed" as const,
        id: "i1",
        changes: { name: "Boss", statsVisible: true },
        origin: { source: "table" as const, commandId: "c7" },
        seq: 3,
      },
    };

    const decoded = decodeMessage(encodeMessage(message));

    expect(decoded).toEqual({ ok: true, message });
  });
});
