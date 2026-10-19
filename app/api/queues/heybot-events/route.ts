import { handleCallback } from '@vercel/queue';
import { getWriteDatabaseTarget } from '@/lib/db';
import { persistMessageEvent } from '@/heybot/storage/persist';
import { MessageEventRecord } from '@/heybot/storage/records';

export const runtime = 'nodejs';

const handleQueueCallback = handleCallback<MessageEventRecord>(async (record: MessageEventRecord) => {
  // Throw on database failure so the queue retries instead of acknowledging it.
  try {
    await persistMessageEvent(record);
  } catch (error) {
    console.error('[heybot:queue-database]', getWriteDatabaseTarget());
    throw error;
  }
});

export async function POST(request: Request) {
  return handleQueueCallback(request);
}
