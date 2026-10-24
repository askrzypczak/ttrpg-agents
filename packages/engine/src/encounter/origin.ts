import { z } from "zod";

/** Who caused a mutation (`source`) and which command it belongs to (`commandId`). */
export const changeOriginSchema = z.object({
  source: z.enum(["mcp", "table"]),
  commandId: z.string().min(1),
});

export type ChangeOrigin = z.infer<typeof changeOriginSchema>;
