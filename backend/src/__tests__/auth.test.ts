import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../app';
import { createPrismaClient } from '../lib/prisma';

type CookieMap = Record<string, string>;

const parseCookies = (setCookieHeader?: string | string[]): CookieMap => {
  const cookies = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader].filter((value): value is string => typeof value === 'string');
  const result: CookieMap = {};
  for (const cookie of cookies) {
    const [pair] = cookie.split(';');
    const [name, value] = pair.split('=');
    if (name && value) result[name] = value;
  }
  return result;
};

describe('auth and csrf', () => {
  let app: FastifyInstance;
  let prisma: ReturnType<typeof createPrismaClient>;
  let dbFile = '';
  let databaseUrl = '';

  beforeAll(async () => {
    const repoRoot = path.resolve(process.cwd(), '..');
    const dataDir = path.join(repoRoot, 'data');
    await fs.promises.mkdir(dataDir, { recursive: true });
    dbFile = path.join(dataDir, `test-${Date.now()}.db`);
    databaseUrl = `file:${dbFile.replace(/\\/g, '/')}`;

    execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
      cwd: path.resolve(process.cwd()),
      stdio: 'ignore',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    prisma = createPrismaClient(databaseUrl);
    app = buildServer({ prisma, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    if (dbFile && fs.existsSync(dbFile)) {
      await fs.promises.unlink(dbFile);
    }
  });

  it('issues session and csrf cookies on login', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'tester', password: 'Test123!' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'tester', password: 'Test123!' },
    });

    const cookies = parseCookies(response.headers['set-cookie']);
    expect(response.statusCode).toBe(200);
    expect(cookies.sessionId).toBeTruthy();
    expect(cookies.csrfToken).toBeTruthy();
  });

  it('blocks state-changing requests without csrf token', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'tester', password: 'Test123!' },
    });
    const cookies = parseCookies(loginResponse.headers['set-cookie']);
    const cookieHeader = `sessionId=${cookies.sessionId}; csrfToken=${cookies.csrfToken}`;

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/library/check',
      payload: { series_folder_name: 'series', volume_folder_name: 'vol1' },
      headers: { cookie: cookieHeader },
    });

    expect(blocked.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/library/check',
      payload: { series_folder_name: 'series', volume_folder_name: 'vol1' },
      headers: { cookie: cookieHeader, 'x-csrf-token': cookies.csrfToken },
    });

    expect(allowed.statusCode).toBe(200);
  });

  it('locks out after repeated failed attempts', async () => {
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'tester', password: 'WrongPass!' },
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'tester', password: 'WrongPass!' },
    });

    expect(response.statusCode).toBe(429);
  });
});
