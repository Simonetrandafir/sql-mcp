import { logMessage } from "../../core/logging.js";
import pg from "pg";
import "../../core/environment.js";
import { AzureCliCredential } from "@azure/identity";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { auditQuery, processSqlResult } from "../../core/query.js";
import type { QueryInput, Row, SqlResult } from "../../core/types.js";

export type { CallToolResult };
export type { QueryInput } from "../../core/types.js";

// ── Microsoft Entra (Azure AD) token auth ─────────────────────────────────────

// Scope for Azure Database for PostgreSQL Entra tokens. Equivalent to
// `az account get-access-token --resource https://ossrdbms-aad.database.windows.net`.
const AAD_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";
let aadCredential: AzureCliCredential | undefined;

function isAadAuth(): boolean {
  return process.env.PG_AZURE_AD_AUTH === "true";
}

// Returns a password provider that mints a fresh Entra access token per connection.
// node-postgres invokes this callback each time it opens a physical connection, and
// AzureCliCredential caches the token internally (refreshing only near expiry), so the
// token is always valid without any external refresh process or stored secret.
function aadPassword(): () => Promise<string> {
  aadCredential ??= new AzureCliCredential();
  return async () => {
    const token = await aadCredential!.getToken(AAD_SCOPE);
    if (!token?.token) {
      throw new Error(
        "[postgres] Failed to acquire Microsoft Entra access token for PostgreSQL. Ensure `az login` is active."
      );
    }
    return token.token;
  };
}

// ── Connection management ─────────────────────────────────────────────────────

function buildConfig(database?: string): pg.PoolConfig {
  const aad = isAadAuth();

  // Connection-string mode is not used for Entra auth (the token is dynamic).
  if (!aad) {
    const connStr = process.env.PG_CONNECTION_STRING;
    if (connStr) {
      // If a database override is specified, append it to the connection string
      if (database) {
        // Rewrite the /dbname part of the URI
        const url = new URL(connStr);
        url.pathname = `/${database}`;
        return { connectionString: url.toString() };
      }
      return { connectionString: connStr };
    }
  }

  return {
    host: process.env.PG_HOST ?? "localhost",
    port: parseInt(process.env.PG_PORT ?? "5432"),
    database: database ?? process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: aad ? aadPassword() : process.env.PG_PASSWORD,
    // Azure Database for PostgreSQL always requires TLS; force it on in Entra mode.
    ssl: aad || process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 30000,
    statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT ?? "30000"),
  };
}

function getPoolKey(database?: string): string {
  const usingConnStr = !!process.env.PG_CONNECTION_STRING;
  if (!database) {
    return usingConnStr ? "__connstr__" : (process.env.PG_DATABASE ?? "__default__");
  }
  return usingConnStr ? `__connstr__:${database}` : database;
}

// One pool per database key to avoid SET search_path per query
const pools = new Map<string, pg.Pool>();

export async function getPool(database?: string): Promise<pg.Pool> {
  const key = getPoolKey(database);
  if (!pools.has(key)) {
    const pool = new pg.Pool(buildConfig(database));
    pool.on("error", (err: Error) => {
      logMessage(`[postgres] Pool error [${key}]: ${err.message}\n`);
      pools.delete(key);
    });
    // Eagerly test the connection
    const client = await pool.connect();
    client.release();
    pools.set(key, pool);
  }
  return pools.get(key)!;
}

export async function closePools(): Promise<void> {
  for (const pool of pools.values()) {
    await pool.end();
  }
  pools.clear();
}

// ── Query execution ───────────────────────────────────────────────────────────

export async function sqlQuery(
  query: string,
  inputs: QueryInput[] = [],
  database?: string
): Promise<Record<string, unknown>[]> {
  return (await executeSql(query, inputs, database)).rows;
}

export async function executeSql(query: string, inputs: QueryInput[] = [], database?: string): Promise<SqlResult> {
  try {
    const pool = await getPool(database);
    // Unparameterized batches can produce multiple results. DDL has no fields;
    // INSERT/UPDATE/DELETE can return rows through RETURNING.
    const response = await pool.query(query, inputs.map((input) => input.value)) as pg.QueryResult<Row> | pg.QueryResult<Row>[];
    const results = Array.isArray(response) ? response : [response];
    const resultSets = results.filter((result) => result.fields.length > 0).map((result) => result.rows);
    return processSqlResult(query, {
      rows: resultSets[0] ?? [],
      resultSets,
      rowsAffected: results.map((result) => result.rowCount ?? 0),
    }, database);
  } catch (error) {
    auditQuery(query, database, { row_count: null, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

// Safely quote a PostgreSQL identifier using double-quotes
export function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function textResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Validate that a query is read-only (SELECT / CTE only).
export function validateReadOnly(query: string): { valid: boolean; error?: string } {
  const noLineComments = query.replace(/--[^\n]*/g, " ");
  const noComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, " ");
  const trimmed = noComments.trim();

  if (!/^SELECT\b/i.test(trimmed) && !/^WITH\b/i.test(trimmed)) {
    return {
      valid: false,
      error: "Only SELECT (and CTE WITH…SELECT) queries are allowed in read mode.",
    };
  }

  const blocked = [
    "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER",
    "TRUNCATE", "EXECUTE", "MERGE", "GRANT", "REVOKE", "DENY",
    "COPY",    // PostgreSQL bulk load
    "CALL",    // PostgreSQL stored procedure call
  ];

  for (const kw of blocked) {
    if (new RegExp(`\\b${kw}\\b`, "i").test(noComments)) {
      return {
        valid: false,
        error: `Query contains disallowed keyword '${kw}'. Only SELECT queries are allowed in read mode.`,
      };
    }
  }

  return { valid: true };
}
