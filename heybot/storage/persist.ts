import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { whatsappEvents } from '../../lib/schema';
import { MessageEventRecord } from './records';
import { recordKey } from './identity';

export async function persistMessageEvent(record: MessageEventRecord): Promise<void> {
  const eventAt = new Date(record.eventAt);
  const code = BigInt(record.statusCode);
  await db.transaction(async transaction => {
    const key = recordKey(record);
    await transaction.execute(sql`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${key})::bigint)`);
    const [existing] = await transaction.select({ id: whatsappEvents.id }).from(whatsappEvents).where(and(
      eq(whatsappEvents.wamid, record.wamid),
      eq(whatsappEvents.eventName, record.eventName),
      eq(whatsappEvents.eventAt, eventAt),
      eq(whatsappEvents.code, code),
    )).limit(1);
    if (existing) return;
    const now = new Date();
    await transaction.insert(whatsappEvents).values({
      wamid: record.wamid, eventName: record.eventName, code,
      category: record.category, content: record.content, eventAt,
      createdAt: now, updatedAt: now,
    });
  });
}
