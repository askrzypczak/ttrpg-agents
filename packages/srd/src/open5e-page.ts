import { z } from "zod";

/** One page of an Open5e v2 list response. */
export type Open5ePage = { next: string | null; results: { key: string }[] };

/** Checks only what the import reads; extra creature fields are kept (loose). */
export const open5ePageSchema: z.ZodType<Open5ePage> = z.object({
  next: z.string().nullable(),
  results: z.array(z.object({ key: z.string() }).loose()),
});
