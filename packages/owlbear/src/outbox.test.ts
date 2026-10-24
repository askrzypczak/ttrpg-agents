import { describe, expect, it } from "vitest";
import type { BridgeMessage } from "@ttrpg-agents/protocol";
import { createOutbox } from "./outbox.js";

const command = (id: string): BridgeMessage => ({
  v: 1,
  type: "token-deleted",
  id,
  payload: { instanceId: "i1" },
});

/** A `send` that goes through only while `open`, recording what went out. */
function fakeSend() {
  const state = { open: false, accepted: [] as string[] };
  const send = (message: BridgeMessage): boolean => {
    if (!state.open) return false;
    state.accepted.push(message.id ?? "");
    return true;
  };
  return { state, send };
}

describe("createOutbox", () => {
  it("a command whose send fails is sent after the next hello-ack", () => {
    const { state, send } = fakeSend();
    const outbox = createOutbox(send);

    outbox.submit(command("a"));
    expect(state.accepted).toEqual([]);
    expect(outbox.waiting()).toBe(1);

    state.open = true;
    outbox.helloAck();

    expect(state.accepted).toEqual(["a"]);
    expect(outbox.waiting()).toBe(0);
    // Sent, not settled: the command is still pending until the store answers.
    expect(outbox.pending().map((c) => c.id)).toEqual(["a"]);
  });

  it("queued commands are sent in submit order, stopping at the first that does not go out", () => {
    const accepted: string[] = [];
    let refuse: string | undefined;
    const outbox = createOutbox((message) => {
      if (message.id === refuse || refuse === "*") return false;
      accepted.push(message.id ?? "");
      return true;
    });
    refuse = "*";
    outbox.submit(command("a"));
    outbox.submit(command("b"));
    outbox.submit(command("c"));
    expect(accepted).toEqual([]);

    // The socket takes "a" and then drops "b": "c" must not jump ahead.
    refuse = "b";
    outbox.helloAck();
    expect(accepted).toEqual(["a"]);
    expect(outbox.waiting()).toBe(2);

    refuse = undefined;
    outbox.helloAck();
    expect(accepted).toEqual(["a", "b", "c"]);
    expect(outbox.waiting()).toBe(0);
  });

  it("the waiting count follows the queue and reaches zero after the flush", () => {
    const { state, send } = fakeSend();
    const changes: number[] = [];
    const outbox = createOutbox(send, (waiting) => changes.push(waiting));

    outbox.submit(command("a"));
    outbox.submit(command("b"));
    expect(outbox.waiting()).toBe(2);
    expect(changes).toEqual([1, 2]);

    state.open = true;
    outbox.helloAck();

    expect(outbox.waiting()).toBe(0);
    expect(changes.at(-1)).toBe(0);
  });

  it("a command sent before a reconnect is forgotten at the next snapshot, one sent after the hello-ack is kept", () => {
    const { state, send } = fakeSend();
    state.open = true;
    const outbox = createOutbox(send);
    outbox.submit(command("before"));
    expect(state.accepted).toEqual(["before"]);

    // The connection dropped and came back: "before" may never have arrived.
    outbox.helloAck();
    outbox.submit(command("after"));
    expect(state.accepted).toEqual(["before", "after"]);
    outbox.snapshot();

    expect(outbox.pending().map((c) => c.id)).toEqual(["after"]);
    expect(outbox.settle("after")?.message).toEqual(command("after"));
    expect(outbox.pending()).toEqual([]);
  });
});
