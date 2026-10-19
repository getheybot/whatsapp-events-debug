const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Compile only this package in memory, without changing application output.
const cache = new Map();
function load(file) {
  file = path.resolve(__dirname, file);
  if (!path.extname(file)) file = fs.existsSync(file + '.ts') ? file + '.ts' : path.join(file, 'index.ts');
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => load(path.resolve(path.dirname(file), name)), exports);
  return exports;
}
const { HeybotEventProcessor, InvalidWebhookError, defaultStrategies } = load('index.ts');
const change = (field, value) => ({ field, value });
const envelope = (...changes) => ({ object: 'whatsapp_business_account', entry: [{ id: 'account', changes }] });

(async () => {
  const proxiedMessage = require('./fixtures/proxied-message.json');
  const received = [];
  const proxyProcessor = new HeybotEventProcessor({ message: event => { received.push(event); } });
  const proxyEvents = await proxyProcessor.process(proxiedMessage);
  assert.equal(proxyEvents.length, 1);
  assert.deepEqual(received, proxyEvents);
  assert.equal(proxyEvents[0].kind, 'message');
  assert.equal(proxyEvents[0].accountId, '2515053132168063');
  assert.deepEqual(proxyEvents[0].data, proxiedMessage.entry[0].changes[0].value.messages[0]);
  assert.equal(proxyEvents[0].data.text.body, 'https://heybot.cloud');
  assert.equal(proxyEvents[0].data.from_user_id, 'MX.1111111111111111');
  assert.deepEqual(proxyEvents[0].value.contacts, proxiedMessage.entry[0].changes[0].value.contacts);
  assert.equal(proxyEvents[0].value.metadata.phone_number_id, '1111');
  const calls = [];
  const handlers = Object.fromEntries(defaultStrategies().map(s => [s.kind, async event => { await Promise.resolve(); calls.push(event); }]));
  const processor = new HeybotEventProcessor(handlers);
  const payload = envelope(
    change('messages', { metadata: { phone_number_id: 'phone' }, messages: [{ id: 'm1' }, { id: 'm2' }], statuses: [{ id: 'm1', status: 'delivered' }] }),
    change('message_template_status_update', { event: 'APPROVED' }),
    change('message_template_quality_update', { new_quality_score: 'GREEN' }),
    change('user_preferences', { user_preferences: [{ value: 'stop' }] }),
    change('future_field', {}),
  );
  payload.entry.push({ id: 'second-account', changes: [change('messages', { statuses: [{ status: 'read' }] })] });
  const events = await processor.process(payload);
  assert.deepEqual(events.map(e => e.kind), ['message', 'message', 'delivery', 'template-status', 'template-quality', 'marketing-preference', 'delivery']);
  assert.deepEqual(calls, events);
  assert.equal(events[0].value.metadata.phone_number_id, 'phone');
  assert.equal(events[6].accountId, 'second-account');
  assert.deepEqual(processor.parse(envelope(change('messages', { messages: [], statuses: [] }))), []);
  for (const bad of [null, {}, { object: 'other', entry: [] }, envelope(change('messages', { messages: {} })), envelope(change('messages', { statuses: [null] })), envelope({ field: 'messages', value: null })]) {
    assert.throws(() => processor.parse(bad), InvalidWebhookError);
  }
  calls.length = 0;
  await assert.rejects(() => processor.process(envelope(change('messages', { messages: [{}] }), change('messages', { statuses: 'bad' }))), InvalidWebhookError);
  assert.equal(calls.length, 0);
  const failure = new Error('storage failed');
  await assert.rejects(() => new HeybotEventProcessor({ message: async () => { throw failure; } }).process(payload), error => error === failure);
  const custom = { kind: 'message', supports: c => c.field === 'custom', handle: c => [{ ...c, kind: 'message', data: c.value }] };
  assert.equal(new HeybotEventProcessor({}, [custom]).parse(envelope(change('custom', {}))).length, 1);
  console.log('Heybot tests passed: five strategies, batches, mixed changes, validation, async handlers, failures, and custom strategies.');
})().catch(error => { console.error(error); process.exitCode = 1; });
