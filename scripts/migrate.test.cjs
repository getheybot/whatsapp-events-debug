const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readMigrationFiles } = require('drizzle-orm/migrator');
const { assertInitialSchema } = require('./schema-check.cjs');
const { migrateDatabase } = require('./migrate.cjs');

const columns = [
  ['id', 'bigint', 'NO', null], ['wamid', 'character varying', 'NO', 131],
  ['event_name', 'character varying', 'NO', 36], ['code', 'bigint', 'NO', null],
  ['category', 'character varying', 'YES', 16], ['content', 'json', 'YES', null],
  ['event_at', 'timestamp without time zone', 'NO', null],
  ['created_at', 'timestamp without time zone', 'YES', null],
  ['updated_at', 'timestamp without time zone', 'YES', null],
].map(([column_name, data_type, is_nullable, character_maximum_length]) => ({
  column_name, data_type, is_nullable, character_maximum_length,
  datetime_precision: data_type.startsWith('timestamp') ? 0 : null,
  column_default: column_name === 'id' ? "nextval('whatsapp_events_id_seq'::regclass)" : null,
  is_identity: 'NO',
}));

(async () => {
  assert.doesNotThrow(() => assertInitialSchema(columns, ['id']));
  assert.doesNotThrow(() => assertInitialSchema([...columns, { column_name: 'legacy_optional', is_nullable: 'YES' }], ['id']));
  for (const bad of [
    columns.filter(column => column.column_name !== 'code'),
    columns.map(column => column.column_name === 'id' ? { ...column, column_default: null } : column),
    columns.map(column => column.column_name === 'wamid' ? { ...column, character_maximum_length: 10 } : column),
    [...columns, { column_name: 'required_extra', is_nullable: 'NO' }],
  ]) assert.throws(() => assertInitialSchema(bad, ['id']), error => error.code === 'SCHEMA_MISMATCH');
  assert.throws(() => assertInitialSchema(columns, ['wamid']), /primary key/);

  const migrations = readMigrationFiles({ migrationsFolder: path.join(__dirname, '../drizzle') });
  assert.equal(migrations.length, 1);
  assert.equal(migrations[0].sql.length, 4);
  const migrationText = fs.readFileSync(path.join(__dirname, '../drizzle/0000_whatsapp_events.sql'), 'utf8');
  assert.match(migrationText, /CREATE TABLE IF NOT EXISTS/);
  assert.doesNotMatch(migrationText, /\b(DROP|TRUNCATE|DELETE)\b/i);

  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://app:password@database.example:5432/events';
  try {
    // Exercise the real Drizzle migrator against a mocked pg transport.
    for (const existing of [false, true]) {
      const history = [];
      const queries = [];
      let releases = 0;
      let ended = 0;
      let tablesCreated = 0;
      const records = existing ? [{ id: 1, content: { original: true } }] : [];
      const before = JSON.stringify(records);
      const client = {
        release: () => { releases++; },
        query: async (input, parameters) => {
          const text = typeof input === 'string' ? input : input.text;
          queries.push(text);
          if (text.includes('to_regclass')) return { rows: [{ events: existing ? 'whatsapp_events' : null, journal: history.length ? '__drizzle_migrations' : null }] };
          if (text.includes('information_schema.columns')) return { rows: columns };
          if (text.includes('information_schema.table_constraints')) return { rows: [{ column_name: 'id' }] };
          if (text === 'SELECT 1 FROM drizzle.__drizzle_migrations LIMIT 1') return { rows: history.length ? [{ one: 1 }] : [] };
          if (/select id, hash, created_at/i.test(text)) return { rows: history.slice(-1) };
          if (text.startsWith('CREATE TABLE IF NOT EXISTS "public"."whatsapp_events"')) tablesCreated++;
          if (text.startsWith('insert into "drizzle"."__drizzle_migrations"')) history.push({ id: 1, hash: parameters[0], created_at: parameters[1] });
          return { rows: [] };
        },
      };
      const createPool = () => ({ connect: async () => client, end: async () => { ended++; } });
      await migrateDatabase({ createPool });
      await migrateDatabase({ createPool });
      assert.equal(history.length, 1);
      assert.equal(tablesCreated, 1);
      assert.equal(releases, 2);
      assert.equal(ended, 2);
      assert.equal(JSON.stringify(records), before);
      assert.equal(queries.filter(sql => sql.includes('pg_advisory_unlock')).length, 2);
    }
    let ended = false;
    await assert.rejects(() => migrateDatabase({ createPool: () => ({ connect: async () => { throw new Error('connection failed'); }, end: async () => { ended = true; } }) }), /connection failed/);
    assert.equal(ended, true);
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  }
  console.log('Migration tests passed: existing-schema validation, safe initial migration, journal idempotency, locking, and cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
