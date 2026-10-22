const path = require('node:path');
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { assertInitialSchema } = require('./schema-check.cjs');

async function migrateDatabase({ createPool = options => new Pool(options) } = {}) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be configured for migrations');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('DATABASE_URL must be a PostgreSQL connection URL with an explicit host');
  const pool = createPool({ connectionString, max: 1, connectionTimeoutMillis: 10000 });
  let client;
  let locked = false;
  try {
    client = await pool.connect();
    // Session lock serializes migrations across simultaneous Vercel builds.
    await client.query("SELECT pg_advisory_lock(hashtext('heybot-drizzle-migrate')::bigint)");
    locked = true;
    const { rows: tables } = await client.query("SELECT to_regclass('public.whatsapp_events') AS events, to_regclass('drizzle.__drizzle_migrations') AS journal");
    let hasHistory = false;
    if (tables[0].journal) {
      const { rows } = await client.query('SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1');
      hasHistory = rows.length > 0;
    }
    if (tables[0].events && !hasHistory) {
      const { rows: columns } = await client.query("SELECT column_name, data_type, is_nullable, character_maximum_length, datetime_precision, column_default, is_identity FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_events'");
      const { rows: keys } = await client.query("SELECT k.column_name FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON t.constraint_catalog = k.constraint_catalog AND t.constraint_schema = k.constraint_schema AND t.constraint_name = k.constraint_name WHERE t.table_schema = 'public' AND t.table_name = 'whatsapp_events' AND t.constraint_type = 'PRIMARY KEY' ORDER BY k.ordinal_position");
      assertInitialSchema(columns, keys.map(key => key.column_name));
    }
    await migrate(drizzle(client), { migrationsFolder: path.join(__dirname, '../drizzle') });
    console.log('Drizzle migrations applied. Existing whatsapp_events records are preserved.');
  } finally {
    try {
      if (client && locked) await client.query("SELECT pg_advisory_unlock(hashtext('heybot-drizzle-migrate')::bigint)");
    } finally {
      client?.release();
      await pool.end();
    }
  }
}

if (require.main === module) {
  migrateDatabase().catch(error => {
    // Connection strings and driver errors can contain credentials; keep build logs safe.
    let host;
    try { host = new URL(process.env.DATABASE_URL).hostname; } catch {}
    console.error('Drizzle migration failed.', {
      connectionSource: 'DATABASE_URL', host,
      code: error.code || error.cause?.code || 'unknown',
      reason: error.code === 'SCHEMA_MISMATCH' ? error.message : 'Check database network access, migration permissions, and the existing table schema.',
    });
    process.exitCode = 1;
  });
}
module.exports = { migrateDatabase };
