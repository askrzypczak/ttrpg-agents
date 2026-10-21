import { z } from "zod";

/** One page of an Open5e v2 list response. */
export type Open5ePage = { next: string | null; results: { key: string }[] };

export const open5ePageSchema = z.custom<Open5ePage>(() => {
  throw new Error("not implemented");
});
