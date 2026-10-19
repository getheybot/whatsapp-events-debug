import { PrismaClient } from '@prisma/client';

type CachedClient = { connectionString: string; client: PrismaClient };
const globalDb = globalThis as unknown as {
  heybotNativeReadDb?: CachedClient;
  heybotNativeWriteDb?: CachedClient;
};

function getClient(variable: 'DATABASE_URL' | 'DIRECT_URL', cacheKey: 'heybotNativeReadDb' | 'heybotNativeWriteDb'): PrismaClient {
  const connectionString = process.env[variable];
  if (!connectionString) throw new Error(`${variable} must be configured for database connections`);
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${variable} must be a valid PostgreSQL connection URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error(`${variable} must be a PostgreSQL connection URL with an explicit host`);
  }

  const poolMax = Number(process.env.DATABASE_POOL_MAX || 2);
  if (!Number.isInteger(poolMax) || poolMax < 1) throw new Error('DATABASE_POOL_MAX must be a positive integer');
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', String(poolMax));
  const datasourceUrl = url.toString();

  const cached = globalDb[cacheKey];
  if (cached?.connectionString === datasourceUrl) return cached.client;

  // Prisma 6's native connector receives the URL explicitly for each client.
  // directUrl in schema.prisma is for the CLI; it does not route runtime writes.
  const client = new PrismaClient({ datasourceUrl });
  if (process.env.NODE_ENV !== 'production') globalDb[cacheKey] = { connectionString: datasourceUrl, client };
  return client;
}

// All reads inside a write transaction must stay on the write connection.
export const prismaRead = getClient('DATABASE_URL', 'heybotNativeReadDb');
export const prismaWrite = getClient('DIRECT_URL', 'heybotNativeWriteDb');

/** Safe diagnostics: never include a full URL, database name, or credentials. */
export function getWriteDatabaseTarget() {
  const url = new URL(process.env.DIRECT_URL!);
  return {
    connectionSource: 'DIRECT_URL',
    connector: 'prisma-native-v1',
    host: url.hostname,
    port: url.port || '5432',
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
  };
}
