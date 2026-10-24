import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  extname,
  join,
  normalize,
  resolve as resolvePath,
  sep,
} from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  querySchema,
  type AgentQueryResponse,
  type BridgeMessage,
  type Query,
} from "@ttrpg-agents/protocol";
import type { InstanceEdit, TokenArt } from "@ttrpg-agents/engine";

export const DEFAULT_BRIDGE_PORT = 5199;
export const SERVER_VERSION = "0.0.0";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const MAX_QUERY_BODY_BYTES = 1024 * 1024;
const DEFAULT_QUERY_TIMEOUT_MS = 5000;

const ALLOWED_ORIGINS = new Set([
  "https://www.owlbear.rodeo",
  "https://owlbear.rodeo",
]);

export interface BridgeServerOptions {
  /** 0 picks an ephemeral port. */
  port?: number;
  /** Directory of the built extension (contains manifest.json). */
  staticDir: string;
  host?: string;
  /** Shared secret clients must present in `hello`. Defaults to a random one. */
  token?: string;
  /** Message sent to a client right after each `hello-ack`, so it converges on current state. */
  snapshot?: () => BridgeMessage;
  /** Bearer secret for `POST /agent/query`. Defaults to a random one. */
  agentToken?: string;
  /** How long `POST /agent/query` waits for the client's reply. Default 5000. */
  queryTimeoutMs?: number;
  /** Removes an instance from the store when the GM deletes its token on the table. */
  removeInstance?: (instanceId: string, commandId: string) => WriteBackResult;
  /** Stores the art the GM picked for a monster type. */
  setTokenArt?: (monsterKey: string, art: TokenArt) => void;
  /** Applies HP, max HP or armor class edited on the table to the store. */
  editInstance?: (edit: InstanceEdit, commandId: string) => WriteBackResult;
}

/** Outcome of a write the table asked for; a refusal changes nothing. */
export type WriteBackResult =
  { ok: true } | { ok: false; code: string; message: string };

export interface BridgeServer {
  port: number;
  token: string;
  clientCount(): number;
  /** Sends to the active (newest authenticated) client; unauthenticated sockets get nothing. */
  broadcast(message: BridgeMessage): void;
  close(): Promise<void>;
}

function send(ws: WebSocket, message: BridgeMessage): void {
  ws.send(encodeMessage(message));
}

const FATAL_ERROR_CODES = new Set([
  "bad-token",
  "unauthenticated",
  "unsupported-version",
  "superseded",
]);

function errorMessage(
  code: string,
  message: string,
  id?: string,
): BridgeMessage {
  return {
    v: PROTOCOL_VERSION,
    type: "error",
    // Stryker disable next-line ConditionalExpression: equivalent, an undefined id is dropped when the message is encoded
    ...(id !== undefined ? { id } : {}),
    payload: { code, message, fatal: FATAL_ERROR_CODES.has(code) },
  };
}

