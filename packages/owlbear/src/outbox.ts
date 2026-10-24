import type { BridgeMessage } from "@ttrpg-agents/protocol";

/** A command the extension sent (or still has to send) and the store has not yet settled. */
export interface PendingCommand {
  /** The envelope id of `message`. */
  id: string;
  message: BridgeMessage;
  /** True until `send` has taken the message. */
  queued: boolean;
}

/**
 * The extension's commands from submit until the store settles them (an
 * acknowledging event or a refusal). A command that cannot go out waits for
 * the next connection; one sent on a connection that has since dropped is
 * stale and forgotten at the next snapshot, so a lost command is detected and
 * can be sent again.
 */
export interface Outbox {
  /** Sends the command, or queues it when `send` refuses it or older ones wait. */
  submit(message: BridgeMessage): void;
  /** A connection is acknowledged: earlier sends turn stale, queued commands go out in order until one does not. */
  helloAck(): void;
  /** A snapshot arrived: stale commands are forgotten. */
  snapshot(): void;
  /** Forgets the command and returns it, if it was pending. */
  settle(id: string): PendingCommand | undefined;
  /** Every command not yet settled, in submit order. */
  pending(): readonly PendingCommand[];
  /** How many commands are queued (not yet sent). */
  waiting(): number;
}

/**
 * `send` returns false when the message did not go out (the socket is not
 * open); `onWaitingChange` is called when `waiting()` changes.
 */
export function createOutbox(
  send: (message: BridgeMessage) => boolean,
  onWaitingChange?: (waiting: number) => void,
): Outbox {
  void send;
  void onWaitingChange;
  throw new Error("not implemented");
}
