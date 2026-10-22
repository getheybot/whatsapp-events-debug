import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

type Database = ReturnType<typeof createDatabase>;
type CachedDatabase = { connectionString: string; poolMax: number; db: Database };
const globalDb = globalThis as unknown as { heybotDrizzleDatabase?: CachedDatabase };

function databaseConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be configured for database connections');
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL with an explicit host');
  }
  const poolMax = Number(url.searchParams.get('connection_limit') ?? process.env.DATABASE_POOL_MAX ?? 2);
  if (!Number.isInteger(poolMax) || poolMax < 1) throw new Error('Database connection limit must be a positive integer');
  return { connectionString, url, poolMax };
}

function createDatabase(connectionString: string, poolMax: number) {
  const pool = new Pool({ connectionString, max: poolMax, connectionTimeoutMillis: 10000 });
  return drizzle(pool, { schema });
}

function getDatabase() {
  const { connectionString, poolMax } = databaseConfig();
  const cached = globalDb.heybotDrizzleDatabase;
  if (cached?.connectionString === connectionString && cached.poolMax === poolMax) return cached.db;
  const db = createDatabase(connectionString, poolMax);
  if (process.env.NODE_ENV !== 'production') globalDb.heybotDrizzleDatabase = { connectionString, poolMax, db };
  return db;
}

export const db = getDatabase();

/** Never include a full URL, database name, or credentials in logs. */
export function getWriteDatabaseTarget() {
  const { url } = databaseConfig();
  return {
    connectionSource: 'DATABASE_URL',
    connector: 'drizzle-node-postgres',
    host: url.hostname,
    port: url.port || '5432',
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'unknown',
  };
}
