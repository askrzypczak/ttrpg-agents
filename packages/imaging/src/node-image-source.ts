import type { ImageSource } from "@ttrpg-agents/engine";

/** Loads an absolute file path or an https URL, capped at TOKEN_SOURCE_MAX_BYTES. */
export function createNodeImageSource(options?: {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): ImageSource {
  void options;
  return {
    load: () => Promise.reject(new Error("not implemented")),
  };
}
