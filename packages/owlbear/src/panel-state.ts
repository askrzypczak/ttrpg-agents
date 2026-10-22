import type { RejectionCode, SocketState } from "./reconnecting-socket.js";

import type { PlayerRole } from "./scene-model.js";

export type { PlayerRole };

export interface PanelInput {
  role: PlayerRole;
  socketState: SocketState;
  /** Milliseconds since the current connection attempt streak began. */
  disconnectedMs: number;
  /** Show the stalled hint once disconnected this long. */
  stalledAfterMs?: number;
  /** True when the panel URL carried no bridge token. */
  tokenMissing?: boolean;
  /** Description of the latest encounter sync failure, if not yet recovered. */
  syncError?: string;
  /** The bridge's refusal of the latest token deletion, if any (see token-deleted.ts). */
  removeError?: string;
  /** Why the bridge rejected us, when socketState is "rejected". */
  rejection?: RejectionCode;
}

export interface PanelView {
  kind:
    | "gm-only"
    | "token-missing"
    | "connected"
    | "connecting"
    | "reconnecting"
    | "closed"
    | "rejected-token"
    | "rejected-version"
    | "superseded";
  message: string;
  /** A user action the panel offers, e.g. reclaiming the bridge from another tab. */
  action?: "use-this-tab";
  /** Extra explanation when the connection seems stuck. */
  hint?: string;
  /** Visible encounter sync failure. */
  error?: string;
}

/**
 * Readable text for a rejection. The SDK rejects with the host's plain
 * `{ name, message }` payload, not an Error.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    if (typeof message === "string")
      return typeof name === "string" ? `${name}: ${message}` : message;
  }
  return String(error);
}

export const DEFAULT_STALLED_AFTER_MS = 8000;

export const STALLED_HINT =
  "Still not connected. Chrome may be asking for (or blocking) local network access: " +
  "allow it in the address bar or site settings for owlbear.rodeo, and make sure " +
  "the bridge is running (npm run bridge).";

export function panelView(input: PanelInput): PanelView {
  const view = connectionView(input);
  if (view.kind === "gm-only" || view.kind === "token-missing") return view;
  const errors = [
    input.syncError ? `Encounter sync failed: ${input.syncError}` : undefined,
    input.removeError,
  ].filter((e): e is string => !!e);
  return errors.length > 0 ? { ...view, error: errors.join(" ") } : view;
}

function connectionView(input: PanelInput): PanelView {
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
    case "rejected":
      if (input.rejection === "superseded") {
        return {
          kind: "superseded",
          message: "Connected in another tab.",
          action: "use-this-tab",
        };
      }
      return input.rejection === "unsupported-version"
        ? {
            kind: "rejected-version",
            message:
              "Bridge and extension versions differ: rebuild the extension and the bridge.",
          }
        : {
            kind: "rejected-token",
            message:
              "The bridge rejected the token: reinstall via the URL the bridge printed.",
          };
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
