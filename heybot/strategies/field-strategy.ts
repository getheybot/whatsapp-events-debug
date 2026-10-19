import { EventContext, EventKind, EventStrategy, HeybotEvent } from '../types';

export abstract class FieldStrategy implements EventStrategy {
  abstract readonly kind: EventKind;
  abstract readonly field: string;

  supports(context: EventContext): boolean {
    return context.field === this.field;
  }

  handle(context: EventContext): HeybotEvent[] {
    return [{ ...context, kind: this.kind, data: context.value }];
  }
}
