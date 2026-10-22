/** Validate an existing table before adopting it into the migration journal. */
function assertInitialSchema(columns, primaryKey) {
  const expected = {
    id: ['bigint', false],
    wamid: ['character varying', false, 131],
    event_name: ['character varying', false, 36],
    code: ['bigint', false],
    category: ['character varying', true, 16],
    content: ['json', true],
    event_at: ['timestamp without time zone', false],
    created_at: ['timestamp without time zone', true],
    updated_at: ['timestamp without time zone', true],
  };
  const errors = [];
  for (const [name, [type, nullable, length]] of Object.entries(expected)) {
    const column = columns.find(item => item.column_name === name);
    if (!column || column.data_type !== type || (column.is_nullable === 'YES') !== nullable ||
      (length !== undefined && column.character_maximum_length !== length) ||
      (type.startsWith('timestamp') && column.datetime_precision !== 0)) {
      errors.push(name);
    }
  }
  const id = columns.find(item => item.column_name === 'id');
  if (id && !id.column_default && id.is_identity !== 'YES') errors.push('id default');
  if (primaryKey.length !== 1 || primaryKey[0] !== 'id') errors.push('primary key');
  for (const column of columns) {
    if (!(column.column_name in expected) && column.is_nullable === 'NO' && !column.column_default && column.is_identity !== 'YES') {
      errors.push(column.column_name);
    }
  }
  if (errors.length) {
    const error = new Error(`Existing public.whatsapp_events does not match the initial Drizzle schema (${errors.join(', ')}). Reconcile the schema before deploying; no existing table or data was changed.`);
    error.code = 'SCHEMA_MISMATCH';
    throw error;
  }
}

module.exports = { assertInitialSchema };
