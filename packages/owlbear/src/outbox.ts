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
  // `stale`: sent on a connection that has since been replaced.
  let commands: (PendingCommand & { stale: boolean })[] = [];
  let reported = 0;

  const waiting = (): number => commands.filter((c) => c.queued).length;
  const report = (): void => {
    const now = waiting();
    if (now === reported) return;
    reported = now;
    onWaitingChange?.(now);
  };

  return {
    submit(message) {
      const older = commands.some((c) => c.queued);
      commands.push({
        id: message.id ?? "",
        message,
        queued: older || !send(message),
        stale: false,
      });
      report();
    },
    helloAck() {
      for (const command of commands) {
        if (!command.queued) command.stale = true;
      }
      for (const command of commands) {
        if (!command.queued) continue;
        if (!send(command.message)) break;
        command.queued = false;
      }
      report();
    },
    snapshot() {
      commands = commands.filter((c) => !c.stale);
    },
    settle(id) {
      const command = commands.find((c) => c.id === id);
      if (command === undefined) return undefined;
      commands = commands.filter((c) => c !== command);
      report();
      return { id, message: command.message, queued: command.queued };
    },
    pending() {
      return commands.map(({ id, message, queued }) => ({
        id,
        message,
        queued,
      }));
    },
    waiting,
  };
}
