import { describe, expect, it } from "vitest";
import { encodeMessage, type BridgeMessage } from "./protocol.js";
import {
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

function setup() {
  const sockets: FakeSocket[] = [];
  const timers = new FakeTimers();
  const states: SocketState[] = [];
  const messages: BridgeMessage[] = [];
  const rs = new ReconnectingSocket({
    url: "ws://x",
    createSocket: () => {
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
    expect(timers.delays).toEqual([500, 1000, 500]);
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

  it("ignores messages with a bad protocol version or malformed data", () => {
    const { rs, sockets, messages } = setup();
    rs.start();
    sockets[0]!.serverMessage(
      '{"v":2,"type":"hello-ack","payload":{"serverVersion":"1"}}',
    );
    sockets[0]!.serverMessage("garbage");
    expect(rs.state).toBe("connecting");
    expect(messages).toEqual([]);
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
    const { rs, sockets, timers } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    sockets[0]!.serverMessage(ack);
    expect(timers.pending.size).toBe(0);
    expect(rs.state).toBe("open");
  });

  it("treats an error reply as failure and retries", () => {
    const { rs, sockets, timers, messages } = setup();
    rs.start();
    sockets[0]!.onopen?.();
    sockets[0]!.serverMessage(
      encodeMessage({
        v: 1,
        type: "error",
        payload: { code: "x", message: "bad" },
      }),
    );
    expect(sockets[0]!.closed).toBe(true);
    expect(rs.state).toBe("reconnecting");
    expect(messages.map((m) => m.type)).toEqual(["error"]);
    timers.fireAll();
    expect(sockets).toHaveLength(2);
  });
});
