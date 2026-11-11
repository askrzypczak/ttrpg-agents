import { spawn } from "node:child_process";
import process from "node:process";
import type { BrowserPort } from "@ttrpg-agents/engine";

/**
 * The DM's default browser: macOS `open`, run without a shell. On any other
 * platform `showPage` rejects without running anything. Only macOS is
 * supported: the table runs on one machine, the DM's Mac.
 */
export function createSystemBrowser(
  platform: NodeJS.Platform = process.platform,
): BrowserPort {
  return {
    showPage(url: string): Promise<void> {
      if (platform !== "darwin") {
        return Promise.reject(new Error(`no browser opener for ${platform}`));
      }
      return new Promise<void>((resolve, reject) => {
        const child = spawn("open", [url], { stdio: "ignore" });
        child.once("error", (err) => {
          reject(new Error(`open failed: ${err.message}`));
        });
        child.once("close", (code, signal) => {
          if (code === 0) resolve();
          else if (code !== null)
            reject(new Error(`open exited with code ${code}`));
          else
            reject(new Error(`open was stopped by signal ${String(signal)}`));
        });
      });
    },
  };
}
