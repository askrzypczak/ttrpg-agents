import { createServer, type Server } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
  type BridgeMessage,
} from "@ttrpg-agents/protocol";

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
}

export interface BridgeServer {
  port: number;
  token: string;
  clientCount(): number;
  /** Sends to every authenticated client; unauthenticated sockets get nothing. */
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
]);

function errorMessage(code: string, message: string): BridgeMessage {
  return {
    v: PROTOCOL_VERSION,
    type: "error",
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

interface Hooks {
  token: string;
  snapshot: (() => BridgeMessage) | undefined;
  onAuthenticated: () => void;
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
      if (hooks.snapshot) {
        try {
          send(ws, hooks.snapshot());
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
      break;
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
  } = options;
  const root = resolvePath(staticDir);
  const clients = new Set<WebSocket>();
  const authenticatedClients = new Set<WebSocket>();

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
        authenticatedClients.delete(ws);
      };
      const hooks: Hooks = {
        token,
        snapshot,
        onAuthenticated: () => authenticatedClients.add(ws),
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
      for (const ws of authenticatedClients) {
        if (ws.readyState === ws.OPEN) ws.send(encoded);
      }
    },
    close: async () => {
      for (const ws of clients) ws.terminate();
      clients.clear();
      authenticatedClients.clear();
      wss.close();
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        http.closeAllConnections();
      });
    },
  };
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
