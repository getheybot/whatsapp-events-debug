import { EventStrategy } from '../types';
import { MessagesStrategy } from './messages-strategy';
import { DeliveryEventsStrategy } from './delivery-events-strategy';
import { TemplateStatusStrategy } from './template-status-strategy';
import { TemplateQualityStrategy } from './template-quality-strategy';
import { MarketingPreferencesStrategy } from './marketing-preferences-strategy';

export { MessagesStrategy } from './messages-strategy';
export { DeliveryEventsStrategy } from './delivery-events-strategy';
export { TemplateStatusStrategy } from './template-status-strategy';
export { TemplateQualityStrategy } from './template-quality-strategy';
export { MarketingPreferencesStrategy } from './marketing-preferences-strategy';

export function defaultStrategies(): EventStrategy[] {
  return [new MessagesStrategy(), new DeliveryEventsStrategy(), new TemplateStatusStrategy(),
    new TemplateQualityStrategy(), new MarketingPreferencesStrategy()];
}
