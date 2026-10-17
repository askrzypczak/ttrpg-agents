import { createServer, type Server } from "node:http";
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
} from "@ttrpg-agents/core/bridge";

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
}

export interface BridgeServer {
  port: number;
  clientCount(): number;
  close(): Promise<void>;
}

function send(ws: WebSocket, message: BridgeMessage): void {
  ws.send(encodeMessage(message));
}

function errorMessage(code: string, message: string): BridgeMessage {
  return {
    v: PROTOCOL_VERSION,
    type: "error",
    payload: { code, message },
  };
}

function handleMessage(ws: WebSocket, raw: string): void {
  const result = decodeMessage(raw);
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
  const { port = DEFAULT_BRIDGE_PORT, staticDir, host = "127.0.0.1" } = options;
  const root = resolvePath(staticDir);
  const clients = new Set<WebSocket>();

  const http: Server = createServer((req, res) => {
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
    void serveStatic(req.url ?? "/", root).then(({ status, body, type }) => {
      res.writeHead(status, { "Content-Type": type });
      res.end(req.method === "HEAD" ? undefined : body);
    });
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });
  http.on("upgrade", (req, socket, head) => {
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
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.on("error", () => clients.delete(ws));
      ws.on("message", (data) => handleMessage(ws, data.toString()));
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
    clientCount: () => clients.size,
    close: async () => {
      for (const ws of clients) ws.terminate();
      clients.clear();
      wss.close();
      await new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        http.closeAllConnections();
      });
    },
  };
}

async function serveStatic(
  url: string,
  root: string,
): Promise<{ status: number; body: string | Buffer; type: string }> {
  const text = "text/plain; charset=utf-8";
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return { status: 400, body: "bad request", type: text };
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = normalize(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    return { status: 403, body: "forbidden", type: text };
  }
  try {
    const body = await readFile(file);
    return {
      status: 200,
      body,
      type: CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    };
  } catch {
    return { status: 404, body: "not found", type: text };
  }
}
