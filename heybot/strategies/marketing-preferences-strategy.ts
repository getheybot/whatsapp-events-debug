import { FieldStrategy } from './field-strategy';

export class MarketingPreferencesStrategy extends FieldStrategy {
  readonly kind = 'marketing-preference';
  readonly field = 'user_preferences';
}
