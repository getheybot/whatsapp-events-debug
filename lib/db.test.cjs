const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Client, Pool } = require('pg');
const { PgDialect } = require('drizzle-orm/pg-core');

function compile(filename) {
  return ts.transpileModule(fs.readFileSync(require.resolve(filename), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const schema = {};
new Function('require', 'exports', compile('./schema.ts'))(require, schema);
const databases = [];
const env = {
  DATABASE_URL: 'postgresql://app:password@database.example:5433/events',
  NODE_ENV: 'development', VERCEL_DEPLOYMENT_ID: 'test-deployment',
};
const context = vm.createContext({
  exports: {}, URL, process: { env },
  require: name => {
    if (name === 'drizzle-orm/node-postgres') return { drizzle: (...args) => { const db = drizzle(...args); databases.push(db); return db; } };
    if (name === 'pg') return { Pool };
    if (name === './schema') return schema;
    throw new Error(`Unexpected import: ${name}`);
  },
});
function evaluate() {
  context.exports = {};
  vm.runInContext(`(function(){${compile('./db.ts')}\n})()`, context);
  return context.exports;
}
function inspect(db, host, port, max) {
  const parsed = new Client(db.$client.options).connectionParameters;
  assert.equal(parsed.host, host);
  assert.equal(parsed.port, port);
  assert.equal(db.$client.options.max, max);
}

(async () => {
  try {
    const first = evaluate();
    inspect(first.db, 'database.example', 5433, 2);
    assert.equal(evaluate().db, first.db);
    assert.equal(databases.length, 1);
    env.DATABASE_URL = 'postgresql://app:password@new-database.example:5432/events?connection_limit=4';
    env.DATABASE_POOL_MAX = '3';
    const second = evaluate();
    assert.notEqual(second.db, first.db);
    inspect(second.db, 'new-database.example', 5432, 4);
    const target = second.getWriteDatabaseTarget();
    assert.equal(target.host, 'new-database.example');
    assert.equal(target.connectionSource, 'DATABASE_URL');
    assert.equal(target.connector, 'drizzle-node-postgres');
    assert.equal(target.deploymentId, 'test-deployment');
    assert.ok(!JSON.stringify(target).includes('password'));
    assert.ok(!JSON.stringify(target).includes('postgresql://'));
    for (const value of ['', 'invalid', 'https://wrong.example/database', 'postgresql:///events', 'mysql://app:password@mysql.example/db']) {
      env.DATABASE_URL = value;
      assert.throws(evaluate, /DATABASE_URL/);
    }
    env.DATABASE_URL = 'postgresql://app:password@database.example:5432/events';
    env.DATABASE_POOL_MAX = '0';
    assert.throws(evaluate, /connection limit/);

    // Exercise real Drizzle query compilation with no database connection.
    const queries = [];
    const payload = { entry: [{ changes: [{ value: { messages: [{ text: { body: 'original' } }] } }] }] };
    const queryDb = drizzle({ query: async (query, params) => {
      queries.push({ text: query.text, params });
      if (query.text.includes('count(*)')) return { rows: [['41']] };
      return { rows: [['7', 'wamid.test', 'received', '200', 'service', payload, '2026-10-21 12:00:00', null, null]] };
    } });
    const queryExports = {};
    new Function('require', 'exports', compile('./event-queries.ts'))(name => {
      if (name === './db') return { db: queryDb };
      if (name === './schema') return schema;
      return require(name);
    }, queryExports);
    const dialect = new PgDialect();
    const search = dialect.sqlToQuery(queryExports.eventFilters('50%_\\', 'received'));
    assert.match(search.sql, /"event_name" = \$1/);
    assert.equal(search.params[0], 'received');
    assert.equal(search.params[1], '%50\\%\\_\\\\%');
    const numeric = dialect.sqlToQuery(queryExports.eventFilters('123', 'all'));
    assert.match(numeric.sql, / or /);
    assert.equal(numeric.params[1], BigInt(123));
    assert.equal(queryExports.eventFilters('', 'all'), undefined);
    const oversized = dialect.sqlToQuery(queryExports.eventFilters('999999999999999999999999999', 'all'));
    assert.equal(oversized.params.length, 1);
    assert.equal(await queryExports.findEvent('invalid'), undefined);
    assert.equal(await queryExports.findEvent('999999999999999999999999999'), undefined);
    const page = await queryExports.listEvents('test', 'received', 2, 20);
    assert.equal(page.total, 41);
    assert.equal(page.events[0].id, BigInt(7));
    assert.equal(page.events[0].code, BigInt(200));
    assert.equal(page.events[0].eventAt.toISOString(), '2026-10-21T12:00:00.000Z');
    assert.deepEqual(page.events[0].content, payload);
    const listed = queries.find(query => query.text.includes('order by'));
    assert.match(listed.text, /"event_at" desc, "whatsapp_events"."id" desc/);
    assert.equal(listed.params.at(-2), 20);
    assert.equal(listed.params.at(-1), 20);
    assert.equal((await queryExports.findEvent('7')).id, BigInt(7));
    console.log('Database tests passed: Drizzle/pg connection, caching, safe diagnostics, parameterized filters, bigint IDs, and pagination.');
  } finally {
    await Promise.all(databases.map(db => db.$client.end()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
