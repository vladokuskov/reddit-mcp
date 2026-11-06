#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer(
  { name: "reddit", version: "0.1.0" },
  {
    instructions:
      "Browse public Reddit through the Arctic Shift archive. Typical research flow: search_subreddits to find " +
      "communities, search_posts / search_comments inside them, get_thread to read discussions, activity_over_time " +
      "for trends. Cite permalinks. Keyword search always needs a subreddit or author.",
  },
);
registerTools(server);
await server.connect(new StdioServerTransport());
