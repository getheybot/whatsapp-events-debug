import { and, count, desc, eq, ilike, or, SQL } from 'drizzle-orm';
import { db } from './db';
import { whatsappEvents } from './schema';

export function eventFilters(q: string, status: string): SQL | undefined {
  const filters: SQL[] = [];
  if (status !== 'all') filters.push(eq(whatsappEvents.eventName, status));
  if (q) {
    // Preserve literal substring searches; SQL wildcard characters are not patterns.
    const escaped = q.replace(/[\\%_]/g, character => '\\' + character);
    const wamid = ilike(whatsappEvents.wamid, `%${escaped}%`);
    const id = /^\d+$/.test(q) ? BigInt(q) : undefined;
    filters.push(id !== undefined && id <= BigInt('9223372036854775807') ? or(wamid, eq(whatsappEvents.id, id))! : wamid);
  }
  return and(...filters);
}

export async function listEvents(q: string, status: string, page: number, pageSize: number) {
  const where = eventFilters(q, status);
  const [events, totals] = await Promise.all([
    db.select().from(whatsappEvents).where(where)
      .orderBy(desc(whatsappEvents.eventAt), desc(whatsappEvents.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(whatsappEvents).where(where),
  ]);
  return { events, total: totals[0]?.total ?? 0 };
}

export async function findEvent(id: string) {
  if (!/^\d+$/.test(id)) return undefined;
  const value = BigInt(id);
  if (value > BigInt('9223372036854775807')) return undefined;
  const [event] = await db.select().from(whatsappEvents).where(eq(whatsappEvents.id, value)).limit(1);
  return event;
}
