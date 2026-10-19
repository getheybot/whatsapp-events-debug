# Queued message event storage

`POST /webhook/heybot` validates the signature and payload, runs the strategies,
maps every message/delivery event, and awaits publishing to the
`heybot-message-events` Vercel Queues topic. All records are validated before the
first send. Template and marketing-preference events are processed by the package
but are not stored in the message-event table.

`app/api/queues/heybot-events/route.ts` is the private push consumer configured in
`vercel.json`. It inserts into the existing `whatsapp_events` table using
the `prismaWrite` client connected to `DIRECT_URL`. Dashboard reads use
`prismaRead` connected to `DATABASE_URL`. Dates are ISO strings in queue payloads and become `Date` objects on insert;
status codes become `BigInt`. Database errors propagate to trigger queue retries.

## Mapping

- Delivery: `event_name` is each status item's `status`. `code` is 200,
  except `failed`, which uses `errors[0].code`.
- Delivery category comes from `pricing.category`, defaulting to `errors`.
- Incoming messages: `event_name = received`, `code = 200`, `category = service`.
- `content` is the complete original parsed webhook envelope, including every
  entry, change, contact, message, status, metadata field, pricing object, error,
  and any additional fields. No masking, filtering, or summary wrapper is applied.
  Each row from a batch retains that same original envelope. Direct mapper callers
  without an envelope retain the original event item.
- `event_at` uses the individual event's Unix timestamp in seconds, converted to UTC.
- `created_at` and `updated_at` use the consumer's insert time.

Persistence uses Prisma's `whatsappEvent` model mapped to `whatsapp_events`.
The queue's existing `statusCode` field maps to the SQL `code` column for
compatibility with pending messages. The removed `billable` column is not written;
any original billing information remains in `content`.

## Retries

Each queue send uses a stable SHA-256 idempotency key derived from WAMID, event
name, timestamp, and status code. The consumer additionally takes a PostgreSQL
transaction advisory lock and checks those fields before inserting, so concurrent
or repeated deliveries do not create duplicate records. Distinct statuses remain
separate rows. Other database writers must use the same protocol for this guarantee.

## Setup

1. Run `npm install` to install `@vercel/queue` and refresh `package-lock.json`.
2. Use Node.js 22+ (per Vercel's queue quickstart).
3. Configure `HEYBOT_VERIFY_TOKEN` and the existing database environment variables.
4. Deploy with the committed `vercel.json`; producer and consumer use `iad1`.
5. For local development, link the Vercel project and run `vercel env pull` to obtain
   OIDC credentials, then use `vercel dev` or `next dev`.

A webhook HTTP 200 acknowledges queue acceptance, not completion of persistence.
Queue failures propagate as server errors so the sender can retry. Malformed
webhooks or records return 400 before sending. A batch containing only the other
supported event categories is acknowledged without queuing message records.

Run tests with `npm run test:heybot`. Storage integration tests mock Vercel Queues
and Prisma; they do not publish messages or write to a live database.

References:
- https://vercel.com/docs/queues/quickstart
- https://vercel.com/docs/queues/sdk
