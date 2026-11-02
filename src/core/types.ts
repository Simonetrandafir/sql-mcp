import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type Row = Record<string, unknown>;
export type QueryInput = { name: string; value: string | number | boolean | null };
export interface SqlResult {
  rows: Row[];
  resultSets: Row[][];
  /** Counts reported by the database driver, one per command when available. */
  rowsAffected: number[];
}
export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

export interface DatabaseProvider {
  /** Short identifier used in logs, e.g. "mssql" or "postgres" */
  id: string;
  /** Human-readable name used in server info responses */
  name: string;
  /** All MCP tool definitions this provider exposes */
  tools: Tool[];
  /** Map of tool name → handler function */
  handlers: Record<string, ToolHandler>;
  /** Provider-specific read-only validation (keyword lists differ by DB) */
  validateReadOnly(query: string): { valid: boolean; error?: string };
  /** Optional: called once at startup (pool warm-up, connection checks) */
  initialize?(): Promise<void>;
  /** Optional: called on graceful shutdown */
  close?(): Promise<void>;
}
