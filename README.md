# Heybot - WhatsApp Event Debugger

Next.js dashboard for WhatsApp events received through Heybot. Message and delivery events are sent through Vercel Queues and stored in `public.whatsapp_events`. The dashboard provides status filters, search, pagination, and syntax-highlighted original webhook payloads. This application is deployed exclusively on Vercel and requires Vercel Queues.

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

`npm run build` runs `prisma generate`, `prisma migrate deploy`, and then `next build`. The build needs database access and migration permissions; step 3 explains database preparation and baselining.

### 2. Configure environment variables

In your Vercel project's **Settings → Environment Variables**, add the following values for **Production**. Add separate values for **Preview** if you also deploy previews.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL shared by dashboard reads, queue writes, and Prisma migrations. Credentials must allow writes and migrations. |
| `HEYBOT_VERIFY_TOKEN` | A secret shared with Heybot to authenticate incoming webhooks. |
| `EMAILS_ALLOWED` | Comma-separated emails allowed to sign in, such as `me@example.com,team@example.com`. |
| `SESSION_SECRET` | A random session secret; generate one with `openssl rand -hex 32`. |
| `DATABASE_POOL_MAX` | Optional shared client pool size; defaults to `2`. A URL's `connection_limit` takes precedence. |

Use a hosted PostgreSQL database reachable from Vercel. Do not paste surrounding quotes into Vercel's environment-variable values. Never commit credentials or `.env` files.

One `DATABASE_URL` is used for all operations. Choose a session-capable PostgreSQL endpoint that supports both transactions and migrations. The schema and migrations support PostgreSQL, including PostgreSQL databases hosted on Supabase, Neon, and PlanetScale Postgres. PlanetScale MySQL/Vitess is a different database dialect and is not supported by this PostgreSQL schema.

For Supabase on an IPv4-only connection, copy the **shared session pooler** URL from your project's **Connect** dialog:

```dotenv
DATABASE_URL="postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:5432/postgres?sslmode=require"
```

Replace all placeholders with the copied connection details and percent-encode reserved characters in the password. Use the shared pooler host from the Connect dialog; do not substitute a `db.PROJECT_REF.supabase.co` host. A transaction-only pooler is not a universal replacement for a session-capable migration connection. See [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres).

For Neon or PlanetScale Postgres, copy a PostgreSQL connection URL from the provider's console that supports migrations and writes, retaining its SSL parameters. Provider selection does not require a separate environment variable. See [PlanetScale Postgres connections](https://planetscale.com/docs/postgres/connecting).

Environment changes apply only to new deployments. Redeploy after changing a value, and check the environment and any branch-specific overrides for the deployment you are testing. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

### 3. Prepare the database

Create the hosted PostgreSQL database and configure `DATABASE_URL` in Vercel before deploying. The Vercel build runs `prisma migrate deploy` automatically to apply committed migrations.
The migration at `prisma/migrations/20261017000100_whatsapp_events/migration.sql` creates `public.whatsapp_events` and its indexes. Migrations use `DATABASE_URL`; confirm it targets the intended database before running the command.

If the table already exists, first verify that its columns, indexes, and ID default match `prisma/schema.prisma` and the migration. Only when they match, baseline the migration in a one-time CI job configured with the intended `DATABASE_URL` before deploying:

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

### 5. Copy the verification token from Vercel and configure Heybot

1. Open your project in the [Vercel dashboard](https://vercel.com/dashboard) and go to **Settings → Environment Variables**.
2. Find `HEYBOT_VERIFY_TOKEN` for **Production** and copy its configured value when it is readable. This is the shared token you configured, not a Vercel API token. If the variable is missing, create it with a random value, for example generated with `openssl rand -hex 32`. If it was saved as a write-only secret and you no longer have its value, replace it with a new known value. Redeploy whenever you create or change the variable so Production uses that value. See [Vercel environment variables](https://vercel.com/docs/environment-variables).
3. Sign in to Heybot and visit the webhook settings for your account:

   ```text
   https://heybot.cloud/phone/{account}/webhook
   ```

   Replace `{account}` with your Heybot account identifier.

4. Set the webhook URL to your **Vercel production URL** followed by `/webhook/heybot`:

   ```text
   https://YOUR-PROJECT.vercel.app/webhook/heybot
   ```

   If you use a custom production domain, use `https://YOUR_DOMAIN/webhook/heybot` instead.

5. Paste the exact `HEYBOT_VERIFY_TOKEN` value from Vercel into **Firma de seguridad**, without surrounding quotes or extra spaces.
6. Enable the WhatsApp events you want Heybot to forward and **save** the configuration.
7. Send a WhatsApp message or trigger a delivery event to verify the integration.

The **Firma de seguridad** value must match the token used by the production deployment; the receiver compares it against the incoming `x-heybot-signature` header. Heybot sends events to `/webhook/heybot`; the `/api/queues/heybot-events` consumer is private and invoked by Vercel. Ensure the public receiver is accessible to Heybot without an interactive deployment-protection login.

The package recognizes messages, delivery events, template status, template quality, and marketing preferences. Currently, messages and delivery events are persisted; the other categories are available for custom handlers.

### 6. Verify the deployment

Open `https://YOUR_DOMAIN/login`, sign in with an email in `EMAILS_ALLOWED`, and visit `/dashboard`. After sending an event through Heybot, confirm that a record appears with its original payload in the raw event panel.

Inspect Vercel runtime logs for both the webhook receiver and the queue consumer. For message and delivery events, HTTP `200` from the receiver means queue acceptance; persistence completes asynchronously. A GET request returning `200` only confirms that the receiver route responds.

| Response or error | Check |
| --- | --- |
| `503 Server configuration error` | `HEYBOT_VERIFY_TOKEN` is missing from that deployment. |
| `401 Invalid signature` | Heybot's `x-heybot-signature` must exactly match `HEYBOT_VERIFY_TOKEN`. |
| `400 Invalid JSON` or `Invalid webhook payload` | Inspect the payload sent by Heybot. |
| Database connection error | Check `DATABASE_URL`, which is shared by reads, queue writes, and migrations. Confirm the hostname, port, environment scope, and new deployment. |
| `[heybot:queue-database]` log | Shows the selected write hostname, port, and deployment ID without credentials. |

For storage mappings and retry behavior, see [Heybot storage](heybot/storage/README.md).

## CI validation

```bash
npm run test:heybot
npm run test:db
```

The storage tests mock queue publication and database writes. They do not confirm connectivity to a deployed database. Vercel runs `npm run build` during deployment; verify the deployed integration using step 6 above.

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