import { bigint, bigserial, index, json, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

export const whatsappEvents = pgTable('whatsapp_events', {
  id: bigserial('id', { mode: 'bigint' }).notNull(),
  wamid: varchar('wamid', { length: 131 }).notNull(),
  eventName: varchar('event_name', { length: 36 }).notNull(),
  code: bigint('code', { mode: 'bigint' }).notNull(),
  category: varchar('category', { length: 16 }),
  content: json('content').$type<Record<string, unknown>>(),
  eventAt: timestamp('event_at', { precision: 0, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { precision: 0, mode: 'date' }),
  updatedAt: timestamp('updated_at', { precision: 0, mode: 'date' }),
}, table => [
  primaryKey({ name: 'whatsapp_message_events_pkey', columns: [table.id] }),
  index('whatsapp_events_event_at_idx').on(table.eventAt.desc()),
  index('whatsapp_events_events_wamid_idx').on(table.wamid),
  index('whatsapp_events_events_event_name_idx').on(table.eventName),
]);
