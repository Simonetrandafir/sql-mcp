import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import sql from "mssql";
import pg from "pg";
import { createHash } from "node:crypto";
import { createQueryTool } from "../dist/core/query.js";
import { getAccessLevel } from "../dist/core/access.js";
import { resetPolicy } from "../dist/core/policy.js";
import { requestContext } from "../dist/core/context.js";
import * as mssqlClient from "../dist/providers/mssql/client.js";
import * as postgresClient from "../dist/providers/postgres/client.js";
import { handleQueryTool as mssqlHandler } from "../dist/providers/mssql/tools/query.js";
import { handleQueryTool as postgresHandler } from "../dist/providers/postgres/tools/query.js";

const auditDirectory = await mkdtemp(join(tmpdir(), "sql-mcp-query-test-"));
const calls = [];
const connections = [];
let responses;
let driverError;

// Exercise the actual provider adapters and handlers; replace only the database
// driver I/O so CREATE/DROP tests never touch the configured real database.
mock.method(sql.ConnectionPool.prototype, "connect", async function () {
  connections.push({ provider: "mssql", database: this.config.database });
  return this;
});
mock.method(sql.ConnectionPool.prototype, "close", async () => {});
mock.method(sql.Request.prototype, "query", async function (query) {
  calls.push({ provider: "mssql", query });
  if (driverError) throw driverError;
  return responses.mssql;
});
mock.method(pg.Pool.prototype, "connect", async function () {
  connections.push({ provider: "postgres", database: this.options.database });
  return { release() {} };
});
mock.method(pg.Pool.prototype, "end", async () => {});
mock.method(pg.Pool.prototype, "query", async function (query) {
  calls.push({ provider: "postgres", query });
  if (driverError) throw driverError;
  return responses.postgres;
});

function response(resultSets = [], counts = []) {
  responses = {
    mssql: { recordset: resultSets[0], recordsets: resultSets, rowsAffected: counts },
    postgres: resultSets.length
      ? resultSets.map((rows, index) => ({ command: "UPDATE", rows, rowCount: counts[index] ?? rows.length, fields: [{ name: "id" }] }))
      : { command: "CREATE", rows: [], rowCount: counts[0] ?? null, fields: [] },
  };
  if (Array.isArray(responses.postgres) && responses.postgres.length === 1) responses.postgres = responses.postgres[0];
}

beforeEach(() => {
  calls.length = 0;
  connections.length = 0;
  driverError = undefined;
  for (const key of Object.keys(process.env)) {
    if (/^(SQL_|PG_|AUDIT_)/i.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    SQL_ACCESS_LEVEL: "write", SQL_SERVER: "127.0.0.1", SQL_USER: "test", SQL_PASSWORD: "test",
    PG_HOST: "127.0.0.1", PG_USER: "test", PG_PASSWORD: "test", AUDIT_LOG_PATH: auditDirectory,
  });
  resetPolicy();
  response();
});

afterEach(async () => {
  await mssqlClient.closePools();
  await postgresClient.closePools();
});

after(async () => {
  mock.restoreAll();
  // Audit writes are asynchronous; the audit assertions below also ensure the
  // earlier queued writes have completed before deleting our temporary files.
  await delay(100);
  await rm(auditDirectory, { recursive: true, force: true });
});

async function run(handler, args) {
  return requestContext.run({ tool: "execute_query", args, startMs: Date.now() }, () => handler("execute_query", args));
}

function data(result) {
  assert.notEqual(result.isError, true, result.content[0]?.text);
  return JSON.parse(result.content[0].text);
}

test("write is enabled by default and tools advertise the active mode", () => {
  delete process.env.SQL_ACCESS_LEVEL;
  assert.equal(getAccessLevel(), "write");
  assert.equal(createQueryTool("test", "LIMIT").annotations.destructiveHint, true);
  process.env.SQL_ACCESS_LEVEL = "read";
  assert.equal(createQueryTool("test", "LIMIT").annotations.readOnlyHint, true);
  process.env.SQL_ACCESS_LEVEL = "invalid";
  assert.throws(getAccessLevel, /SQL_ACCESS_LEVEL/);
});

