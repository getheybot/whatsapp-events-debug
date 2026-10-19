import { prismaWrite } from '../../lib/db';
import { MessageEventRecord } from './records';
import { recordKey } from './identity';

export async function persistMessageEvent(record: MessageEventRecord): Promise<void> {
  const eventAt = new Date(record.eventAt);
  const code = BigInt(record.statusCode);
  await prismaWrite.$transaction(async transaction => {
    // Serialize duplicate deliveries across consumer instances without a schema change.
    const key = recordKey(record);
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${key})::bigint)`;
    const existing = await transaction.whatsappEvent.findFirst({
      where: { wamid: record.wamid, eventName: record.eventName, eventAt, code },
      select: { id: true },
    });
    if (existing) return;
    const now = new Date();
    await transaction.whatsappEvent.create({
      data: {
        wamid: record.wamid, eventName: record.eventName, code,
        category: record.category, content: record.content, eventAt,
        createdAt: now, updatedAt: now,
      },
    });
  });
}
