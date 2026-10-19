export type EventData = Record<string, unknown>;
export type EventKind = 'message' | 'delivery' | 'template-status' | 'template-quality' | 'marketing-preference';

export interface EventContext {
  accountId: string;
  field: string;
  value: EventData;
  /** Complete original webhook envelope, when dispatched by the processor. */
  payload?: EventData;
}

export interface HeybotEvent extends EventContext {
  kind: EventKind;
  data: EventData;
}

export interface EventStrategy {
  readonly kind: EventKind;
  supports(context: EventContext): boolean;
  handle(context: EventContext): HeybotEvent[];
}

export type EventHandler = (event: HeybotEvent) => void | Promise<void>;
export type EventHandlers = Partial<Record<EventKind, EventHandler>>;

export function isRecord(value: unknown): value is EventData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class InvalidWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWebhookError';
  }
}
