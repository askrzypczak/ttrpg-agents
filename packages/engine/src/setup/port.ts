export interface ConfigProblemFact {
  level: "error" | "warning";
  source: "file" | "environment";
  key?: string;
  message: string;
}
export interface SettingFact {
  name: string;
  value: string | number;
  source: "environment" | "file" | "default";
}
/** The loaded config as plain values; built by the composition roots. */
export interface SettingsFacts {
  /** The profile as `describeProfile` words it, e.g. "dev (linked git worktree)". */
  profile: string;
  configFile: { path: string; found: boolean };
  problems: readonly ConfigProblemFact[];
  /** Every setting, in the loader's order. */
  settings: readonly SettingFact[];
}
export type DatabaseFile =
  | { kind: "missing" }
  | { kind: "found"; version: number }
  | { kind: "unreadable"; reason: string };
export interface DatabaseFacts {
  path: string;
  /** The version this build's migrations end at. */
  expectedVersion: number;
  file: DatabaseFile;
}
/** `takenAt`: ISO 8601 UTC, the backup file's modification time. */
export type NewestBackup =
  | { kind: "none" }
  | { kind: "found"; path: string; takenAt: string }
  | { kind: "unreadable"; reason: string };
export interface BackupFacts {
  dir: string;
  newest: NewestBackup;
}
export type BridgeAnswer =
  | { kind: "no-token-file" }
  | { kind: "unreachable" }
  | { kind: "token-refused" }
  | { kind: "no-gm-tab" }
  | { kind: "gm-tab-not-answering" }
  | { kind: "gm-tab-connected"; roomId?: string };
export interface BridgeFacts {
  port: number;
  /** The agent token file's path. */
  tokenFile: string;
  answer: BridgeAnswer;
}
/** Driven port: what is at the database path. Never creates or migrates it. */
export interface DatabaseProbe {
  check(): DatabaseFacts;
  /** The newest backup in the backup directory. Never creates the directory, never throws. */
  checkBackups(): BackupFacts;
}
/** Driven port: what a `scene-status` query to the bridge finds. Never rejects. */
export interface BridgeProbe {
  check(): Promise<BridgeFacts>;
}
export interface SetupPorts {
  settings: SettingsFacts;
  database: DatabaseProbe;
  bridge: BridgeProbe;
  now: () => Date;
}
