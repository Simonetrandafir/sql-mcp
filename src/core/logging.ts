import { appendFileSync, mkdirSync, writeSync } from "node:fs";
import { join } from "node:path";
import { defaultAuditLogPath } from "./environment.js";

// Replaced by esbuild for the portable exe. Source/compiled Node.js runs and
// builds made with --console retain their ordinary stderr diagnostics.
declare const __SQL_MCP_SILENT__: boolean;
const silentExecutable = typeof __SQL_MCP_SILENT__ !== "undefined" && __SQL_MCP_SILENT__;

function writeStderr(message: string): void {
  try {
    // Synchronous output also works for MCP stderr pipes and cannot emit an
    // unhandled stream error when a GUI process has no standard handles.
    writeSync(2, message);
  } catch {
    // No terminal/pipe is available in an Explorer-launched background process.
  }
}

export function logMessage(message: string): void {
  if (silentExecutable) {
    const timestamp = new Date().toISOString();
    const directory = process.env.APP_LOG_PATH ?? defaultAuditLogPath;
    try {
      mkdirSync(directory, { recursive: true });
      appendFileSync(join(directory, `server-${timestamp.slice(0, 10)}.log`),
        `${timestamp} ${message.trimEnd()}\n`, "utf8");
    } catch (error) {
      writeStderr(`[sql-mcp] Application log write failed: ${error instanceof Error ? error.message : String(error)}\n${message}`);
    }
  }
  // Preserve MCP stderr diagnostics for clients launching a stdio child, while
  // the standalone HTTP exe stays silent even if started from a terminal.
  if (!silentExecutable || !process.env.PORT) writeStderr(message);
}
