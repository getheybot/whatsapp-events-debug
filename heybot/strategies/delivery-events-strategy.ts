import { CollectionStrategy } from './collection-strategy';

export class DeliveryEventsStrategy extends CollectionStrategy {
  readonly kind = 'delivery';
  readonly collection = 'statuses';
}
