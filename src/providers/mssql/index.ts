import { logMessage } from "../../core/logging.js";
import { databaseTools, handleDatabaseTool } from "./tools/databases.js";
import { schemaTools, handleSchemaTool } from "./tools/schemas.js";
import { tableTools, handleTableTool } from "./tools/tables.js";
import { viewTools, handleViewTool } from "./tools/views.js";
import { storedProcedureTools, handleStoredProcedureTool } from "./tools/storedProcedures.js";
import { synonymTools, handleSynonymTool } from "./tools/synonyms.js";
import { functionTools, handleFunctionTool } from "./tools/functions.js";
import { triggerTools, handleTriggerTool } from "./tools/triggers.js";
import { constraintTools, handleConstraintTool } from "./tools/constraints.js";
import { extendedPropertyTools, handleExtendedPropertyTool } from "./tools/extendedProperties.js";
import { tableStatsTools, handleTableStatsTool } from "./tools/tableStats.js";
import { sequenceTools, handleSequenceTool } from "./tools/sequences.js";
import { securityTools, handleSecurityTool } from "./tools/security.js";
import { serverPropertyTools, handleServerPropertyTool } from "./tools/serverProperties.js";
import { linkedServerTools, handleLinkedServerTool } from "./tools/linkedServers.js";
import { agentJobTools, handleAgentJobTool } from "./tools/agentJobs.js";
import { partitioningTools, handlePartitioningTool } from "./tools/partitioning.js";
import { fullTextTools, handleFullTextTool } from "./tools/fullText.js";
import { serviceBrokerTools, handleServiceBrokerTool } from "./tools/serviceBroker.js";
import { userTypeTools, handleUserTypeTool } from "./tools/userTypes.js";
import { temporalTableTools, handleTemporalTableTool } from "./tools/temporalTables.js";
import { queryTools, handleQueryTool } from "./tools/query.js";
import { validateReadOnly, closePools } from "./client.js";
import type { DatabaseProvider } from "../../core/types.js";

export const mssqlProvider: DatabaseProvider = {
  id: "mssql",
  name: "SQL Server",

  tools: [
    // Core structure
    ...databaseTools,
    ...schemaTools,
    ...tableTools,
    ...viewTools,
    ...storedProcedureTools,
    ...synonymTools,
    // Programmability
    ...functionTools,
    ...triggerTools,
    ...constraintTools,
    ...extendedPropertyTools,
    ...sequenceTools,
    // Stats & sizing
    ...tableStatsTools,
    // Security
    ...securityTools,
    // Instance / server
    ...serverPropertyTools,
    ...linkedServerTools,
    ...agentJobTools,
    // Advanced features
    ...partitioningTools,
    ...fullTextTools,
    ...serviceBrokerTools,
    ...userTypeTools,
    ...temporalTableTools,
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
    list_stored_procedures: handleStoredProcedureTool,
    get_stored_procedure_definition: handleStoredProcedureTool,
    list_synonyms: handleSynonymTool,
    get_synonym_definition: handleSynonymTool,
    // Programmability
    list_functions: handleFunctionTool,
    get_function_definition: handleFunctionTool,
    list_triggers: handleTriggerTool,
    get_trigger_definition: handleTriggerTool,
    get_table_constraints: handleConstraintTool,
    get_extended_properties: handleExtendedPropertyTool,
    list_sequences: handleSequenceTool,
    // Stats & sizing
    get_table_stats: handleTableStatsTool,
    // Security
    list_database_users: handleSecurityTool,
    list_database_roles: handleSecurityTool,
    get_object_permissions: handleSecurityTool,
    // Instance / server
    get_server_properties: handleServerPropertyTool,
    list_linked_servers: handleLinkedServerTool,
    list_agent_jobs: handleAgentJobTool,
    get_job_history: handleAgentJobTool,
    // Advanced features
    list_partition_functions: handlePartitioningTool,
    list_partition_schemes: handlePartitioningTool,
    list_fulltext_catalogs: handleFullTextTool,
    list_fulltext_indexes: handleFullTextTool,
    list_service_queues: handleServiceBrokerTool,
    list_broker_services: handleServiceBrokerTool,
    list_user_types: handleUserTypeTool,
    get_table_type_columns: handleUserTypeTool,
    list_temporal_tables: handleTemporalTableTool,
    // Ad-hoc query
    execute_query: handleQueryTool,
  },

  validateReadOnly,
  close: closePools,
};

export function checkEnv(): void {
  // Connection string covers everything; individual params are not needed
  if (process.env.SQL_CONNECTION_STRING) return;

  const required = ["SQL_SERVER", "SQL_USER", "SQL_PASSWORD"];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    logMessage(
      `[mssql] ERROR: Provide SQL_CONNECTION_STRING, or set: ${missing.join(", ")}\n` +
        `[mssql] Copy .env.example to .env and fill in the values.\n`
    );
    process.exit(1);
  }
}
