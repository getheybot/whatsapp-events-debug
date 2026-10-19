const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (file in mocks) return mocks[file];
    if (file.startsWith('node:')) return require(file);
    file = path.resolve(root, file);
    if (!path.extname(file)) file = fs.existsSync(file + '.ts') ? file + '.ts' : path.join(file, 'index.ts');
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', code)(name => {
      if (name in mocks || name.startsWith('node:')) return load(name);
      return load(name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name));
    }, exports);
    return exports;
  }
  return load;
}

(async () => {
  const load = loader();
  const { HeybotEventProcessor, InvalidWebhookError } = load('heybot/index.ts');
  const { toMessageEventRecord: map, toMessageEventRecords: mapAll } = load('heybot/storage/records.ts');
  const proxied = require('../fixtures/proxied-message.json');
  const received = map(new HeybotEventProcessor().parse(proxied)[0]);
  assert.equal(received.eventName, 'received');
  assert.equal(received.category, 'service');
  assert.equal(received.statusCode, 200);
  assert.equal(received.eventAt, new Date(1792392254 * 1000).toISOString());
  assert.deepEqual(received.content, proxied);
  assert.equal(received.content.entry[0].changes[0].value.messages[0].from, '5215512345678');
  assert.equal(received.content.entry[0].changes[0].value.messages[0].from_user_id, 'MX.1111111111111111');
  assert.deepEqual(received.content.entry[0].changes[0].value.contacts, proxied.entry[0].changes[0].value.contacts);
  assert.equal(proxied.entry[0].changes[0].value.messages[0].from, '5215512345678');

  const delivery = (extra = {}) => ({ kind: 'delivery', accountId: 'account', field: 'messages', value: {}, data: {
    id: 'wamid.test', status: 'delivered', timestamp: '1792392254', recipient_user_id: 'MX.1996141787964004', recipient_id: '5217779870543', ...extra,
  } });
  const record = map(delivery({ pricing: { billable: true, category: 'marketing', pricing_model: 'PMP' } }));
  assert.equal(record.eventName, 'delivered');
  assert.equal(record.statusCode, 200);
  assert.equal(record.category, 'marketing');
  assert.deepEqual(record.content.pricing, { billable: true, category: 'marketing', pricing_model: 'PMP' });
  assert.equal(record.content.recipient_user_id, 'MX.1996141787964004');
  assert.equal(record.content.recipient_id, '5217779870543');
  const errors = [{ code: 131047, title: 'Re-engagement required' }];
  const failed = map(delivery({ status: 'failed', errors }));
  assert.equal(failed.statusCode, 131047);
  assert.deepEqual(failed.content.errors, errors);
  assert.equal(failed.category, 'errors');
  assert.equal('pricing' in failed.content, false);
  const emptyRecipient = map(delivery({ recipient_id: undefined, recipient_user_id: undefined }));
  assert.equal('recipient_id' in emptyRecipient.content, false);
  assert.equal('recipient_user_id' in emptyRecipient.content, false);
  for (const status of ['sent', 'delivered', 'read']) assert.equal(map(delivery({ status })).eventName, status);
  for (const extra of [{ timestamp: 'invalid' }, { timestamp: '1.1' }, { timestamp: '9999999999999999999' }, { id: '' }, { status: 'failed' }, { status: 'failed', errors: [{ code: 'bad' }] }]) {
    assert.throws(() => map(delivery(extra)), InvalidWebhookError);
  }
  assert.deepEqual(mapAll([{ ...delivery(), kind: 'template-status' }]), []);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
  const deliveryPayload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'account', changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: 'phone' },
      statuses: [delivery().data, delivery({ id: 'wamid.failed', status: 'failed', errors }).data],
      original_extra: { nested: [null, true, 'unchanged'] },
    } }] }],
  };
  const originalDelivery = JSON.parse(JSON.stringify(deliveryPayload));
  const deliveryRecords = mapAll(new HeybotEventProcessor().parse(deliveryPayload));
  assert.equal(deliveryRecords.length, 2);
  for (const item of deliveryRecords) assert.deepEqual(item.content, originalDelivery);
  assert.deepEqual(deliveryPayload, originalDelivery);


  const sends = [];
  let rejectSend = false;
  let releaseSend;
  const mockDb = { $transaction: async callback => callback(transaction) };
  const inserted = [];
  let lockCount = 0;
  let dbFailure = false;
  const transaction = {
    $queryRaw: async () => { lockCount++; },
    whatsappEvent: {
      findFirst: async ({ where }) => inserted.find(row => row.wamid === where.wamid && row.eventName === where.eventName && +row.eventAt === +where.eventAt && row.code === where.code),
      create: async ({ data }) => { if (dbFailure) throw new Error('DB unavailable'); inserted.push(data); },
    },
  };
  const mockedLoad = loader({
    '@vercel/queue': {
      send: async (...args) => { if (rejectSend) throw new Error('queue unavailable'); sends.push(args); if (releaseSend) await releaseSend; return { messageId: 'test' }; },
      handleCallback: callback => request => callback(request),
    },
    [path.join(root, 'lib/db')]: { prismaWrite: mockDb, getWriteDatabaseTarget: () => ({ connectionSource: 'DIRECT_URL', connector: 'prisma-native-v1', host: 'write.example', port: '5432', deploymentId: 'test' }), prismaRead: new Proxy({}, { get() { throw new Error('Consumer must not use the read connection'); } }) },
  });
  const { enqueueMessageEvents, MESSAGE_EVENTS_TOPIC } = mockedLoad('heybot/storage/queue.ts');
  await enqueueMessageEvents([record, failed]);
  assert.equal(sends[0][0], MESSAGE_EVENTS_TOPIC);
  assert.deepEqual(sends[0][1], record);
  await enqueueMessageEvents([record]);
  assert.equal(sends[0][2].idempotencyKey, sends[2][2].idempotencyKey);
  assert.notEqual(sends[0][2].idempotencyKey, sends[1][2].idempotencyKey);
  rejectSend = true;
  await assert.rejects(() => enqueueMessageEvents([record]), /queue unavailable/);
  rejectSend = false;

  const { persistMessageEvent } = mockedLoad('heybot/storage/persist.ts');
  await persistMessageEvent(record);
  await persistMessageEvent(record);
  await persistMessageEvent(failed);
  assert.equal(inserted.length, 2);
  assert.equal(lockCount, 3);
  assert.equal(inserted[0].code, 200n);
  assert.ok(inserted[0].eventAt instanceof Date);
  assert.deepEqual(inserted[0].content, record.content);
  assert.equal('statusCode' in inserted[0], false);
  assert.equal('billable' in inserted[0], false);
  dbFailure = true;
  await assert.rejects(() => persistMessageEvent({ ...record, wamid: 'new' }), /DB unavailable/);
  dbFailure = false;

  const route = mockedLoad('app/webhook/heybot/route.ts');
  const originalToken = process.env.HEYBOT_VERIFY_TOKEN;
  try {
    const request = (body, signature = 'test-token') => new Request('http://localhost/webhook/heybot', {
      method: 'POST', headers: { 'x-heybot-signature': signature }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    delete process.env.HEYBOT_VERIFY_TOKEN;
    assert.equal((await route.POST(request(proxied))).status, 503);
    process.env.HEYBOT_VERIFY_TOKEN = 'test-token';
    assert.equal((await route.POST(request(proxied, 'wrong'))).status, 401);
    assert.equal((await route.POST(request('{'))).status, 400);
    assert.equal((await route.POST(request({}))).status, 400);
    const before = sends.length;
    assert.equal((await route.POST(request(proxied))).status, 200);
    assert.equal(sends.length, before + 1);
    assert.equal(sends.at(-1)[1].eventName, 'received');
    assert.deepEqual(sends.at(-1)[1].content, proxied);
    const mixed = JSON.parse(JSON.stringify(proxied));
    mixed.entry[0].changes[0].value.statuses = [delivery({ timestamp: 'bad' }).data];
    const beforeInvalid = sends.length;
    assert.equal((await route.POST(request(mixed))).status, 400);
    assert.equal(sends.length, beforeInvalid);
    rejectSend = true;
    await assert.rejects(() => route.POST(request(proxied)), /queue unavailable/);
    rejectSend = false;
    let release;
    releaseSend = new Promise(resolve => { release = resolve; });
    let completed = false;
    const pending = route.POST(request(proxied)).then(response => { completed = true; return response; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    release();
    assert.equal((await pending).status, 200);
    assert.equal((await route.GET()).status, 200);
  } finally {
    if (originalToken === undefined) delete process.env.HEYBOT_VERIFY_TOKEN;
    else process.env.HEYBOT_VERIFY_TOKEN = originalToken;
  }
  const consumer = mockedLoad('app/api/queues/heybot-events/route.ts');
  await consumer.POST(received);
  assert.equal(inserted.at(-1).eventName, 'received');
  assert.deepEqual(inserted.at(-1).content, proxied);
  console.log('Storage tests passed: mappings, original payload preservation, validation, queue retries, deduplication, webhook and consumer integration.');
})().catch(error => { console.error(error); process.exitCode = 1; });
