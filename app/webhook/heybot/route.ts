import { HeybotEventProcessor, InvalidWebhookError } from '@/heybot';
import { toMessageEventRecords } from '@/heybot/storage/records';
import { enqueueMessageEvents } from '@/heybot/storage/queue';

export const runtime = 'nodejs';

const heybot = new HeybotEventProcessor();

export async function GET() {
  return new Response(null, { status: 200 });
}

export async function POST(request: Request) {
  const verify_token = process.env.HEYBOT_VERIFY_TOKEN;
  if (!verify_token) return new Response('Server configuration error', { status: 503 });
  const challenge = request.headers.get('x-heybot-signature');

  if (challenge !== verify_token) {
    return new Response('Invalid signature', { status: 401 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (typeof payload === 'object' && payload !== null &&
      !Array.isArray(payload) && 'type' in payload && payload.type === 'setup') {
    return new Response(verify_token, { status: 200 });
  }

  try {
    const events = await heybot.process(payload);
    const records = toMessageEventRecords(events);
    await enqueueMessageEvents(records);
  } catch (error) {
    if (error instanceof InvalidWebhookError) {
      return new Response('Invalid webhook payload', { status: 400 });
    }
    throw error;
  }

  return new Response(null, { status: 200 });
}
