import type { Tokeniser, TokeniserProbe } from "@ttrpg-agents/engine";

/** Loads the sharp module; the default is a dynamic import of "sharp". */
export type SharpLoader = () => Promise<(typeof import("sharp"))["default"]>;

/** The sharp tokeniser, which is also the setup report's tokeniser probe. Creating it loads nothing. */
export function createSharpTokeniser(options?: {
  loadSharp?: SharpLoader;
}): Tokeniser & TokeniserProbe {
  void options;
  return {
    focalPoint: () => Promise.reject(new Error("not implemented")),
    renderToken: () => Promise.reject(new Error("not implemented")),
    check: () => Promise.reject(new Error("not implemented")),
  };
}
