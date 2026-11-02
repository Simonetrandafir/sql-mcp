import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sourceExecutable = process.env.SQL_MCP_EXE
  ? resolve(process.env.SQL_MCP_EXE)
  : fileURLToPath(new URL("../release/sql-mcp.exe", import.meta.url));

async function isolatedExecutable(t, configuration = "") {
  const directory = await mkdtemp(join(tmpdir(), "sql-mcp-exe-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, "sql-mcp.exe");
  await copyFile(sourceExecutable, executable);
  await writeFile(join(directory, ".env"), configuration);

  // No Node.js or node_modules beside the executable, and no Node.js on PATH.
  // Also prevent the developer's own database credentials affecting the tests.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(SQL_|PG_|DB_PROVIDER$|PORT$|AUDIT_|NODE_|DOTENV_|PATH$)/i.test(key)
  ));
  env.PATH = "";
  env.PORT = "";
  env.SQL_ACCESS_LEVEL = "read";
  return { directory, executable, env };
}

function providerConfiguration(provider) {
  return provider === "mssql"
    ? "DB_PROVIDER=mssql\nSQL_SERVER=127.0.0.1\nSQL_USER=test\nSQL_PASSWORD=test\n"
    : "DB_PROVIDER=postgres\nPG_HOST=127.0.0.1\nPG_USER=test\nPG_PASSWORD=test\n";
}

async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test("standalone help runs without configuration or Node.js on PATH", async (t) => {
  const { executable, env } = await isolatedExecutable(t);
  const result = spawnSync(executable, ["--help"], { env, cwd: tmpdir(), encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PORT=3000/);
});

test("missing database configuration exits with a useful error", async (t) => {
  const { executable, env } = await isolatedExecutable(t);
  const result = spawnSync(executable, [], { env, cwd: tmpdir(), encoding: "utf8", timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SQL_CONNECTION_STRING/);
});

for (const provider of ["mssql", "postgres"]) {
  test(`${provider}: stdio, tools, database driver, read-only checks, policy and audit`, async (t) => {
    const port = await unusedPort();
    const { directory, executable, env } = await isolatedExecutable(t,
      providerConfiguration(provider) +
      `${provider === "mssql" ? "SQL_PORT" : "PG_PORT"}=${port}\n` +
      "SQL_BLOCKED_TABLES=private.secrets\n"
    );
    const transport = new StdioClientTransport({ command: executable, env, cwd: tmpdir(), stderr: "pipe" });
    const client = new Client({ name: "exe-smoke-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.ok(tools.some((tool) => tool.name === "execute_query"));
      assert.ok(tools.some((tool) => tool.name === "list_tables"));
      assert.equal(tools.some((tool) => tool.name === "list_agent_jobs"), provider === "mssql");

      const readOnly = await client.callTool({ name: "execute_query", arguments: { query: "DELETE FROM example" } });
      assert.equal(readOnly.isError, true);
      assert.match(readOnly.content[0].text, /Only SELECT/);

      // Reach the actual bundled driver without needing a live database. It
      // should fail at the network connection, never at module/asset loading.
      const connection = await client.callTool({ name: "execute_query", arguments: { query: "SELECT 1" } });
      assert.equal(connection.isError, true);
      assert.match(connection.content[0].text, /Failed to connect|ECONNREFUSED/);

      const blocked = await client.callTool({ name: "describe_table", arguments: { schema: "private", table: "secrets" } });
      assert.equal(blocked.isError, true);
      assert.match(blocked.content[0].text, /blocked by policy/);

      const unknown = await client.callTool({ name: "does_not_exist", arguments: {} });
      assert.equal(unknown.isError, true);
      assert.match(unknown.content[0].text, /Unknown tool/);

      const auditFile = join(directory, "logs", `audit-${new Date().toISOString().slice(0, 10)}.log`);
      let records = [];
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          records = (await readFile(auditFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
          if (records.some((record) => record.tool === "describe_table" && record.blocked)) break;
        } catch (error) {
          if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
        await delay(100);
      }
      assert.ok(records.some((record) => record.tool === "describe_table" && record.blocked));
    } finally {
      await client.close();
      await transport.close();
    }
  });
}

for (const provider of ["mssql", "postgres"]) {
  test(`${provider}: write mode advertises and forwards data and schema changes`, async (t) => {
    const port = await unusedPort();
    const { executable, env } = await isolatedExecutable(t,
      providerConfiguration(provider) + `${provider === "mssql" ? "SQL_PORT" : "PG_PORT"}=${port}\n`
    );
    env.SQL_ACCESS_LEVEL = "write";
    const transport = new StdioClientTransport({ command: executable, env, cwd: tmpdir(), stderr: "pipe" });
    const client = new Client({ name: "exe-write-smoke-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "execute_query");
      assert.equal(tool.annotations.readOnlyHint, false);
      assert.equal(tool.annotations.destructiveHint, true);
      for (const query of ["DELETE FROM example", "CREATE TABLE example (id int)", "DROP DATABASE example"]) {
        const result = await client.callTool({ name: "execute_query", arguments: { query } });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /Failed to connect|ECONNREFUSED/);
      }
    } finally {
      await client.close();
      await transport.close();
    }
  });
}

test("HTTP starts using .env beside the executable from a different directory", async (t) => {
  const port = await unusedPort();

  const { executable, env } = await isolatedExecutable(t, providerConfiguration("postgres") + `PORT=${port}\n`);
  delete env.PORT;
  const child = spawn(executable, [], { env, cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  try {
    let info;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, stderr);
      try {
        info = await (await fetch(`http://127.0.0.1:${port}/`)).json();
        break;
      } catch {
        await delay(100);
      }
    }
    assert.equal(info?.name, "postgres", stderr);

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /execute_query/);
  } finally {
    child.kill();
    await exited;
  }
});
