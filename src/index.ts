import "./core/environment.js";

import { initAuditPool } from "./core/audit.js";
import { startStdio, startHttp } from "./core/server.js";
import { getAccessLevel } from "./core/access.js";
import { logMessage } from "./core/logging.js";

process.on("uncaughtExceptionMonitor", (error) => {
  logMessage(`[sql-mcp] Uncaught exception: ${error.stack ?? error.message}\n`);
});

const providerName = (process.env.DB_PROVIDER ?? "mssql").toLowerCase();

async function loadProvider() {
  if (providerName === "postgres") {
    const m = await import("./providers/postgres/index.js");
    return { provider: m.postgresProvider, checkEnv: m.checkEnv };
  }
  if (providerName === "mssql") {
    const m = await import("./providers/mssql/index.js");
    return { provider: m.mssqlProvider, checkEnv: m.checkEnv };
  }
  logMessage(
    `[sql-mcp] Unknown provider '${providerName}'. ` +
      `Set DB_PROVIDER to one of: mssql, postgres\n`
  );
  process.exit(1);
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "sql-mcp - SQL Server / PostgreSQL MCP server\n\n" +
      "Configure .env beside sql-mcp.exe (or in the project root for Node.js).\n" +
      "Set PORT=3000 for HTTP at http://localhost:3000/mcp.\n" +
      "Leave PORT unset for MCP stdio. Set DB_PROVIDER=mssql or postgres.\n"
      + "SQL_ACCESS_LEVEL=write (default) allows data and schema changes; read restricts SELECT.\n"
      + "Silent Windows builds log to logs/server-YYYY-MM-DD.log (override APP_LOG_PATH).\n"
    );
    return;
  }

  const { provider, checkEnv } = await loadProvider();
  const accessLevel = getAccessLevel();
  checkEnv();
  logMessage(`[${providerName}] SQL access level: ${accessLevel}\n`);
  const configuredPort = process.env.PORT;
  const port = configuredPort ? Number(configuredPort) : null;
  if (port !== null && (!/^\d+$/.test(configuredPort!) || !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("PORT must be an integer between 1 and 65535, or unset for MCP stdio.");
  }
  await initAuditPool();
  await provider.initialize?.();
  if (port) {
    await startHttp(provider, port);
  } else {
    await startStdio(provider);
  }
}

main().catch((err) => {
  logMessage(`[${providerName}] Fatal: ${err}\n`);
  process.exit(1);
});
