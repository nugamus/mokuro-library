import { PrismaClient } from '../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { ulidExtension } from '../plugins/prisma-extensions';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL
}, {
  timestampFormat: 'iso8601'
});

export const prisma = new PrismaClient({ adapter }).$extends(ulidExtension);

// This is the "magic" type that preserves model autocomplete
export type ExtendedPrismaClient = typeof prisma;
