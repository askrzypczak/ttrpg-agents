export interface LifecycleOptions {
  statePath: string; // the log is bridge.log beside it
  checkout: string; // the checkout the command runs from
  env: NodeJS.ProcessEnv; // passed to the spawned bridge (BRIDGE_STATE_FILE forced to statePath); status reads BRIDGE_PORT and BRIDGE_AGENT_TOKEN_FILE from it
  build: () => Promise<void>; // throws on failure
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Exit code. */
export function startBridge(options: LifecycleOptions): Promise<number> {
  void options;
  return Promise.reject(new Error("not implemented"));
}

export function stopBridge(options: LifecycleOptions): Promise<number> {
  void options;
  return Promise.reject(new Error("not implemented"));
}

export function restartBridge(options: LifecycleOptions): Promise<number> {
  void options;
  return Promise.reject(new Error("not implemented"));
}

export function bridgeStatus(options: LifecycleOptions): Promise<number> {
  void options;
  return Promise.reject(new Error("not implemented"));
}
