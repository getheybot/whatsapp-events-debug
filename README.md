# Event Log Debugger

Next.js dashboard for WhatsApp events received through Heybot. Message and delivery events are sent through Vercel Queues and stored in `public.whatsapp_events`. The dashboard provides status filters, search, pagination, and syntax-highlighted original webhook payloads.

## Requirements

- Node.js 22+ and npm.
- A Vercel account and a Git repository containing this project.
- A reachable PostgreSQL database and credentials for reads, writes, and migrations.
- A [Heybot](https://heybot.cloud) account configured to send WhatsApp webhook events.

## Deploy on Vercel

### 1. Import the project

Push the project to your Git provider, including `package-lock.json`, `vercel.json`, and the Prisma migration files. In Vercel, create a project and import the repository. Select the directory containing `package.json` as the root directory.

Use these build settings:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Node.js version | 22.x or a newer supported version |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | Leave the Next.js default |

`npm run build` runs `prisma generate` before `next build`. Database migrations are applied separately in step 3.

### 2. Configure environment variables

In your Vercel project's **Settings → Environment Variables**, add the following values for **Production**. Add separate values for **Preview** if you also deploy previews.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL read URL used by the dashboard. |
| `DIRECT_URL` | PostgreSQL write URL used by the queue consumer and Prisma migrations. |
| `HEYBOT_VERIFY_TOKEN` | A secret shared with Heybot to authenticate incoming webhooks. |
| `EMAILS_ALLOWED` | Comma-separated emails allowed to sign in, such as `me@example.com,team@example.com`. |
| `SESSION_SECRET` | A random session secret; generate one with `openssl rand -hex 32`. |
| `DATABASE_POOL_MAX` | Optional pool size per Prisma client; defaults to `2`. A URL's `connection_limit` takes precedence. |

Use database hosts reachable from Vercel. `localhost` and `127.0.0.1` refer to the function itself, not your database. Do not paste surrounding quotes into Vercel's environment-variable values. Never commit credentials or `.env` files.

For Supabase on an IPv4-only connection, copy the **shared transaction pooler** URL for `DATABASE_URL` and the **shared session pooler** URL for `DIRECT_URL` from your project's **Connect** dialog:

```dotenv
DATABASE_URL="postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require"
```

Replace all placeholders with the copied connection details and percent-encode reserved characters in the password. Use the shared pooler host from the Connect dialog; do not substitute a `db.PROJECT_REF.supabase.co` host. See [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres).

Environment changes apply only to new deployments. Redeploy after changing a value, and check the environment and any branch-specific overrides for the deployment you are testing. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

### 3. Prepare the database

Create the PostgreSQL database before applying migrations. From a trusted machine or CI job with the intended database URLs configured, install dependencies and apply the committed migration:

```bash
npm ci
npx prisma migrate deploy
```

The migration at `prisma/migrations/20261017000100_whatsapp_events/migration.sql` creates `public.whatsapp_events` and its indexes. Migrations use `DIRECT_URL`; confirm it targets the intended database before running the command.

If the table already exists, first verify that its columns, indexes, and ID default match `prisma/schema.prisma` and the migration. Only when they match, baseline the migration instead of attempting to create the table again:

```bash
npx prisma migrate resolve --applied 20261017000100_whatsapp_events
npx prisma migrate deploy
```

Baselining records the migration as applied without changing the table. Reconcile any schema differences before baselining. Run migrations once as a deployment step, not on every function invocation.

### 4. Deploy the application and queue consumer

Deploy from Vercel after configuring the environment and database. Alternatively, link the project and create a production deployment using the CLI:

```bash
npx vercel link
npx vercel --prod
```

Keep the committed `vercel.json`. It sets the application region to `iad1` and registers the private consumer:

| Component | Location |
| --- | --- |
| Public webhook receiver | `/webhook/heybot` |
| Queue topic | `heybot-message-events` |
| Private queue consumer | `app/api/queues/heybot-events/route.ts` |

The receiver awaits queue publication before returning success. Vercel invokes the consumer to persist records and retries when it throws. The queue SDK authenticates automatically on Vercel. If you change regions, keep the producer and consumer in the same region. See [Vercel Queues setup](https://vercel.com/docs/queues/quickstart).

### 5. Configure webhooks in Heybot

1. Visit [heybot.cloud](https://heybot.cloud), sign in, and open the **Webhook** section.
2. Set the destination URL for webhook events to your deployed application's public receiver:

   ```text
   https://YOUR_DOMAIN/webhook/heybot
   ```

3. Configure Heybot to send the `x-heybot-signature` header with the same value as your deployed `HEYBOT_VERIFY_TOKEN`.
4. Enable the WhatsApp events you want Heybot to forward and save the configuration.
5. Send a WhatsApp message or trigger a delivery event to verify the integration.

Use your production domain, for example `https://your-project.vercel.app/webhook/heybot`. Heybot sends events to `/webhook/heybot`; the `/api/queues/heybot-events` consumer is private and invoked by Vercel. Ensure the public receiver is accessible to Heybot without an interactive deployment-protection login.

The package recognizes messages, delivery events, template status, template quality, and marketing preferences. Currently, messages and delivery events are persisted; the other categories are available for custom handlers.

### 6. Verify the deployment

Open `https://YOUR_DOMAIN/login`, sign in with an email in `EMAILS_ALLOWED`, and visit `/dashboard`. After sending an event through Heybot, confirm that a record appears with its original payload in the raw event panel.

Inspect Vercel runtime logs for both the webhook receiver and the queue consumer. For message and delivery events, HTTP `200` from the receiver means queue acceptance; persistence completes asynchronously. A GET request returning `200` only confirms that the receiver route responds.

| Response or error | Check |
| --- | --- |
| `503 Server configuration error` | `HEYBOT_VERIFY_TOKEN` is missing from that deployment. |
| `401 Invalid signature` | Heybot's `x-heybot-signature` must exactly match `HEYBOT_VERIFY_TOKEN`. |
| `400 Invalid JSON` or `Invalid webhook payload` | Inspect the payload sent by Heybot. |
| Database connection error | Check `DATABASE_URL` for dashboard reads and `DIRECT_URL` for queue writes. Confirm the hostname, port, environment scope, and new deployment. |
| `[heybot:queue-database]` log | Shows the selected write hostname, port, and deployment ID without credentials. |

For storage mappings and retry behavior, see [Heybot storage](heybot/storage/README.md).

## Local development

Install dependencies and create a local environment file:

```bash
npm ci
cp .env.example .env
```

Set the variables described above in `.env`. Both URLs may point to the same local PostgreSQL database when running locally. Apply migrations, then start Next.js:

```bash
npx prisma migrate deploy
npm run dev
```

Open [localhost:3000/login](http://localhost:3000/login).

To test queue delivery locally, link the Vercel project and pull development credentials before starting the application. Keep the downloaded environment file private:

```bash
npx vercel link
npx vercel env pull
npx vercel dev
```

`next dev` is also supported by the queue SDK when the required local credentials are available. See the [Vercel Queues quickstart](https://vercel.com/docs/queues/quickstart).

## Validation

```bash
npm run test:heybot
npm run test:db
npm run build
```

The storage tests mock queue publication and database writes. They do not confirm connectivity to a deployed database.

## Searching events

Dashboard search matches WAMID or a numeric row ID. Searching nested JSON Request IDs is not implemented. Events are displayed 20 per page, ordered by `event_at` descending.

## Authentication

Email-only login checks an allowlist; it does not verify ownership of the supplied email. Anyone who knows an allowed address can sign in. Use this login only in a trusted environment, or add email verification or SSO before broader use.

## References

- [Deploying to Vercel](https://vercel.com/docs/deployments)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel Queues quickstart](https://vercel.com/docs/queues/quickstart)
- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)

## License


Copyright © 2026 [heybot.cloud].

This project is free software: you may use, modify, and redistribute it
under the terms of the GNU Affero General Public License, version 3 or,
at your option, any later version (AGPL-3.0-or-later).

Commercial use is permitted, provided that you comply with the license.

If you distribute a modified version, you must provide its Corresponding
Source under the terms of the license. If your modified version supports
interaction over a network, you must prominently offer all users interacting
with it remotely free access to the Corresponding Source of that version,
as required by Section 13.

This software is provided WITHOUT ANY WARRANTY, including the implied
warranties of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

See [LICENSE](./LICENSE) for the complete terms.

Official website: [Heybot](https://heybot.cloud).