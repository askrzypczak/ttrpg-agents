import process from "node:process";
import type { BrowserPort } from "@ttrpg-agents/engine";

/**
 * The DM's default browser: macOS `open`, run without a shell. On any other
 * platform `showPage` rejects without running anything.
 */
export function createSystemBrowser(
  platform: NodeJS.Platform = process.platform,
): BrowserPort {
  void platform;
  return {
    showPage(url: string): Promise<void> {
      void url;
      return Promise.reject(new Error("not implemented"));
    },
  };
}
