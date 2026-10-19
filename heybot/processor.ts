import { defaultStrategies } from './strategies';
import { EventContext, EventHandlers, EventStrategy, HeybotEvent, InvalidWebhookError, isRecord } from './types';

export class HeybotEventProcessor {
  constructor(
    private readonly handlers: EventHandlers = {},
    private readonly strategies: readonly EventStrategy[] = defaultStrategies(),
  ) {}

  parse(payload: unknown): HeybotEvent[] {
    if (!isRecord(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
      throw new InvalidWebhookError('Expected a WhatsApp Business Account webhook');
    }
    const events: HeybotEvent[] = [];
    for (const entry of payload.entry) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !Array.isArray(entry.changes)) {
        throw new InvalidWebhookError('Invalid webhook entry');
      }
      for (const change of entry.changes) {
        if (!isRecord(change) || typeof change.field !== 'string' || !isRecord(change.value)) {
          throw new InvalidWebhookError('Invalid webhook change');
        }
        const context: EventContext = { accountId: entry.id, field: change.field, value: change.value, payload };
        // Both messages and delivery statuses can occur in the same change.
        for (const strategy of this.strategies) {
          if (strategy.supports(context)) events.push(...strategy.handle(context));
        }
      }
    }
    return events;
  }

  async process(payload: unknown): Promise<HeybotEvent[]> {
    // Validate the entire batch before running callbacks with side effects.
    const events = this.parse(payload);
    for (const event of events) await this.handlers[event.kind]?.(event);
    return events;
  }
}
