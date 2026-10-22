import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ quiet: true });

export default defineConfig({
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
