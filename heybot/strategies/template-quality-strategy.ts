import { FieldStrategy } from './field-strategy';

export class TemplateQualityStrategy extends FieldStrategy {
  readonly kind = 'template-quality';
  readonly field = 'message_template_quality_update';
}
