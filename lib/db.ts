import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type CachedClient = { connectionString: string; poolMax: number; client: PrismaClient };
const globalDb = globalThis as unknown as { heybotDatabase?: CachedClient };

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

function getClient(): PrismaClient {
  const { connectionString, url, poolMax } = databaseConfig();
  const cached = globalDb.heybotDatabase;
  if (cached?.connectionString === connectionString && cached.poolMax === poolMax) return cached.client;

  // Prisma 7 requires a driver adapter. The same client handles reads and writes.
  const adapter = new PrismaPg({ connectionString, max: poolMax, connectionTimeoutMillis: 10000 }, {
    schema: url.searchParams.get('schema') || undefined,
  });
  const client = new PrismaClient({ adapter });
  if (process.env.NODE_ENV !== 'production') globalDb.heybotDatabase = { connectionString, poolMax, client };
  return client;
}

export const prisma = getClient();
// Preserve existing call sites while sharing one client and one connection pool.
export const prismaRead = prisma;
export const prismaWrite = prisma;

/** Safe diagnostics: never include a full URL, database name, or credentials. */
export function getWriteDatabaseTarget() {
  const { url } = databaseConfig();
  return {
    connectionSource: 'DATABASE_URL',
    connector: 'prisma-pg-single-url',
    host: url.hostname,
    port: url.port || '5432',
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
  };
}
