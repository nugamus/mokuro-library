import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin'; // Import fastify-plugin
import { AuthUser } from '../types/fastify'; // Import our new type
import { APIAccessStrategyFactory } from '../lib/strategies/APIAccessStrategyFactory';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Define the core authentication logic
const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    // Get the signed sessionId from the cookie
    const token = request.unsignCookie(request.cookies.sessionId || '').value;

    if (!token) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'No session token provided.',
      });
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
    } catch (err) {
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

    // Find user by the ID from JWT
    const user = await request.server.prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        settings: true,
      },
    });

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

    // --- SUCCESS ---
    // Attach the user to the request object
    request.user = user as AuthUser; // We know this matches our AuthUser type
    request.accessStrategy = APIAccessStrategyFactory.getStrategy(
      request.server,
      user.id
    );

    // CSRF protection for state-changing requests
    if (!SAFE_METHODS.has(request.method)) {
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfCookie = request.cookies.csrfToken;
      if (!csrfCookie || csrfHeader !== csrfCookie) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Invalid or missing CSRF token.',
        });
      }
    }
  } catch (error) {
    request.server.log.error(error);
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Authentication process failed.',
    });
  }
};

// Create the plugin
const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Decorate the fastify instance with the authenticate function
  fastify.decorate('authenticate', authenticate);
};

// Export the plugin using 'fastify-plugin'
// This ensures that our decorations (like 'authenticate')
// are available to all routes and plugins.
export default fp(authPlugin);
