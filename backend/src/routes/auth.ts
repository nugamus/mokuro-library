import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { Prisma } from '../generated/prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

// Schemas for request bodies for validation and safty
const registerBodySchema = {
  type: 'object',
  properties: {
    username: { type: 'string', minLength: 3 },
    password: { type: 'string', minLength: 6 },
  },
  required: ['username', 'password'],
};

const loginBodySchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    password: { type: 'string' },
  },
  required: ['username', 'password'],
};

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'change-me-in-production') {
  console.warn('WARNING: Using default JWT_SECRET in production. Set JWT_SECRET environment variable.');
}

const LOCKOUT_MAX_ATTEMPTS = parseInt(process.env.AUTH_LOCKOUT_MAX_ATTEMPTS || '5', 10);
const LOCKOUT_WINDOW_MINUTES = parseInt(process.env.AUTH_LOCKOUT_WINDOW_MINUTES || '15', 10);
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.AUTH_LOCKOUT_DURATION_MINUTES || '15', 10);

type LockoutEntry = {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil?: number;
};

const loginAttempts = new Map<string, LockoutEntry>();

const nowMs = () => Date.now();
const lockoutWindowMs = () => LOCKOUT_WINDOW_MINUTES * 60 * 1000;
const lockoutDurationMs = () => LOCKOUT_DURATION_MINUTES * 60 * 1000;

const getLockoutKey = (username: string) => username.trim().toLowerCase();

const isLockedOut = (entry: LockoutEntry | undefined) => {
  if (!entry?.lockedUntil) return false;
  return entry.lockedUntil > nowMs();
};

const recordFailedAttempt = (key: string) => {
  const current = loginAttempts.get(key);
  const now = nowMs();

  if (!current || now - current.firstAttemptAt > lockoutWindowMs()) {
    loginAttempts.set(key, { attempts: 1, firstAttemptAt: now });
    return loginAttempts.get(key)!;
  }

  current.attempts += 1;
  if (current.attempts >= LOCKOUT_MAX_ATTEMPTS) {
    current.lockedUntil = now + lockoutDurationMs();
  }

  return current;
};

const clearLockout = (key: string) => {
  loginAttempts.delete(key);
};

const setCsrfCookie = (reply: FastifyReply) => {
  const token = randomBytes(32).toString('hex');
  reply.setCookie('csrfToken', token, {
    path: '/',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return token;
};

const authRoutes: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  // Rate limiting for auth routes
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
      },
    },
  };

  // POST /api/auth/register
  fastify.post(
    '/register',
    {
      schema: { body: registerBodySchema },
      ...authRateLimit,
    },
    async (request, reply) => {
      // Type assertion for the validated request body
      const { username, password } = request.body as {
        username: string;
        password: string;
      };

      try {
        // Hash the password before storing
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the user
        const user = await fastify.prisma.user.create({
          data: {
            username: username,
            password: hashedPassword,
            settings: {}, // Default empty settings
          },
        });

        // Send back 201 Created and the new user (excluding password)
        // We select which fields to return.
        return reply.status(201).send({
          id: user.id,
          username: user.username,
        });

      } catch (error: unknown) {
        // Handle potential errors
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' // Unique constraint violation
        ) {
          return reply.status(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Username already exists.',
          });
        }

        // Generic server error
        fastify.log.error(error);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred.',
        });
      }
    }
  );

  // POST /api/auth/login
  fastify.post(
    '/login',
    {
      schema: { body: loginBodySchema },
      ...authRateLimit,
    },
    async (request, reply) => {
      const { username, password } = request.body as {
        username: string;
        password: string;
      };

      try {
        const lockoutKey = getLockoutKey(username);
        const existingLockout = loginAttempts.get(lockoutKey);
        if (isLockedOut(existingLockout)) {
          return reply.status(429).send({
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Account temporarily locked. Please try again later.',
          });
        }

        // Find the user by their unique username
        const user = await fastify.prisma.user.findUnique({
          where: { username },

        });

        // Case 1: User not found
        if (!user) {
          const entry = recordFailedAttempt(lockoutKey);
          if (isLockedOut(entry)) {
            return reply.status(429).send({
              statusCode: 429,
              error: 'Too Many Requests',
              message: 'Account temporarily locked. Please try again later.',
            });
          }
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid username or password.',
          });
        }

        // Case 2: User found, compare password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        // Case 3: Password does not match
        if (!isPasswordValid) {
          const entry = recordFailedAttempt(lockoutKey);
          if (isLockedOut(entry)) {
            return reply.status(429).send({
              statusCode: 429,
              error: 'Too Many Requests',
              message: 'Account temporarily locked. Please try again later.',
            });
          }
          return reply.status(401).send({
            statusCode: 401,
            error: 'Unauthorized',
            message: 'Invalid username or password.',
          });
        }

        // Case 4: Success - Create JWT token
        clearLockout(lockoutKey);
        const token = jwt.sign(
          {
            userId: user.id,
            username: user.username,
          },
          JWT_SECRET,
          { expiresIn: '7d' }
        );

        reply.setCookie('sessionId', token, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 60 * 60 * 24 * 7, // 7 days
          signed: true,
        });
        setCsrfCookie(reply);
        // only send back non-sensitive fields
        const user_response = {
          id: user.id,
          username: user.username,
          settings: user.settings,
        }
        return reply.status(200).send(user_response);

      } catch (error) {
        // Generic server error
        fastify.log.error(error);
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred.',
        });
      }
    }
  );

  // POST /api/auth/logout
  fastify.post('/logout', async (request, reply) => {
    try {
      // Clear the session cookie
      reply.clearCookie('sessionId', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });
      reply.clearCookie('csrfToken', {
        path: '/',
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      return reply.status(200).send({ message: 'Logged out successfully.' });
    } catch (error) {
      // Generic server error
      fastify.log.error(error);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during logout.',
      });
    }
  });

  // GET /api/auth/me ---
  fastify.get('/me', async (request, reply) => {
    try {
      // Get the signed sessionId from the cookie
      const token = request.unsignCookie(request.cookies.sessionId || '').value;

      // Case 1: No session cookie or invalid signature
      if (!token) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'No session token provided.',
        });
      }

      // Case 2: Verify JWT token
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
      } catch (err) {
        // Clear the bad cookie
        reply.clearCookie('sessionId', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
        });
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Invalid or expired session token.',
        });
      }

      // Case 3: Find user by the ID from JWT
      const user = await fastify.prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          settings: true,
        },
      });

      // Case 4: User not found
      if (!user) {
        reply.clearCookie('sessionId', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
        });
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'User not found.',
        });
      }

      if (!request.cookies.csrfToken) {
        setCsrfCookie(reply);
      }

      // Case 5: Success
      return reply.status(200).send(user);

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred.',
      });
    }
  });
};

export default authRoutes;
