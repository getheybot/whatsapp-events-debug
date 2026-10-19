# Heybot WhatsApp events (internal package)

Import from `@/heybot` inside this Next.js application. No runtime dependencies.

`HeybotEventProcessor` selects strategies using Meta's `entry[].changes[].field`.
`messages` changes use separate strategies for `value.messages[]` and
`value.statuses[]` (delivery events). Template status, template quality, and
marketing preferences use `message_template_status_update`,
`message_template_quality_update`, and `user_preferences` respectively.

```ts
import { HeybotEventProcessor } from '@/heybot';

const processor = new HeybotEventProcessor({
  message: async event => { /* store or process event.data */ },
  delivery: async event => { /* process sent/delivered/read/failed */ },
  'template-status': async event => { /* update template status */ },
  'template-quality': async event => { /* update template quality */ },
  'marketing-preference': async event => { /* update marketing preference */ },
});

const events = await processor.process(payload);
```

Each normalized event includes `kind`, `accountId`, `field`, the complete change
`value` (including metadata), `data`, and the original webhook `payload`. Messages and statuses produce one event
per item; other strategies preserve the complete value without assuming optional
fields. All entries and changes are processed. Unknown fields are ignored.
Invalid envelopes or malformed supported collections throw `InvalidWebhookError`
before any callbacks run. Callback failures propagate; subsequent callbacks stop.
Callbacks must handle duplicate webhook deliveries if they write data.

Use `parse(payload)` to normalize without running callbacks. Supply a second
constructor argument to replace or extend the strategy list; `defaultStrategies()`
returns the built-in strategies. A custom strategy implements `EventStrategy`.

`/webhook/heybot` calls `process(payload)` after signature and JSON validation.
Message and delivery events are mapped and published to Vercel Queues, then stored
by a private consumer in the existing message-event table. See
[queued storage](./storage/README.md) for mappings, setup, and retry behavior.
The other three event categories remain available through processor callbacks.

Run package tests: `node heybot/test.cjs`.

Webhook field references:
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_status_update
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/message_template_quality_update
- https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/user_preferences