function tokenMatches(expected: string, given: string): boolean {
  // Hash both so the buffers are equal length for timingSafeEqual.
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

function rejectAndClose(ws: WebSocket, code: string, message: string): void {
  send(ws, errorMessage(code, message));
  ws.close(1008, code);
}

interface Session {
  authenticated: boolean;
}

/** A query awaiting the client's `query-result` or `error`, keyed by id. */
interface Pending {
  resolve(response: AgentQueryResponse): void;
}

interface Hooks {
  token: string;
  pending: Map<string, Pending>;
  snapshot: (() => BridgeMessage) | undefined;
  removeInstance:
    ((instanceId: string, commandId: string) => WriteBackResult) | undefined;
  setTokenArt: ((monsterKey: string, art: TokenArt) => void) | undefined;
  editInstance:
    ((edit: InstanceEdit, commandId: string) => WriteBackResult) | undefined;
  onAuthenticated: () => void;
}

/**
 * Sends the current snapshot, if configured; a failing one is a non-fatal
 * error. `cause` names the request the snapshot answers.
 */
function sendSnapshot(ws: WebSocket, hooks: Hooks, cause?: string): void {
  if (!hooks.snapshot) return;
  try {
    const snapshot = hooks.snapshot();
    send(
      ws,
      // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent on the wire, JSON drops an undefined cause and the hook only returns snapshots
      cause !== undefined && snapshot.type === "encounter-snapshot"
        ? { ...snapshot, payload: { ...snapshot.payload, cause } }
        : snapshot,
    );
  } catch (e) {
    send(
      ws,
      errorMessage(
        "snapshot-failed",
        e instanceof Error ? e.message : String(e),
      ),
    );
  }
}

/**
 * The command a write-back belongs to: the envelope id, or a fresh id when the
 * message has none or an empty one.
 */
function commandIdOf(id: string | undefined): string {
  return id === undefined || id === "" ? randomUUID() : id;
}

// Authorization is decided only by the token. The client-supplied `role` in
// `hello` is never read here; it only drives the extension UI.
function handleMessage(
  ws: WebSocket,
  session: Session,
  hooks: Hooks,
  raw: string,
): void {
  const { token } = hooks;
  const result = decodeMessage(raw);
  if (!result.ok && result.reason === "unsupported-version") {
    rejectAndClose(ws, "unsupported-version", result.detail);
    return;
  }
  if (!session.authenticated) {
    if (!result.ok || result.message.type !== "hello") {
      rejectAndClose(
        ws,
        "unauthenticated",
        "send hello with a valid token first",
      );
      return;
    }
    if (!tokenMatches(token, result.message.payload.token)) {
      rejectAndClose(ws, "bad-token", "invalid token");
      return;
    }
    session.authenticated = true;
    hooks.onAuthenticated();
  }
  if (!result.ok) {
    send(ws, errorMessage(result.reason, result.detail));
    return;
  }
  const { message } = result;
  switch (message.type) {
    case "hello":
      send(ws, {
        v: PROTOCOL_VERSION,
        type: "hello-ack",
        ...(message.id !== undefined ? { id: message.id } : {}),
        payload: { serverVersion: SERVER_VERSION },
      });
      sendSnapshot(ws, hooks);
      break;
    case "token-deleted": {
      if (!hooks.removeInstance) {
        send(
          ws,
          errorMessage(
            "unexpected-type",
            `server does not accept "${message.type}"`,
          ),
        );
        break;
      }
      let outcome: WriteBackResult;
      try {
        outcome = hooks.removeInstance(
          message.payload.instanceId,
          commandIdOf(message.id),
        );
      } catch (e) {
        send(
          ws,
          errorMessage(
            "remove-failed",
            e instanceof Error ? e.message : String(e),
            message.id,
          ),
        );
        break;
      }
      if (outcome.ok) {
        // The log poller also broadcasts this removal as a `table` event, but
        // the extension ignores `table` events, so answer with the new state
        // until deltas replace this snapshot (#209).
        sendSnapshot(ws, hooks);
      } else {
        send(ws, errorMessage(outcome.code, outcome.message, message.id));
      }
      break;
    }
    case "instance-edit": {
      if (!hooks.editInstance) {
        send(
          ws,
          errorMessage(
            "unexpected-type",
            `server does not accept "${message.type}"`,
          ),
        );
        break;
      }
      let outcome: WriteBackResult;
      try {
        outcome = hooks.editInstance(message.payload, commandIdOf(message.id));
      } catch (e) {
        send(
          ws,
          errorMessage(
            "edit-failed",
            e instanceof Error ? e.message : String(e),
            message.id,
          ),
        );
        break;
      }
      if (outcome.ok) {
        // Answer with the new state, like token-deleted: the log poller's
        // `table` event for this edit is ignored by the extension. The snapshot
        // names the request it answers (`cause`) until #209.
        sendSnapshot(ws, hooks, message.id);
      } else {
        send(ws, errorMessage(outcome.code, outcome.message, message.id));
      }
      break;
    }
    case "token-art-set": {
      if (!hooks.setTokenArt) {
        send(
          ws,
          errorMessage(
            "unexpected-type",
            `server does not accept "${message.type}"`,
          ),
        );
        break;
      }
      try {
        hooks.setTokenArt(message.payload.monsterKey, message.payload.art);
      } catch (e) {
        send(
          ws,
          errorMessage(
            "token-art-failed",
            e instanceof Error ? e.message : String(e),
            message.id,
          ),
        );
        break;
      }
      // Token art is not in the change log, so no event tells the client;
      // send the new state directly.
      sendSnapshot(ws, hooks);
      break;
    }
    case "query-result": {
      const waiting = hooks.pending.get(message.id ?? "");
      if (waiting === undefined) {
        send(
          ws,
          errorMessage("unknown-query-id", "no query is waiting for that id"),
        );
        break;
      }
      waiting.resolve({ ok: true, result: message.payload });
      break;
    }
    case "error": {
      const waiting = hooks.pending.get(message.id ?? "");
      if (waiting === undefined) {
        send(
          ws,
          errorMessage("unexpected-type", 'server does not accept "error"'),
        );
        break;
      }
      waiting.resolve({
        ok: false,
        error: { code: "query-failed", message: message.payload.message },
      });
      break;
    }
    case "ping":
      send(ws, {
        v: PROTOCOL_VERSION,
        type: "pong",
        ...(message.id !== undefined ? { id: message.id } : {}),
        payload: {},
      });
      break;
    default:
      send(
        ws,
        errorMessage(
          "unexpected-type",
          `server does not accept "${message.type}"`,
        ),
      );
  }
}

export async function startBridgeServer(
  options: BridgeServerOptions,
): Promise<BridgeServer> {
  const {
    port = DEFAULT_BRIDGE_PORT,
    staticDir,
    host = "127.0.0.1",
    token = randomBytes(32).toString("hex"),
    snapshot,
    agentToken = randomBytes(32).toString("hex"),
    queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
    removeInstance,
    setTokenArt,
    editInstance,
  } = options;
  const root = resolvePath(staticDir);
  const clients = new Set<WebSocket>();
  // The newest authenticated client; a second one displaces it.
  let active: WebSocket | null = null;
  const pending = new Map<string, Pending>();

  /** Relays `query` to the active client and awaits its reply or the timeout. */
  const sendQuery = (query: Query): Promise<AgentQueryResponse> => {
    const target = active;
    // Stryker disable next-line ConditionalExpression,EqualityOperator: only the `readyState` half is equivalent (`active` is cleared on close, so a non-OPEN target is a sub-millisecond race); the `null` half is killed by the not-connected test
    if (target === null || target.readyState !== target.OPEN) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "not-connected",
          message: "no Owlbear GM tab is connected to the bridge",
        },
      });
    }
    const id = randomUUID();
    return new Promise((resolve) => {
      const finish = (response: AgentQueryResponse): void => {
        // Stryker disable next-line all: a leftover timer would only re-run this idempotent cleanup; it just delays process exit
        clearTimeout(timer);
        pending.delete(id);
        resolve(response);
      };
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            error: {
              code: "timeout",
              message: `the Owlbear tab did not reply within ${String(queryTimeoutMs)} ms`,
            },
          }),
        queryTimeoutMs,
      );
      pending.set(id, { resolve: finish });
      send(target, {
        v: PROTOCOL_VERSION,
        type: "query",
        id,
        payload: query,
      });
    });
  };

  // DNS rebinding defense: only accept requests addressed to loopback names.
  const hostAllowed = (hostHeader: string | undefined): boolean => {
    const actualPort = (http.address() as AddressInfo).port;
    return (
      hostHeader === `localhost:${actualPort}` ||
      hostHeader === `127.0.0.1:${actualPort}`
    );
  };

  const http: Server = createServer((req, res) => {
    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("forbidden host");
      return;
    }
    if (req.method === "POST" && req.url === "/agent/query") {
      // A body aborted mid-request rejects the read; the caller is gone.
      handleAgentQuery(req, res, agentToken, sendQuery).catch(() => {
        res.destroy();
      });
      return;
    }
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors https://www.owlbear.rodeo https://owlbear.rodeo",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    void serveStatic(req.url ?? "/", root, token).then(
      ({ status, body, type }) => {
        res.writeHead(status, { "Content-Type": type });
        res.end(req.method === "HEAD" ? undefined : body);
      },
    );
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });
  http.on("upgrade", (req, socket, head) => {
    if (!hostAllowed(req.headers.host)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const actualPort = (http.address() as AddressInfo).port;
    const allowedOrigins = [
      `http://localhost:${actualPort}`,
      `http://127.0.0.1:${actualPort}`,
    ];
    if (path !== "/ws" || !allowedOrigins.includes(req.headers.origin ?? "")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const session: Session = { authenticated: false };
      clients.add(ws);
      const forget = () => {
        clients.delete(ws);
        // Stryker disable next-line ConditionalExpression: only the `false` variant is equivalent (broadcast re-checks readyState); `true` is killed by the late-close test
        if (active === ws) active = null;
      };
      const hooks: Hooks = {
        token,
        pending,
        snapshot,
        removeInstance,
        setTokenArt,
        editInstance,
        onAuthenticated: () => {
          if (active !== null) {
            rejectAndClose(active, "superseded", "another tab connected");
          }
          active = ws;
        },
      };
      ws.on("close", forget);
      ws.on("error", forget);
      ws.on("message", (data) =>
        handleMessage(ws, session, hooks, data.toString()),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => {
      http.off("error", reject);
      resolve();
    });
  });

  return {
    port: (http.address() as AddressInfo).port,
    token,
    clientCount: () => clients.size,
    broadcast: (message) => {
      const encoded = encodeMessage(message);
      // Stryker disable next-line ConditionalExpression: only the readyState `true` variant is equivalent (ws.send on a non-OPEN socket is a silent no-op); the other variants are killed by the broadcast tests
      if (active !== null && active.readyState === active.OPEN) {
        active.send(encoded);
      }
    },
    close: async () => {
      for (const ws of clients) ws.terminate();
      clients.clear();
      active = null;
      // Stryker disable all: the sockets are destroyed right after, so a pending call's HTTP response is never observable; this only releases its timer.
      for (const waiting of [...pending.values()]) {
        waiting.resolve({
          ok: false,
          error: { code: "not-connected", message: "the bridge is closing" },
        });
      }
      // Stryker restore all
      wss.close();
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        http.closeAllConnections();
      });
    },
  };
}

