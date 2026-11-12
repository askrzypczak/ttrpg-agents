import type { SetupStatus } from "@ttrpg-agents/engine";

/** The setup report as text, one line per row and a fix line under each problem or warning (no trailing newline). */
export function formatSetupStatus(status: SetupStatus): string {
  void status;
  throw new Error("not implemented");
}
