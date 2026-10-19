import { EventContext, EventKind, EventStrategy, HeybotEvent, InvalidWebhookError, isRecord } from '../types';

export abstract class CollectionStrategy implements EventStrategy {
  abstract readonly kind: EventKind;
  abstract readonly collection: string;

  supports(context: EventContext): boolean {
    return context.field === 'messages' && this.collection in context.value;
  }

  handle(context: EventContext): HeybotEvent[] {
    const items = context.value[this.collection];
    if (!Array.isArray(items) || !items.every(isRecord)) {
      throw new InvalidWebhookError(`${this.collection} must be an array of objects`);
    }
    return items.map(data => ({ ...context, kind: this.kind, data }));
  }
}
