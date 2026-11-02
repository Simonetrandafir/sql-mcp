import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getAccessLevel } from "./access.js";
import { hashQuery, writeAudit } from "./audit.js";
import { requestContext } from "./context.js";
import { checkQueryPolicy, filterListingRows, getPolicy, maskRows } from "./policy.js";
import type { QueryInput, Row, SqlResult, ToolHandler } from "./types.js";

type Executor = (query: string, inputs?: QueryInput[], database?: string) => Promise<SqlResult>;
type Validator = (query: string) => { valid: boolean; error?: string };

export function createQueryTool(engine: string, pagination: string): Tool {
  const readOnly = getAccessLevel() === "read";
  return {
    name: "execute_query",
    description: (readOnly
      ? `Execute a read-only SELECT query against ${engine}. Only SELECT and WITH...SELECT are permitted. `
      : `Execute SQL against ${engine}: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE and other SQL commands, including database and table management. `) +
      "Use the database argument to select the connection database; use master (SQL Server) or postgres (PostgreSQL) for database administration. " +
      `Use ${pagination} for large results. Returned rows default to a limit of 1000; this does not limit affected rows.`,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SQL statement or batch to execute" },
        database: { type: "string", description: "Connection database (defaults to configured database)" },
        max_rows: { type: "integer", minimum: 1, description: "Maximum returned rows across all result sets (default: 1000, capped by SQL_MAX_ROWS)" },
      },
      required: ["query"],
    },
  };
}

export function auditQuery(
  query: string,
  database: string | undefined,
  details: { row_count: number | null; affected_rows?: number; masked_cols?: string | null; blocked?: boolean; reason?: string; error?: string }
): void {
  const ctx = requestContext.getStore();
  const args = ctx?.args ?? {};
  writeAudit({
    ts: new Date().toISOString(),
    tool: ctx?.tool ?? "execute_query",
    database_name: typeof args.database === "string" ? args.database : database ?? null,
    schema_name: typeof args.schema === "string" ? args.schema : null,
    object_name: typeof args.name === "string" ? args.name : typeof args.table === "string" ? args.table : null,
    query_hash: hashQuery(query),
    row_count: details.row_count,
    affected_rows: details.affected_rows,
    masked_cols: details.masked_cols ?? null,
    blocked: details.blocked ?? false,
    block_reason: details.reason ?? null,
    error: details.error,
    duration_ms: Date.now() - (ctx?.startMs ?? Date.now()),
  });
}

/** Apply the existing privacy rules to every result set, including RETURNING/OUTPUT. */
export function processSqlResult(query: string, result: SqlResult, database?: string): SqlResult {
  const ctx = requestContext.getStore();
  const args = ctx?.args ?? {};
  const schema = typeof args.schema === "string" ? args.schema : undefined;
  const table = typeof args.table === "string" ? args.table : undefined;
  const maskedColumns = new Set<string>();
  const resultSets = result.resultSets.map((rows) => {
    const masked = maskRows(rows, schema, table);
    masked.maskedColumns.forEach((column) => maskedColumns.add(column));
    return filterListingRows(masked.rows, ctx?.tool ?? "execute_query");
  });
  auditQuery(query, database, {
    row_count: resultSets.reduce((count, rows) => count + rows.length, 0),
    affected_rows: result.rowsAffected.reduce((sum, count) => sum + count, 0),
    masked_cols: maskedColumns.size ? JSON.stringify([...maskedColumns]) : null,
  });
  return { ...result, resultSets, rows: resultSets[0] ?? [] };
}

export function createQueryHandler(execute: Executor, validateReadOnly: Validator): ToolHandler {
  return async (name, args) => {
    const errorResult = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
    if (name !== "execute_query") return errorResult(`Unknown tool: ${name}`);
    try {
      const { query, database, max_rows } = args;
      if (typeof query !== "string" || !query.trim()) return errorResult("query must be a non-empty SQL string.");
      if (database !== undefined && (typeof database !== "string" || !database.trim())) return errorResult("database must be a non-empty string.");
      if (max_rows !== undefined && (typeof max_rows !== "number" || !Number.isInteger(max_rows) || max_rows < 1)) {
        return errorResult("max_rows must be a positive integer.");
      }
      const connectionDatabase = database as string | undefined;
      const validation = getAccessLevel() === "read" ? validateReadOnly(query) : { valid: true };
      const policyCheck = checkQueryPolicy(query);
      const reason = !validation.valid ? validation.error : !policyCheck.allowed ? policyCheck.reason : undefined;
      if (reason) {
        auditQuery(query, connectionDatabase, { row_count: null, blocked: true, reason });
        return errorResult(reason);
      }

      const limit = Math.min((max_rows as number | undefined) ?? 1000, getPolicy().maxRows);
      const result = await execute(query, [], connectionDatabase);
      let remaining = limit;
      const resultSets = result.resultSets.map((rows: Row[]) => {
        const returned = rows.slice(0, remaining);
        remaining -= returned.length;
        return { rows: returned, row_count: returned.length, truncated: returned.length < rows.length };
      });
      const first = resultSets[0] ?? { rows: [], row_count: 0, truncated: false };
      return { content: [{ type: "text", text: JSON.stringify({
        rows: first.rows,
        row_count: first.row_count,
        truncated: resultSets.some((set) => set.truncated),
        affected_rows: result.rowsAffected.reduce((sum, count) => sum + count, 0),
        rows_affected: result.rowsAffected,
        ...(resultSets.length > 1 ? { result_sets: resultSets } : {}),
      }, null, 2) }] };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  };
}
