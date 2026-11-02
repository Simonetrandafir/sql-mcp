import sql from "mssql";
import { createHash } from "crypto";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { defaultAuditLogPath } from "./environment.js";

export interface AuditRecord {
  ts: string;                  // ISO8601 UTC
  tool: string;
  database_name: string | null;
  schema_name: string | null;
  object_name: string | null;
  query_hash: string | null;   // SHA-256 hex of query text
  row_count: number | null;
  affected_rows?: number;      // File sink: driver-reported rows processed
  error?: string;              // File sink: failed execution diagnostic
  masked_cols: string | null;  // JSON array string
  blocked: boolean;
  block_reason: string | null;
  duration_ms: number | null;
}

export function hashQuery(query: string): string {
  return createHash("sha256").update(query).digest("hex");
}

// ── Audit pool ────────────────────────────────────────────────────────────────

let auditPool: sql.ConnectionPool | null = null;

/**
 * Initialises the audit connection pool.
 * Uses AUDIT_CONNECTION_STRING if set, otherwise falls back to the main
 * SQL_* params with AUDIT_DATABASE overriding the database.
 * No-ops silently when neither is configured.
 */
export async function initAuditPool(): Promise<void> {
  const connStr = process.env.AUDIT_CONNECTION_STRING;
  const auditDb = process.env.AUDIT_DATABASE;

  if (!connStr && !auditDb) return;

  try {
    let config: string | sql.config;

    if (connStr) {
      config = connStr;
    } else {
      config = {
        server: process.env.SQL_SERVER!,
        port: parseInt(process.env.SQL_PORT ?? "1433"),
        database: auditDb,
        user: process.env.SQL_USER!,
        password: process.env.SQL_PASSWORD!,
        options: {
          encrypt: process.env.SQL_ENCRYPT !== "false",
          trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE === "true",
        },
        connectionTimeout: 30000,
        requestTimeout: 10000,
      };
    }

    auditPool = await new sql.ConnectionPool(config as sql.config).connect();
    auditPool.on("error", (err: Error) => {
      process.stderr.write(`[sql-mcp] Audit pool error: ${err.message}\n`);
      auditPool = null;
    });
  } catch (err) {
    process.stderr.write(
      `[sql-mcp] Audit pool init failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}

// ── File sink ─────────────────────────────────────────────────────────────────

async function writeToFile(record: AuditRecord): Promise<void> {
  const logDir = process.env.AUDIT_LOG_PATH ?? defaultAuditLogPath;
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const filePath = join(logDir, `audit-${date}.log`);

  await mkdir(logDir, { recursive: true });
  await appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
}

// ── SQL sink ──────────────────────────────────────────────────────────────────

async function writeToSql(record: AuditRecord): Promise<void> {
  if (!auditPool) return;

  const req = auditPool.request();
  req.input("tool", sql.NVarChar(100), record.tool);
  req.input("database_name", sql.NVarChar(128), record.database_name);
  req.input("schema_name", sql.NVarChar(128), record.schema_name);
  req.input("object_name", sql.NVarChar(128), record.object_name);
  req.input("query_hash", sql.Char(64), record.query_hash);
  req.input("row_count", sql.Int, record.row_count);
  req.input("masked_cols", sql.NVarChar(sql.MAX), record.masked_cols);
  req.input("blocked", sql.Bit, record.blocked ? 1 : 0);
  req.input("block_reason", sql.NVarChar(500), record.block_reason);
  req.input("duration_ms", sql.Int, record.duration_ms);

  await req.query(`
    INSERT INTO audit.mcp_audit_log
      (tool, database_name, schema_name, object_name, query_hash,
       row_count, masked_cols, blocked, block_reason, duration_ms)
    VALUES
      (@tool, @database_name, @schema_name, @object_name, @query_hash,
       @row_count, @masked_cols, @blocked, @block_reason, @duration_ms)
  `);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: writes the audit record to both sinks.
 * Errors in either sink are logged to stderr but never thrown.
 */
export function writeAudit(record: AuditRecord): void {
  Promise.all([
    writeToFile(record).catch((err) =>
      process.stderr.write(`[sql-mcp] Audit file write failed: ${err instanceof Error ? err.message : String(err)}\n`)
    ),
    writeToSql(record).catch((err) =>
      process.stderr.write(`[sql-mcp] Audit SQL write failed: ${err instanceof Error ? err.message : String(err)}\n`)
    ),
  ]);
}
