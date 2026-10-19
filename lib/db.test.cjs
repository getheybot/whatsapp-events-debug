const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { PrismaClient: RealPrismaClient } = require('@prisma/client');

const code = ts.transpileModule(fs.readFileSync(require.resolve('./db.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const clients = [];
class PrismaClient {
  constructor(options) { this.options = options; clients.push(this); }
}
const env = {
  DATABASE_URL: 'postgresql://reader:password@read.example:5433/events',
  DIRECT_URL: 'postgresql://writer:password@write.example:5434/events',
  NODE_ENV: 'development', VERCEL_DEPLOYMENT_ID: 'test-deployment',
};
const context = vm.createContext({
  exports: {}, URL, process: { env },
  require: name => {
    if (name === '@prisma/client') return { PrismaClient };
    throw new Error(`Unexpected import: ${name}`);
  },
});
function evaluate() {
  context.exports = {};
  vm.runInContext(`(function(){${code}\n})()`, context);
  return context.exports;
}

(async () => {
  const first = evaluate();
  assert.equal(first.prismaRead.options.datasourceUrl, env.DATABASE_URL + '?connection_limit=2');
  assert.equal(first.prismaWrite.options.datasourceUrl, env.DIRECT_URL + '?connection_limit=2');
  // Verify the generated Prisma client's actual engine receives each override.
  // No connection or query is made by these constructor-only assertions.
  for (const client of [first.prismaRead, first.prismaWrite]) {
    const real = new RealPrismaClient(client.options);
    try {
      assert.equal(real._engineConfig.overrideDatasources.db.url, client.options.datasourceUrl);
      assert.equal(real._engineConfig.adapter, undefined);
    } finally { await real.$disconnect(); }
  }
  assert.equal(evaluate().prismaWrite, first.prismaWrite);
  assert.equal(clients.length, 2);
  env.DIRECT_URL = 'postgresql://writer:password@new-write.example:5432/events';
  const second = evaluate();
  assert.notEqual(second.prismaWrite, first.prismaWrite);
  assert.equal(second.prismaRead, first.prismaRead);
  const target = second.getWriteDatabaseTarget();
  assert.equal(target.host, 'new-write.example');
  assert.equal(target.port, '5432');
  assert.equal(target.connectionSource, 'DIRECT_URL');
  assert.equal(target.connector, 'prisma-native-v1');
  assert.equal(target.deploymentId, 'test-deployment');
  assert.ok(!JSON.stringify(target).includes('password'));
  assert.ok(!JSON.stringify(target).includes('postgresql://'));
  const valid = env.DIRECT_URL;
  for (const value of ['', 'invalid', 'https://wrong.example/database', 'postgresql:///events']) {
    env.DIRECT_URL = value;
    assert.throws(evaluate, /DIRECT_URL/);
  }
  env.DIRECT_URL = valid;
  console.log('Database tests passed: real Prisma engine URL overrides, cache rotation, validation, and credential-free diagnostics.');
})().catch(error => { console.error(error); process.exitCode = 1; });
