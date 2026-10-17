import type { SocketState } from "@ttrpg-agents/core/bridge";

export type PlayerRole = "gm" | "player";

export interface PanelInput {
  role: PlayerRole;
  socketState: SocketState;
  /** Milliseconds since the current connection attempt streak began. */
  disconnectedMs: number;
  /** Show the stalled hint once disconnected this long. */
  stalledAfterMs?: number;
  /** True when the panel URL carried no bridge token. */
  tokenMissing?: boolean;
}

export interface PanelView {
  kind:
    | "gm-only"
    | "token-missing"
    | "connected"
    | "connecting"
    | "reconnecting"
    | "closed";
  message: string;
  /** Extra explanation when the connection seems stuck. */
  hint?: string;
}

export const DEFAULT_STALLED_AFTER_MS = 8000;

export const STALLED_HINT =
  "Still not connected. Chrome may be asking for (or blocking) local network access: " +
  "allow it in the address bar or site settings for owlbear.rodeo, and make sure " +
  "the bridge is running (npm run bridge -w @ttrpg-agents/mcp).";

export function panelView(input: PanelInput): PanelView {
  if (input.role !== "gm") {
    return {
      kind: "gm-only",
      message: "This extension is only available to the GM.",
    };
  }
  if (input.tokenMissing) {
    return {
      kind: "token-missing",
      message: "Token missing: reinstall via the URL the bridge printed.",
    };
  }
  const stalledAfter = input.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
  switch (input.socketState) {
    case "open":
      return { kind: "connected", message: "Connected to the local bridge." };
    case "closed":
      return { kind: "closed", message: "Disconnected." };
    case "connecting":
    case "reconnecting": {
      const kind = input.socketState;
      const message =
        kind === "connecting"
          ? "Connecting to the local bridge..."
          : "Connection lost. Reconnecting...";
      return input.disconnectedMs >= stalledAfter
        ? { kind, message, hint: STALLED_HINT }
        : { kind, message };
    }
  }
}
