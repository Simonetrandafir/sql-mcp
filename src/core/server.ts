import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { requestContext } from "./context.js";
import { checkArgPolicy } from "./policy.js";
import { writeAudit } from "./audit.js";
import { logMessage } from "./logging.js";
import type { DatabaseProvider } from "./types.js";

function createServer(provider: DatabaseProvider): Server {
  const server = new Server(
    { name: provider.id, version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: provider.tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const startMs = Date.now();

    const handler = provider.handlers[name];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    // Policy: check schema + table access before invoking the handler
    const typedArgs = args as Record<string, unknown>;
    const schema = typeof typedArgs.schema === "string" ? typedArgs.schema : undefined;
    const table = typeof typedArgs.table === "string" ? typedArgs.table : undefined;

    const policyResult = checkArgPolicy(schema, table);
    if (!policyResult.allowed) {
      writeAudit({
        ts: new Date().toISOString(),
        tool: name,
        database_name: typeof typedArgs.database === "string" ? typedArgs.database : null,
        schema_name: schema ?? null,
        object_name: table ?? null,
        query_hash: null,
        row_count: null,
        masked_cols: null,
        blocked: true,
        block_reason: policyResult.reason,
        duration_ms: Date.now() - startMs,
      });
      return { content: [{ type: "text", text: policyResult.reason }], isError: true };
    }

    // Run handler inside request context so sqlQuery() can read tool metadata
    return requestContext.run(
      { tool: name, args: typedArgs, startMs },
      () => handler(name, typedArgs)
    );
  });

  return server;
}

export async function startStdio(provider: DatabaseProvider): Promise<void> {
  const server = createServer(provider);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logMessage(
    `[${provider.id}] stdio — ${provider.tools.length} tools available\n`
  );
}

export async function startHttp(provider: DatabaseProvider, port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ name: provider.id, version: "1.0.0", tools: provider.tools.length });
  });

  // MCP endpoint — stateless: fresh server per request
  app.all("/mcp", async (req, res) => {
    const server = createServer(provider);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("finish", () => server.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(port);
    listener.once("error", reject);
    listener.once("listening", () => {
      logMessage(`[${provider.id}] HTTP — ${provider.tools.length} tools on http://0.0.0.0:${port}/mcp\n`);
      resolve();
    });
  });
}
