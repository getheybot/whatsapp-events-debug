import { FieldStrategy } from './field-strategy';

export class TemplateStatusStrategy extends FieldStrategy {
  readonly kind = 'template-status';
  readonly field = 'message_template_status_update';
}
