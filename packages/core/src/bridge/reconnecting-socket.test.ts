import { describe, expect, it } from "vitest";
import {
  decodeMessage,
  encodeMessage,
  type BridgeMessage,
} from "./protocol.js";
import {
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  ReconnectingSocket,
  type SocketLike,
  type SocketState,
  type Timers,
} from "./reconnecting-socket.js";

class FakeSocket implements SocketLike {
  onopen: SocketLike["onopen"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  onmessage: SocketLike["onmessage"] = null;
  sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  serverMessage(raw: string) {
    this.onmessage?.({ data: raw });
  }
  /** Types of the messages this socket has sent, in order. */
  sentTypes(): string[] {
    return this.sent.map((raw) => {
      const r = decodeMessage(raw);
      return r.ok ? r.message.type : "?";
    });
  }
}

class FakeTimers implements Timers {
  pending = new Map<number, { fn: () => void; ms: number }>();
  delays: number[] = [];
  private next = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    this.delays.push(ms);
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  fireAll() {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const t of all) t.fn();
  }
  /** Fires only the pending timers scheduled with this delay. */
  fire(ms: number) {
    const due = [...this.pending].filter(([, t]) => t.ms === ms);
    for (const [id] of due) this.pending.delete(id);
    for (const [, t] of due) t.fn();
  }
  pendingDelays(): number[] {
    return [...this.pending.values()].map((t) => t.ms);
  }
}

const hello: BridgeMessage = {
  v: 1,
  type: "hello",
  payload: { role: "gm", extensionVersion: "0", token: "t" },
};
const ack = encodeMessage({
  v: 1,
  type: "hello-ack",
  payload: { serverVersion: "1" },
});
const pong = encodeMessage({ v: 1, type: "pong", payload: {} });

function errorReply(code: string, fatal: boolean): string {
  return encodeMessage({
    v: 1,
    type: "error",
    payload: { code, message: "bad", fatal },
  });
}

/** Backoff delays only, without the heartbeat's ping interval and pong deadline. */
function retryDelays(timers: FakeTimers): number[] {
  return timers.delays.filter(
    (d) => d !== PING_INTERVAL_MS && d !== PONG_TIMEOUT_MS,
  );
}

