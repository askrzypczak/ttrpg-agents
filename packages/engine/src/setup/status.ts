import type {
  BridgeFacts,
  ConfigProblemFact,
  DatabaseFacts,
  SettingFact,
  SetupPorts,
} from "./port.js";

export type SetupState = "ok" | "warning" | "problem";
export type SetupFix =
  | {
      code: "fix-config";
      source: "file" | "environment";
      key?: string;
      configFile: string;
    }
  | { code: "start-bridge" }
  | { code: "restart-bridge" }
  | { code: "restart-bridge-in-this-profile"; port: number }
  | { code: "open-gm-tab"; port: number }
  | { code: "reload-gm-tab" }
  | { code: "update-checkout" }
  | { code: "check-database" };
export type SetupRow =
  | { item: "profile"; state: "ok"; profile: string }
  | { item: "config-file"; state: "ok"; path: string; found: boolean }
  | {
      item: "config-problem";
      state: "warning" | "problem";
      problem: ConfigProblemFact;
      fix: SetupFix;
    }
  | { item: "setting"; state: "ok"; setting: SettingFact }
  | {
      item: "database";
      state: SetupState;
      database: DatabaseFacts;
      fix?: SetupFix;
    }
  | { item: "bridge"; state: SetupState; bridge: BridgeFacts; fix?: SetupFix }
  | {
      item: "gm-tab";
      state: SetupState;
      port: number;
      tab: "connected" | "none" | "not-answering";
      roomId?: string;
      fix?: SetupFix;
    };
export interface SetupStatus {
  ready: boolean;
  rows: SetupRow[];
}

/** Asks both probes once and returns the rows in report order; `ready` = no row in state `problem`. */
export function getSetupStatus(ports: SetupPorts): Promise<SetupStatus> {
  void ports;
  throw new Error("not implemented");
}
