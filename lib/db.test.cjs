const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { PrismaClient: RealPrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Client } = require('pg');

const code = ts.transpileModule(fs.readFileSync(require.resolve('./db.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const clients = [];
class PrismaClient {
  constructor(options) { this.options = options; clients.push(this); }
}
// Only DATABASE_URL is configured; reads, writes, and transactions must share it.
const env = {
  DATABASE_URL: 'postgresql://app:password@database.example:5433/events',
  NODE_ENV: 'development', VERCEL_DEPLOYMENT_ID: 'test-deployment',
};
const context = vm.createContext({
  exports: {}, URL, process: { env },
  require: name => {
    if (name === '@prisma/client') return { PrismaClient };
    if (name === '@prisma/adapter-pg') return { PrismaPg };
    throw new Error(`Unexpected import: ${name}`);
  },
});
function evaluate() {
  context.exports = {};
  vm.runInContext(`(function(){${code}\n})()`, context);
  return context.exports;
}
async function inspect(client, expectedHost, expectedPort, expectedMax) {
  const adapter = await client.options.adapter.connect();
  try {
    const pool = adapter.underlyingDriver();
    const parsed = new Client(pool.options).connectionParameters;
    assert.equal(parsed.host, expectedHost);
    assert.equal(parsed.port, expectedPort);
    assert.equal(pool.options.max, expectedMax);
  } finally { await adapter.dispose(); }
}

(async () => {
  const first = evaluate();
  assert.equal(first.prismaRead, first.prismaWrite);
  assert.equal(first.prisma, first.prismaWrite);
  assert.equal(clients.length, 1);
  await inspect(first.prisma, 'database.example', 5433, 2);
  const real = new RealPrismaClient(first.prisma.options);
  await real.$disconnect();
  assert.equal(evaluate().prisma, first.prisma);
  assert.equal(clients.length, 1);
  env.DATABASE_URL = 'postgresql://app:password@new-database.example:5432/events?connection_limit=4';
  env.DATABASE_POOL_MAX = '3';
  const second = evaluate();
  assert.notEqual(second.prisma, first.prisma);
  assert.equal(second.prismaRead, second.prismaWrite);
  await inspect(second.prisma, 'new-database.example', 5432, 4);
  const target = second.getWriteDatabaseTarget();
  assert.equal(target.host, 'new-database.example');
  assert.equal(target.connectionSource, 'DATABASE_URL');
  assert.equal(target.connector, 'prisma-pg-single-url');
  assert.equal(target.deploymentId, 'test-deployment');
  assert.ok(!JSON.stringify(target).includes('password'));
  assert.ok(!JSON.stringify(target).includes('postgresql://'));
  for (const value of ['', 'invalid', 'https://wrong.example/database', 'postgresql:///events', 'mysql://app:password@mysql.example/db']) {
    env.DATABASE_URL = value;
    assert.throws(evaluate, /DATABASE_URL/);
  }
  for (const provider of ['postgresql.example', 'supabase.example', 'neon.example', 'planetscale-postgres.example']) {
    env.DATABASE_URL = `postgresql://app:password@${provider}:5432/events`;
    await inspect(evaluate().prisma, provider, 5432, 3);
  }
  console.log('Database tests passed: one DATABASE_URL, shared client, real Prisma adapter, pooling, cache rotation, and safe diagnostics.');
})().catch(error => { console.error(error); process.exitCode = 1; });
