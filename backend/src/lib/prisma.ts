import { PrismaClient } from '../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL
}, {
  timestampFormat: 'iso8601'
});

export const prisma = new PrismaClient({ adapter });
export type ExtendedPrismaClient = typeof prisma;

declare module 'fastify' {
  interface FastifyInstance {
    prisma: ExtendedPrismaClient;  // Direct reference, same file
  }
}
