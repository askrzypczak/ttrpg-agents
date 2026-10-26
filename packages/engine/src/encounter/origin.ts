import { z } from "zod";

/** Who caused a mutation (`source`) and which command it belongs to (`commandId`). */
export const changeOriginSchema = z.object({
  source: z.enum(["mcp", "table"]),
  commandId: z.string().min(1),
});

/**
 * `command`: the command's name (the MCP tool), set by the MCP server; absent
 * for table changes; not written to the change log.
 */
export type ChangeOrigin = z.infer<typeof changeOriginSchema> & {
  command?: string;
};
