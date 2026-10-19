import { CollectionStrategy } from './collection-strategy';

export class MessagesStrategy extends CollectionStrategy {
  readonly kind = 'message';
  readonly collection = 'messages';
}
