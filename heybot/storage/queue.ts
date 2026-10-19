import { send } from '@vercel/queue';
import { MessageEventRecord } from './records';
import { recordKey } from './identity';

export const MESSAGE_EVENTS_TOPIC = 'heybot-message-events';

export async function enqueueMessageEvents(records: readonly MessageEventRecord[]): Promise<void> {
  // Await every send before acknowledging the webhook. Retries reuse stable keys.
  for (const record of records) {
    await send(MESSAGE_EVENTS_TOPIC, record, { idempotencyKey: recordKey(record) });
  }
}
