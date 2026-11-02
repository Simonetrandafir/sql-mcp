import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const writeTest = process.argv.includes("--write");
const executableArgument = process.argv.slice(2).find((argument) => argument !== "--write");
const executable = executableArgument
  ? resolve(executableArgument)
  : fileURLToPath(new URL("../release/sql-mcp.exe", import.meta.url));
const client = new Client({ name: "sql-mcp-connection-test", version: "1.0.0" });
let transport;
let stderr = "";
let secrets = [];

function redact(message) {
  for (const secret of secrets) message = message.split(secret).join("[REDACTED]");
  return message;
}

try {
  await access(executable).catch(() => {
    throw new Error("Executable not found. Run npm run build:exe first.");
  });
  const envFile = await readFile(join(dirname(executable), ".env"), "utf8")
    .catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  secrets = [...new Set(Object.entries({ ...dotenv.parse(envFile), ...process.env })
    .filter(([key, value]) => /PASSWORD|CONNECTION_STRING/i.test(key) && value)
    .map(([, value]) => value))].sort((a, b) => b.length - a.length);

  // The exe loads its own .env. Temporarily select stdio for this child only so
  // the test works even when PORT=3000 is configured or HTTP is already running.
  transport = new StdioClientTransport({
    command: executable,
    cwd: dirname(executable),
    env: { ...process.env, PORT: "" },
    stderr: "pipe",
  });
  transport.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-65536);
  });
  const options = { timeout: 35000, signal: AbortSignal.timeout(45000) };
  await client.connect(transport, options);
  console.log("OK: MCP connected.");

  const { tools } = await client.listTools({}, options);
  assert.ok(tools.some((tool) => tool.name === "execute_query"), "execute_query is missing.");
  console.log(`OK: ${tools.length} tools available.`);

  const result = await client.callTool({
    name: "execute_query",
    arguments: { query: "SELECT 1 AS ok", max_rows: 1 },
  }, undefined, options);
  const text = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  if (result.isError) throw new Error(text || "Database query failed.");
  const data = JSON.parse(text);
  assert.equal(data.rows?.[0]?.ok, 1, "The query did not return the expected value.");
  console.log("OK: SELECT 1 AS ok returned 1. Database connection verified.");

  if (writeTest) {
    assert.notEqual(tools.find((tool) => tool.name === "execute_query").annotations?.readOnlyHint, true,
      "Enable SQL_ACCESS_LEVEL=write to run the temporary-table write test.");
    const provider = client.getServerVersion()?.name;
    assert.ok(provider === "mssql" || provider === "postgres", "Temporary-table test supports mssql and postgres.");
    const table = provider === "mssql" ? "#sql_mcp_write_test" : "sql_mcp_write_test";
    // All changes are confined to a session-local temporary table. PostgreSQL
    // also wraps the batch in a transaction; closing the child rolls back errors.
    const query = [
      ...(provider === "postgres" ? ["BEGIN"] : []),
      `CREATE ${provider === "postgres" ? "TEMP " : ""}TABLE ${table} (id int PRIMARY KEY, value varchar(20))`,
      `INSERT INTO ${table} (id, value) VALUES (1, 'initial'), (2, 'remove')`,
      `UPDATE ${table} SET value = 'updated' WHERE id = 1`,
      `ALTER TABLE ${table} ADD extra int NULL`,
      `DELETE FROM ${table} WHERE id = 2`,
      `SELECT id, value, extra FROM ${table}`,
      `DROP TABLE ${table}`,
      ...(provider === "postgres" ? ["COMMIT"] : []),
    ].join(";\n");
    const writeResult = await client.callTool({ name: "execute_query", arguments: { query } }, undefined, options);
    const writeText = writeResult.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    if (writeResult.isError) throw new Error(writeText || "Temporary-table write test failed.");
    const changed = JSON.parse(writeText);
    assert.deepEqual(changed.rows, [{ id: 1, value: "updated", extra: null }]);
    assert.ok(changed.affected_rows >= 4, "Driver did not report the modified rows.");
    console.log("OK: temporary table CREATE/ALTER/DROP and INSERT/UPDATE/DELETE verified.");
  }
} catch (error) {
  console.error(redact(`FAIL: ${error instanceof Error ? error.message : String(error)}`));
  if (stderr.trim()) console.error(redact(stderr.trim()));
  process.exitCode = 1;
} finally {
  await client.close();
  await transport?.close();
}
