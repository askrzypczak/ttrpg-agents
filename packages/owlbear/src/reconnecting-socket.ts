import {
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type BridgeMessage,
} from "@ttrpg-agents/protocol";
import { nextDelay, type BackoffOptions } from "./backoff.js";

export type SocketState =
  "connecting" | "open" | "reconnecting" | "closed" | "rejected";

/** Fatal server errors that stop reconnection until the user acts. */
export type RejectionCode = "bad-token" | "unsupported-version" | "superseded";

/** Idle time after hello-ack (or the last pong) before sending a ping. */
export const PING_INTERVAL_MS = 15000;
/** How long to wait for a pong before dropping the socket. */
export const PONG_TIMEOUT_MS = 5000;

/** Minimal WebSocket surface (satisfied by the browser WebSocket). */
export interface SocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReconnectingSocketOptions {
  url: string;
  createSocket: (url: string) => SocketLike;
  /** Sent on every (re)connect as soon as the socket opens. */
  hello: () => BridgeMessage;
  timers?: Timers;
  backoff?: BackoffOptions;
  /** Close and retry if no hello-ack arrives this long after open. */
  ackTimeoutMs?: number;
  onStateChange?: (state: SocketState) => void;
  onMessage?: (message: BridgeMessage) => void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Keeps a WebSocket alive with exponential backoff. The connection counts as
 * "open" only once the server answers our hello with hello-ack, and the
 * backoff attempt counter resets at that point.
 */
export class ReconnectingSocket {
  private socket: SocketLike | null = null;
  private timer: unknown = null;
  private ackTimer: unknown = null;
  private pingTimer: unknown = null;
  private pongTimer: unknown = null;
  private rejected: RejectionCode | null = null;
  private attempt = 0;
  private current: SocketState = "closed";
  private started = false;
  private readonly timers: Timers;
  private readonly opts: ReconnectingSocketOptions;

  constructor(opts: ReconnectingSocketOptions) {
    this.opts = opts;
    this.timers = opts.timers ?? defaultTimers;
  }

  get state(): SocketState {
    return this.current;
  }

  /** Why the server rejected us, once state is "rejected"; otherwise null. */
  get rejection(): RejectionCode | null {
    return this.rejected;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  send(message: BridgeMessage): boolean {
    if (this.current !== "open" || !this.socket) return false;
    this.socket.send(encodeMessage(message));
    return true;
  }

  close(): void {
    this.started = false;
    this.rejected = null;
    this.clearAckTimer();
    this.clearHeartbeat();
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      detach(socket);
      socket.close();
    }
    this.setState("closed");
  }

  private setState(state: SocketState): void {
    if (this.current === state) return;
    this.current = state;
    this.opts.onStateChange?.(state);
  }

  private connect(): void {
    this.timer = null;
    this.rejected = null;
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");
    let socket: SocketLike;
    try {
      socket = this.opts.createSocket(this.opts.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(encodeMessage(this.opts.hello()));
      this.clearAckTimer();
      this.ackTimer = this.timers.setTimeout(
        () => this.fail(socket),
        this.opts.ackTimeoutMs ?? 5000,
      );
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket || typeof ev.data !== "string") return;
      const result = decodeMessage(ev.data);
      if (!result.ok) {
        if (result.reason === "unsupported-version") {
          this.reject(socket, "unsupported-version");
        }
        return;
      }
      if (result.message.type === "error") {
        const { code, fatal } = result.message.payload;
        this.opts.onMessage?.(result.message);
        if (!fatal) return;
        if (code === "bad-token" || code === "unsupported-version") {
          this.reject(socket, code);
        } else {
          this.fail(socket);
        }
        return;
      }
      if (result.message.type === "hello-ack") {
        this.clearAckTimer();
        this.attempt = 0;
        this.setState("open");
        this.startHeartbeat(socket);
      }
      if (result.message.type === "pong" && this.pongTimer !== null) {
        this.timers.clearTimeout(this.pongTimer);
        this.pongTimer = null;
        this.schedulePing(socket);
      }
      this.opts.onMessage?.(result.message);
    };
    socket.onclose = () => {
      this.fail(socket, false);
    };
    socket.onerror = () => {
      // A close event follows; retry is scheduled there.
    };
  }

  /** Drop the given socket (closing it if asked) and schedule a retry. */
  private fail(socket: SocketLike, closeIt = true): void {
    if (this.socket !== socket) return;
    this.clearAckTimer();
    this.clearHeartbeat();
    this.socket = null;
    detach(socket);
    if (closeIt) socket.close();
    this.scheduleRetry();
  }

  /** Fatal rejection: close the socket and stop reconnecting. */
  private reject(socket: SocketLike, code: RejectionCode): void {
    if (this.socket !== socket) return;
    this.clearAckTimer();
    this.clearHeartbeat();
    this.socket = null;
    detach(socket);
    socket.close();
    this.rejected = code;
    this.setState("rejected");
  }

  private startHeartbeat(socket: SocketLike): void {
    this.clearHeartbeat();
    this.schedulePing(socket);
  }

  private schedulePing(socket: SocketLike): void {
    this.pingTimer = this.timers.setTimeout(() => {
      this.pingTimer = null;
      if (this.socket !== socket) return;
      socket.send(
        encodeMessage({ v: PROTOCOL_VERSION, type: "ping", payload: {} }),
      );
      this.pongTimer = this.timers.setTimeout(() => {
        this.pongTimer = null;
        this.fail(socket);
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.pingTimer !== null) this.timers.clearTimeout(this.pingTimer);
    if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private clearAckTimer(): void {
    if (this.ackTimer !== null) {
      this.timers.clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (!this.started) return;
    const delay = nextDelay(this.attempt, this.opts.backoff);
    this.attempt += 1;
    this.setState("reconnecting");
    this.timer = this.timers.setTimeout(() => this.connect(), delay);
  }
}

function detach(socket: SocketLike): void {
  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
}
