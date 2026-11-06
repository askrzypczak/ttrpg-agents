export interface BridgeState {
  pid: number;
  port: number;
  /** Absolute path of the checkout the bridge runs from. */
  checkout: string;
  /** `git rev-parse HEAD` of that checkout at start; null when git cannot tell. */
  commit: string | null;
  /** ISO time the process started. */
  startedAt: string;
}

/** `~/.config/ttrpg-agents/bridge-state.json`, beside the token files. */
export function defaultStatePath(): string {
  throw new Error("not implemented");
}

/** Writes the record atomically, mode 0600 (directory 0700). */
export function writeStateFile(
  path: string,
  state: BridgeState,
): Promise<void> {
  void path;
  void state;
  return Promise.reject(new Error("not implemented"));
}

/** The record, or null when the file is missing or not a valid record. */
export function readStateFile(path: string): Promise<BridgeState | null> {
  void path;
  return Promise.reject(new Error("not implemented"));
}

/** Removes the file only if it records `pid`; a missing file is fine. */
export function removeStateFile(path: string, pid: number): Promise<void> {
  void path;
  void pid;
  return Promise.reject(new Error("not implemented"));
}

/** HEAD of the git checkout at `dir`, or null. */
export function checkoutCommit(dir: string): string | null {
  void dir;
  throw new Error("not implemented");
}
