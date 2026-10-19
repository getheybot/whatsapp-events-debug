import { HeybotEvent, InvalidWebhookError, isRecord } from '../types';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** JSON-safe queue representation; dates and BIGINTs are converted by the consumer. */
export interface MessageEventRecord {
  wamid: string;
  eventName: string;
  /** Queue field retained for compatibility; persisted to the SQL code column. */
  statusCode: number;
  category: string | null;
  content: JsonObject;
  eventAt: string;
}

function requiredString(value: unknown, name: string, maxLength?: number): string {
  if (typeof value !== 'string' || !value || (maxLength !== undefined && value.length > maxLength)) {
    throw new InvalidWebhookError(`Invalid ${name}`);
  }
  return value;
}

export function toMessageEventRecord(event: HeybotEvent): MessageEventRecord | null {
  if (event.kind !== 'message' && event.kind !== 'delivery') return null;
  const data = event.data;
  const wamid = requiredString(data.id, 'message ID', 131);
  const timestamp = requiredString(data.timestamp, 'timestamp');
  const seconds = Number(timestamp);
  const date = new Date(seconds * 1000);
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(seconds) || !Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) {
    throw new InvalidWebhookError('Invalid timestamp');
  }
  // Store the original envelope unchanged. Direct strategy callers without an
  // envelope retain the original event item instead of a synthetic summary.
  const content = JSON.parse(JSON.stringify(event.payload ?? data)) as JsonObject;
  const base = { wamid, eventAt: date.toISOString(), content };

  if (event.kind === 'message') {
    return { ...base, eventName: 'received', statusCode: 200, category: 'service' };
  }

  const status = requiredString(data.status, 'delivery status', 36);
  const pricing = data.pricing;
  if (pricing != null && !isRecord(pricing)) throw new InvalidWebhookError('Invalid pricing');
  const category = pricing?.category ?? 'errors';
  requiredString(category, 'pricing category', 16);

  let statusCode = 200;
  if (status === 'failed') {
    if (!Array.isArray(data.errors) || !isRecord(data.errors[0]) || !Number.isSafeInteger(data.errors[0].code)) {
      throw new InvalidWebhookError('Failed delivery must include an integer error code');
    }
    statusCode = data.errors[0].code as number;
  }
  return { ...base, eventName: status, statusCode, category: category as string };
}

/** Map the entire batch before enqueuing so invalid records cause no partial sends. */
export function toMessageEventRecords(events: readonly HeybotEvent[]): MessageEventRecord[] {
  return events.map(toMessageEventRecord).filter((record): record is MessageEventRecord => record !== null);
}
