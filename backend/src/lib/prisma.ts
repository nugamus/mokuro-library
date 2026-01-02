import { PrismaClient } from '../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  const adapter = new PrismaBetterSqlite3(
    { url: databaseUrl },
    { timestampFormat: 'iso8601' }
  );

  return new PrismaClient({ adapter });
}

export const prisma = createPrismaClient();
export type ExtendedPrismaClient = PrismaClient;

declare module 'fastify' {
  interface FastifyInstance {
    prisma: ExtendedPrismaClient;  // Direct reference, same file
  }
}