/** `throwOn` lists the createSocket calls (0-based) that throw. */
function setup(throwOn: number[] = []) {
  const sockets: FakeSocket[] = [];
  const timers = new FakeTimers();
  const states: SocketState[] = [];
  const messages: BridgeMessage[] = [];
  let calls = 0;
  const rs = new ReconnectingSocket({
    url: "ws://x",
    createSocket: () => {
      if (throwOn.includes(calls++)) throw new Error("socket refused");
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    hello: () => hello,
    timers,
    backoff: { random: () => 0 },
    onStateChange: (s) => states.push(s),
    onMessage: (m) => messages.push(m),
  });
  return { rs, sockets, timers, states, messages };
}

/** Starts and completes the handshake on the first socket. */
function setupOpen() {
  const ctx = setup();
  ctx.rs.start();
  ctx.sockets[0]!.onopen?.();
  ctx.sockets[0]!.serverMessage(ack);
  return ctx;
}

describe("ReconnectingSocket", () => {
  it("connects, sends hello on open, and is open only after hello-ack", () => {
    const { rs, sockets, states } = setup();
    rs.start();
    expect(rs.state).toBe("connecting");
    sockets[0]!.onopen?.();
    expect(sockets[0]!.sent).toEqual([encodeMessage(hello)]);
    expect(rs.state).toBe("connecting");
    sockets[0]!.serverMessage(ack);
    expect(rs.state).toBe("open");
    expect(states).toEqual(["connecting", "open"]);
  });

  it("schedules retries with growing delay", () => {
    const { rs, sockets, timers } = setup();
    rs.start();
    sockets[0]!.onclose?.();
    expect(rs.state).toBe("reconnecting");
    timers.fireAll();
    expect(sockets).toHaveLength(2);
    sockets[1]!.onclose?.();
    timers.fireAll();
    sockets[2]!.onclose?.();
    expect(timers.delays).toEqual([500, 1000, 2000]);
  });

  it("resets backoff after hello-ack", () => {
    const { rs, sockets, timers } = setup();
    rs.start();
    sockets[0]!.onclose?.();
    timers.fireAll();
    sockets[1]!.onclose?.();
    timers.fireAll();
    sockets[2]!.serverMessage(ack);
    sockets[2]!.onclose?.();
    expect(retryDelays(timers)).toEqual([500, 1000, 500]);
  });

  it("does not reset backoff if the server never acknowledges", () => {
    const { rs, sockets, timers } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.();
    timers.fireAll();
    sockets[1]!.onopen?.();
    sockets[1]!.onclose?.();
    expect(timers.delays.filter((d) => d !== 5000)).toEqual([500, 1000]);
  });

  it("close() cancels a pending retry and ends closed", () => {
    const { rs, sockets, timers } = setup();
    rs.start();
    sockets[0]!.onclose?.();
    expect(timers.pending.size).toBe(1);
    rs.close();
    expect(timers.pending.size).toBe(0);
    expect(rs.state).toBe("closed");
    timers.fireAll();
    expect(sockets).toHaveLength(1);
  });

  it("close() closes the live socket and does not retry", () => {
    const { rs, sockets, timers } = setup();
    rs.start();
    const s = sockets[0]!;
    s.serverMessage(ack);
    rs.close();
    expect(s.closed).toBe(true);
    s.onclose?.();
    expect(timers.pending.size).toBe(0);
    expect(rs.state).toBe("closed");
  });

  it("a message that fails decode for protocol version ends rejected with unsupported-version; malformed data is still ignored", () => {
    const { rs, sockets, timers, messages } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    sockets[0]!.serverMessage("garbage");
    expect(rs.state).toBe("connecting");
    expect(sockets[0]!.closed).toBe(false);
    expect(messages).toEqual([]);
    sockets[0]!.serverMessage(
      '{"v":2,"type":"hello-ack","payload":{"serverVersion":"1"}}',
    );
    expect(rs.state).toBe("rejected");
    expect(rs.rejection).toBe("unsupported-version");
    expect(sockets[0]!.closed).toBe(true);
    expect(timers.pending.size).toBe(0);
    timers.fireAll();
    expect(sockets).toHaveLength(1);
  });

  it("forwards valid messages and sends only when open", () => {
    const { rs, sockets, messages } = setup();
    rs.start();
    const ping: BridgeMessage = { v: 1, type: "ping", payload: {} };
    expect(rs.send(ping)).toBe(false);
    sockets[0]!.serverMessage(ack);
    expect(rs.send(ping)).toBe(true);
    expect(sockets[0]!.sent).toEqual([encodeMessage(ping)]);
    expect(messages.map((m) => m.type)).toEqual(["hello-ack"]);
  });

  it("start() is idempotent", () => {
    const { rs, sockets } = setup();
    rs.start();
    rs.start();
    expect(sockets).toHaveLength(1);
  });

  it("closes and retries a socket that opens but never gets hello-ack", () => {
    const { rs, sockets, timers } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    expect(timers.delays).toEqual([5000]);
    timers.fireAll();
    expect(sockets[0]!.closed).toBe(true);
    expect(rs.state).toBe("reconnecting");
    expect(timers.delays).toEqual([5000, 500]);
    timers.fireAll();
    expect(sockets).toHaveLength(2);
  });

  it("does not time out once hello-ack arrives", () => {
    const { rs, timers } = setupOpen();
    // Only the heartbeat's ping timer may remain; the ack timeout is gone.
    expect(
      timers.pendingDelays().filter((d) => d !== PING_INTERVAL_MS),
    ).toEqual([]);
    expect(rs.state).toBe("open");
  });

  it("a non-fatal error is forwarded and the socket stays open with no retry", () => {
    const { rs, sockets, timers, messages } = setupOpen();
    sockets[0]!.serverMessage(errorReply("malformed-json", false));
    expect(messages.map((m) => m.type)).toEqual(["hello-ack", "error"]);
    expect(sockets[0]!.closed).toBe(false);
    expect(rs.state).toBe("open");
    expect(retryDelays(timers)).toEqual([]);
    expect(sockets).toHaveLength(1);
  });

  it("a fatal bad-token error stops retrying and ends rejected with rejection bad-token", () => {
    const { rs, sockets, timers, messages, states } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    sockets[0]!.serverMessage(errorReply("bad-token", true));
    expect(messages.map((m) => m.type)).toEqual(["error"]);
    expect(sockets[0]!.closed).toBe(true);
    expect(rs.state).toBe("rejected");
    expect(states.at(-1)).toBe("rejected");
    expect(rs.rejection).toBe("bad-token");
    expect(timers.pending.size).toBe(0);
    timers.fireAll();
    expect(sockets).toHaveLength(1);
  });

  it("a fatal unsupported-version error ends rejected with rejection unsupported-version", () => {
    const { rs, sockets, timers, messages } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    sockets[0]!.serverMessage(errorReply("unsupported-version", true));
    expect(messages.map((m) => m.type)).toEqual(["error"]);
    expect(sockets[0]!.closed).toBe(true);
    expect(rs.state).toBe("rejected");
    expect(rs.rejection).toBe("unsupported-version");
    expect(timers.pending.size).toBe(0);
    timers.fireAll();
    expect(sockets).toHaveLength(1);
  });

  it("another fatal error (e.g. code unauthenticated, fatal true) closes the socket and reconnects with backoff", () => {
    const { rs, sockets, timers, messages } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    sockets[0]!.serverMessage(errorReply("unauthenticated", true));
    expect(messages.map((m) => m.type)).toEqual(["error"]);
    expect(sockets[0]!.closed).toBe(true);
    expect(rs.state).toBe("reconnecting");
    expect(rs.rejection).toBeNull();
    expect(retryDelays(timers)).toEqual([500]);
    timers.fireAll();
    expect(sockets).toHaveLength(2);
  });

  it("a throwing createSocket on start schedules a retry", () => {
    const { rs, sockets, timers } = setup([0]);
    expect(() => rs.start()).not.toThrow();
    expect(rs.state).toBe("reconnecting");
    expect(timers.delays).toEqual([500]);
    timers.fireAll();
    expect(sockets).toHaveLength(1);
  });

  it("a throwing createSocket on a retry keeps retrying with growing delay", () => {
    const { rs, sockets, timers } = setup([1, 2]);
    rs.start();
    sockets[0]!.onclose?.();
    expect(() => timers.fireAll()).not.toThrow();
    expect(rs.state).toBe("reconnecting");
    expect(() => timers.fireAll()).not.toThrow();
    expect(rs.state).toBe("reconnecting");
    expect(timers.delays).toEqual([500, 1000, 2000]);
    timers.fireAll();
    expect(sockets).toHaveLength(2);
  });

  it("sends a ping 15 s after hello-ack", () => {
    const { sockets, timers } = setupOpen();
    expect(PING_INTERVAL_MS).toBe(15000);
    expect(timers.pendingDelays()).toEqual([PING_INTERVAL_MS]);
    expect(sockets[0]!.sentTypes()).toEqual(["hello"]);
    timers.fire(PING_INTERVAL_MS);
    expect(sockets[0]!.sentTypes()).toEqual(["hello", "ping"]);
  });

  it("a missing pong within 5 s drops the socket and reconnects", () => {
    const { rs, sockets, timers } = setupOpen();
    timers.fire(PING_INTERVAL_MS);
    expect(PONG_TIMEOUT_MS).toBe(5000);
    expect(timers.pendingDelays()).toEqual([PONG_TIMEOUT_MS]);
    timers.fire(PONG_TIMEOUT_MS);
    expect(sockets[0]!.closed).toBe(true);
    expect(rs.state).toBe("reconnecting");
    expect(timers.pendingDelays()).toEqual([500]);
    timers.fireAll();
    expect(sockets).toHaveLength(2);
  });

  it("a pong cancels the deadline and schedules the next ping", () => {
    const { rs, sockets, timers } = setupOpen();
    timers.fire(PING_INTERVAL_MS);
    expect(timers.pendingDelays()).toEqual([PONG_TIMEOUT_MS]);
    sockets[0]!.serverMessage(pong);
    expect(timers.pendingDelays()).toEqual([PING_INTERVAL_MS]);
    expect(sockets[0]!.closed).toBe(false);
    expect(rs.state).toBe("open");
    timers.fire(PING_INTERVAL_MS);
    expect(sockets[0]!.sentTypes()).toEqual(["hello", "ping", "ping"]);
  });

  it("no ping or deadline fires after close(), failure or rejection", () => {
    // close() before the first ping
    const a = setupOpen();
    expect(a.timers.pendingDelays()).toEqual([PING_INTERVAL_MS]);
    a.rs.close();
    expect(a.timers.pending.size).toBe(0);

    // close() while waiting for a pong
    const b = setupOpen();
    b.timers.fire(PING_INTERVAL_MS);
    expect(b.sockets[0]!.sentTypes().at(-1)).toBe("ping");
    b.rs.close();
    expect(b.timers.pending.size).toBe(0);

    // the socket fails while waiting for a pong: only the retry remains
    const c = setupOpen();
    c.timers.fire(PING_INTERVAL_MS);
    expect(c.sockets[0]!.sentTypes().at(-1)).toBe("ping");
    c.sockets[0]!.onclose?.();
    expect(c.timers.pendingDelays()).toEqual([500]);

    // rejection while waiting for a pong: nothing remains
    const d = setupOpen();
    d.timers.fire(PING_INTERVAL_MS);
    expect(d.sockets[0]!.sentTypes().at(-1)).toBe("ping");
    d.sockets[0]!.serverMessage(errorReply("bad-token", true));
    expect(d.rs.state).toBe("rejected");
    expect(d.timers.pending.size).toBe(0);
  });
});
