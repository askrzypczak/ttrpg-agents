import { describe, expect, it } from "vitest";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { bridgeMessageSchema } from "@ttrpg-agents/protocol";
import { createMessageFeed } from "./messages.js";

describe("createMessageFeed", () => {
  it("a new feed's snapshot and event decode with bridgeMessageSchema at seq 0 and 1", () => {
    const feed = createMessageFeed();
    const instances = [makeTestInstance({ id: "i1" })];

    const snapshot = feed.snapshot(instances);
    const event = feed.event({ type: "removed", id: "i1" });

    expect(snapshot).toEqual({
      v: 1,
      type: "encounter-snapshot",
      payload: { instances, seq: 0 },
    });
    expect("art" in snapshot.payload).toBe(false);
    expect(event).toEqual({
      v: 1,
      type: "encounter-event",
      payload: {
        type: "removed",
        id: "i1",
        origin: { source: "mcp", commandId: "test" },
        seq: 1,
      },
    });
    expect(bridgeMessageSchema.parse(snapshot)).toEqual(snapshot);
    expect(bridgeMessageSchema.parse(event)).toEqual(event);
  });

  it("each event takes the next seq; an explicit seq becomes the position; a later snapshot carries the last event's seq", () => {
    const feed = createMessageFeed();
    const seqOf = (message: { payload: { seq: number } }) =>
      message.payload.seq;
    const cleared = { type: "cleared" } as const;

    expect(seqOf(feed.event(cleared))).toBe(1);
    expect(seqOf(feed.event(cleared))).toBe(2);
    expect(seqOf(feed.snapshot([]))).toBe(2);

    expect(seqOf(feed.event(cleared, { seq: 5 }))).toBe(5);
    expect(seqOf(feed.event(cleared))).toBe(6);

    expect(seqOf(feed.snapshot([], { seq: 10 }))).toBe(10);
    expect(seqOf(feed.event(cleared))).toBe(11);
    expect(seqOf(feed.snapshot([]))).toBe(11);

    const origin = { source: "table", commandId: "c9" } as const;
    expect(feed.event({ type: "cleared", origin }).payload.origin).toEqual(
      origin,
    );

    const art = {
      url: "https://example.com/owl.png",
      mime: "image/png",
      width: 64,
      height: 64,
    };
    const instances = [makeTestInstance({ id: "i2" })];
    const snapshot = feed.snapshot(instances, { art: { owlbear: art } });
    expect(snapshot.payload.art).toEqual({ owlbear: art });
    expect(snapshot.payload.instances).toEqual(instances);
  });
});
