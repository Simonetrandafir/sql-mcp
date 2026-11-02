import "./core/environment.js";

import { initAuditPool } from "./core/audit.js";
import { startStdio, startHttp } from "./core/server.js";
import { getAccessLevel } from "./core/access.js";

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
  process.stderr.write(
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
    );
    return;
  }

  const { provider, checkEnv } = await loadProvider();
  const accessLevel = getAccessLevel();
  checkEnv();
  process.stderr.write(`[${providerName}] SQL access level: ${accessLevel}\n`);
  await initAuditPool();
  await provider.initialize?.();
  const port = process.env.PORT ? parseInt(process.env.PORT) : null;
  if (port) {
    await startHttp(provider, port);
  } else {
    await startStdio(provider);
  }
}

main().catch((err) => {
  process.stderr.write(`[${providerName}] Fatal: ${err}\n`);
  process.exit(1);
});
