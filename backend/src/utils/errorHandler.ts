/**
 * Error Handling Utilities
 *
 * Centralized error handling for consistent API responses across all routes.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Standard error response structure
 */
export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
}

/**
 * Error with HTTP status code
 */
export interface HttpError extends Error {
  statusCode?: number;
}

/**
 * Handles route errors with consistent logging and response format
 *
 * @param fastify - Fastify instance for logging
 * @param reply - Fastify reply object
 * @param error - The error that occurred
 * @param context - Context description for logging (e.g., 'Error deleting series')
 * @param defaultMessage - Default message if error doesn't have one
 * @returns FastifyReply with appropriate error response
 *
 * @example
 * ```typescript
 * try {
 *   await someDangerousOperation();
 * } catch (error) {
 *   return handleRouteError(
 *     fastify,
 *     reply,
 *     error,
 *     'Error during dangerous operation',
 *     'Failed to complete operation'
 *   );
 * }
 * ```
 */
export function handleRouteError(
  fastify: FastifyInstance,
  reply: FastifyReply,
  error: unknown,
  context: string,
  defaultMessage = 'An unexpected error occurred'
): FastifyReply {
  const httpError = error as HttpError;
  const statusCode = httpError.statusCode ?? 500;
  const message = error instanceof Error ? error.message : defaultMessage;

  // For client errors (4xx), return immediately without logging
  if (statusCode < 500) {
    return reply.status(statusCode).send({ message });
  }

  // For server errors (5xx), log and return structured response
  fastify.log.error({ err: error }, context);
  return reply.status(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message
  });
}

/**
 * Creates an error with an HTTP status code
 *
 * @param message - Error message
 * @param statusCode - HTTP status code (default: 500)
 * @returns Error with statusCode property
 *
 * @example
 * ```typescript
 * throw createHttpError('Series not found', 404);
 * ```
 */
export function createHttpError(message: string, statusCode = 500): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

/**
 * Standard error response builders
 */
export const ErrorResponses = {
  notFound: (message: string): ErrorResponse => ({
    statusCode: 404,
    error: 'Not Found',
    message
  }),

  forbidden: (message: string): ErrorResponse => ({
    statusCode: 403,
    error: 'Forbidden',
    message
  }),

  badRequest: (message: string): ErrorResponse => ({
    statusCode: 400,
    error: 'Bad Request',
    message
  }),

  unauthorized: (message: string): ErrorResponse => ({
    statusCode: 401,
    error: 'Unauthorized',
    message
  }),

  serverError: (message: string): ErrorResponse => ({
    statusCode: 500,
    error: 'Internal Server Error',
    message
  }),

  conflict: (message: string): ErrorResponse => ({
    statusCode: 409,
    error: 'Conflict',
    message
  })
};
