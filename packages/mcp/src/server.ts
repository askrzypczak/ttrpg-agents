import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./context.js";
import { SERVER_NAME } from "./name.js";
import { tools } from "./tools.js";

/** Transport-agnostic: connect the result to any MCP transport. */
export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: "0.0.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (args: unknown) => tool.handler(ctx, args),
    );
  }
  return server;
}