for (const [provider, handler] of [["mssql", mssqlHandler], ["postgres", postgresHandler]]) {
  test(`${provider}: CREATE/ALTER/DROP databases and tables, and TRUNCATE without result rows`, async () => {
    const database = provider === "mssql" ? "master" : "postgres";
    for (const query of [
      "CREATE DATABASE test_db", provider === "mssql" ? "ALTER DATABASE test_db MODIFY NAME=other_db" : "ALTER DATABASE test_db RENAME TO other_db", "DROP DATABASE test_db",
      "CREATE TABLE example (id int)", "ALTER TABLE example ADD name varchar(20)",
      "TRUNCATE TABLE example", "DROP TABLE example",
    ]) {
      const result = data(await run(handler, { query, database }));
      assert.deepEqual(result.rows, []);
      assert.equal(result.row_count, 0);
      assert.equal(result.affected_rows, 0);
      assert.equal(result.truncated, false);
      assert.equal(calls.at(-1).query, query);
    }
    assert.equal(connections[0].database, database);
  });

  test(`${provider}: INSERT/UPDATE/DELETE preserve affected counts without a rowset`, async () => {
    response([], [3]);
    for (const query of ["INSERT INTO example VALUES (1)", "UPDATE example SET id=2", "DELETE FROM example"]) {
      const result = data(await run(handler, { query, max_rows: 1 }));
      assert.deepEqual(result.rows, []);
      assert.equal(result.affected_rows, 3);
      assert.deepEqual(result.rows_affected, [3]);
      assert.equal(result.truncated, false);
    }
  });

  test(`${provider}: OUTPUT/RETURNING and SELECT results retain the original rows response`, async () => {
    response([[{ id: 2 }, { id: 3 }]], [2]);
    const query = provider === "mssql" ? "UPDATE example SET id=2 OUTPUT inserted.id" : "UPDATE example SET id=2 RETURNING id";
    const result = data(await run(handler, { query, max_rows: 1 }));
    assert.deepEqual(result.rows, [{ id: 2 }]);
    assert.equal(result.row_count, 1);
    assert.equal(result.affected_rows, 2);
    assert.equal(result.truncated, true);
  });

  test(`${provider}: batches preserve multiple result sets with a shared row cap`, async () => {
    response([[{ id: 1 }, { id: 2 }], [{ id: 3 }]], [2, 1]);
    process.env.SQL_MAX_ROWS = "2";
    const result = data(await run(handler, { query: "SELECT id FROM example; SELECT id FROM other", max_rows: 100 }));
    assert.equal(result.result_sets.length, 2);
    assert.equal(result.result_sets[0].row_count, 2);
    assert.equal(result.result_sets[1].row_count, 0);
    assert.equal(result.result_sets[1].truncated, true);
    assert.equal(result.affected_rows, 3);
  });

  test(`${provider}: explicit read mode blocks data and schema writes before driver execution`, async () => {
    process.env.SQL_ACCESS_LEVEL = "read";
    for (const query of ["INSERT INTO example VALUES (1)", "UPDATE example SET id=2", "DELETE FROM example", "CREATE DATABASE test_db", "DROP TABLE example", "WITH x AS (SELECT 1 AS id) DELETE FROM example"]) {
      const result = await run(handler, { query });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Only SELECT/);
    }
    assert.equal(calls.length, 0);
    response([[{ ok: 1 }]], [1]);
    assert.deepEqual(data(await run(handler, { query: "SELECT 1 AS ok" })).rows, [{ ok: 1 }]);
  });

  test(`${provider}: table policy still blocks writes and invalid arguments never reach the driver`, async () => {
    process.env.SQL_BLOCKED_TABLES = "private.secrets";
    for (const query of ["DELETE FROM private.secrets", "DROP TABLE private.secrets"]) {
      const result = await run(handler, { query });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /blocked table/);
    }
    for (const args of [{ query: "" }, { query: {} }, { query: "SELECT 1", database: {} }, ...[0, -1, 1.5, "5", NaN].map((max_rows) => ({ query: "SELECT 1", max_rows }))]) {
      assert.equal((await run(handler, args)).isError, true);
    }
    assert.equal(calls.length, 0);
  });

  test(`${provider}: masks each result set, including modification results`, async () => {
    process.env.SQL_MASKED_COLUMNS = "dbo.example.secret";
    response([[{ secret: "a" }], [{ secret: "b" }]], [1, 1]);
    const result = data(await run(handler, { query: "UPDATE dbo.example SET id=1", schema: "dbo", table: "example" }));
    assert.equal(result.rows[0].secret, "[MASKED]");
    assert.equal(result.result_sets[1].rows[0].secret, "[MASKED]");
  });

  test(`${provider}: reports database permission errors and logs failed operations`, async () => {
    driverError = new Error("Permission denied for CREATE DATABASE");
    const query = `CREATE DATABASE audit_failure_${provider}`;
    const result = await run(handler, { query });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Permission denied/);
    const hash = createHash("sha256").update(query).digest("hex");
    const auditFile = join(auditDirectory, `audit-${new Date().toISOString().slice(0, 10)}.log`);
    let records = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        records = (await readFile(auditFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
        if (records.some((record) => record.query_hash === hash)) break;
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      await delay(50);
    }
    assert.ok(records.some((record) => record.query_hash === hash && record.error === driverError.message));
    assert.ok(records.some((record) => record.affected_rows === 3));
    assert.ok(records.some((record) => record.blocked));
  });
}
