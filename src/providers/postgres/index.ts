import { logMessage } from "../../core/logging.js";
import { databaseTools, handleDatabaseTool } from "./tools/databases.js";
import { schemaTools, handleSchemaTool } from "./tools/schemas.js";
import { tableTools, handleTableTool } from "./tools/tables.js";
import { viewTools, handleViewTool } from "./tools/views.js";
import { functionTools, handleFunctionTool } from "./tools/functions.js";
import { triggerTools, handleTriggerTool } from "./tools/triggers.js";
import { sequenceTools, handleSequenceTool } from "./tools/sequences.js";
import { tableStatsTools, handleTableStatsTool } from "./tools/tableStats.js";
import { serverPropertyTools, handleServerPropertyTool } from "./tools/serverProperties.js";
import { queryTools, handleQueryTool } from "./tools/query.js";
import { validateReadOnly, closePools } from "./client.js";
import type { DatabaseProvider } from "../../core/types.js";

export const postgresProvider: DatabaseProvider = {
  id: "postgres",
  name: "PostgreSQL",

  tools: [
    // Core structure
    ...databaseTools,
    ...schemaTools,
    ...tableTools,
    ...viewTools,
    // Programmability
    ...functionTools,
    ...triggerTools,
    ...sequenceTools,
    // Stats & sizing
    ...tableStatsTools,
    // Instance / server
    ...serverPropertyTools,
    // Ad-hoc query
    ...queryTools,
  ],

  handlers: {
    // Core structure
    list_databases: handleDatabaseTool,
    list_schemas: handleSchemaTool,
    list_tables: handleTableTool,
    describe_table: handleTableTool,
    get_table_indexes: handleTableTool,
    get_foreign_keys: handleTableTool,
    list_views: handleViewTool,
    describe_view: handleViewTool,
    // Programmability
    list_functions: handleFunctionTool,
    get_function_definition: handleFunctionTool,
    list_triggers: handleTriggerTool,
    get_trigger_definition: handleTriggerTool,
    list_sequences: handleSequenceTool,
    // Stats & sizing
    get_table_stats: handleTableStatsTool,
    // Instance / server
    get_server_properties: handleServerPropertyTool,
    // Ad-hoc query
    execute_query: handleQueryTool,
  },

  validateReadOnly,
  close: closePools,
};

export function checkEnv(): void {
  // Microsoft Entra (Azure AD) auth: the token is fetched dynamically via the Azure
  // CLI credential, so no PG_PASSWORD / PG_CONNECTION_STRING is needed — only the
  // host, database, and the Entra principal (PG_USER).
  if (process.env.PG_AZURE_AD_AUTH === "true") {
    const required = ["PG_HOST", "PG_USER"];
    const missing = required.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      logMessage(
        `[postgres] ERROR: PG_AZURE_AD_AUTH=true requires: ${missing.join(", ")}\n` +
          `[postgres] The access token is acquired via 'az login' (no PG_PASSWORD needed).\n`
      );
      process.exit(1);
    }
    return;
  }

  if (process.env.PG_CONNECTION_STRING) return;

  const required = ["PG_HOST", "PG_USER", "PG_PASSWORD"];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logMessage(
      `[postgres] ERROR: Provide PG_CONNECTION_STRING, or set: ${missing.join(", ")}\n` +
        `[postgres] Copy .env.example to .env and fill in the values.\n`
    );
    process.exit(1);
  }
}
