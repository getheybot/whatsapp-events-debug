import { createHash } from 'node:crypto';
import { MessageEventRecord } from './records';

export function recordKey(record: MessageEventRecord): string {
  return createHash('sha256').update(JSON.stringify([
    record.wamid, record.eventName, record.eventAt, record.statusCode,
  ])).digest('hex');
}