const STATUS_FOR_CODE: Record<string, number> = {
  unauthorized: 401,
  "bad-request": 400,
  "not-connected": 503,
  timeout: 504,
  "query-failed": 502,
};

function respondJson(
  res: ServerResponse,
  status: number,
  body: AgentQueryResponse,
): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function respondError(
  res: ServerResponse,
  code: "unauthorized" | "bad-request",
  message: string,
): void {
  respondJson(res, STATUS_FOR_CODE[code] ?? 400, {
    ok: false,
    error: { code, message },
  });
}

/** Reads the body up to the cap; `null` when it is larger. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    // Keep draining (without storing) so the 400 can still be sent.
    // Stryker disable next-line ConditionalExpression: the `true` variant (store everything) is equivalent, the size check below still rejects
    if (size <= MAX_QUERY_BODY_BYTES) chunks.push(buf);
  }
  return size > MAX_QUERY_BODY_BYTES
    ? null
    : Buffer.concat(chunks).toString("utf8");
}

// No CORS headers: only a non-browser caller holding the agent token uses this.
async function handleAgentQuery(
  req: IncomingMessage,
  res: ServerResponse,
  agentToken: string,
  sendQuery: (query: Query) => Promise<AgentQueryResponse>,
): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!tokenMatches(agentToken, bearer)) {
    respondError(res, "unauthorized", "missing or invalid agent token");
    return;
  }
  const body = await readBody(req);
  if (body === null) {
    respondError(res, "bad-request", "body too large");
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    respondError(res, "bad-request", "body is not valid JSON");
    return;
  }
  const parsed = querySchema.safeParse(json);
  if (!parsed.success) {
    respondError(res, "bad-request", "not a known query");
    return;
  }
  const response = await sendQuery(parsed.data);
  respondJson(
    res,
    response.ok ? 200 : (STATUS_FOR_CODE[response.error.code] ?? 502),
    response,
  );
}

function withTokenPopover(manifestJson: string, token: string): string {
  try {
    const manifest = JSON.parse(manifestJson) as {
      action?: { popover?: unknown };
    };
    if (manifest.action && typeof manifest.action.popover === "string") {
      manifest.action.popover = `/index.html#${token}`;
    }
    return JSON.stringify(manifest);
  } catch {
    return manifestJson;
  }
}

async function serveStatic(
  url: string,
  root: string,
  token: string,
): Promise<{ status: number; body: string | Buffer; type: string }> {
  const text = "text/plain; charset=utf-8";
  let pathname: string;
  let presentedToken: string | null;
  try {
    const parsed = new URL(url, "http://localhost");
    pathname = decodeURIComponent(parsed.pathname);
    presentedToken = parsed.searchParams.get("token");
  } catch {
    return { status: 400, body: "bad request", type: text };
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    return { status: 403, body: "forbidden", type: text };
  }
  try {
    let body: string | Buffer = await readFile(file);
    // Only a request that already presents the token learns it (as a URL
    // fragment, which the browser never sends back over HTTP).
    if (
      pathname === "/manifest.json" &&
      presentedToken !== null &&
      tokenMatches(token, presentedToken)
    ) {
      body = withTokenPopover(body.toString("utf8"), token);
    }
    return {
      status: 200,
      body,
      type: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    };
  } catch {
    return { status: 404, body: "not found", type: text };
  }
}
