import { AppError } from '../core/errors.js';

/**
 * Centralized Express error-handling middleware.
 * Formats known AppError instances into structured JSON and hides internals for uncaught errors.
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, req, res, next) {
  const requestId = req.id || req.headers['x-request-id'] || 'unknown';

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        name: err.name,
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        details: err.details,
        requestId
      }
    });
  }

  // Catch unexpected syntax errors (e.g. malformed JSON in request)
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      error: {
        name: 'SyntaxError',
        code: 'MALFORMED_JSON',
        message: 'The request body contained invalid JSON syntax',
        statusCode: 400,
        requestId
      }
    });
  }

  // Unhandled internal server error
  console.error(`[UNHANDLED ERROR] reqId=${requestId}`, err);

  res.status(500).json({
    error: {
      name: 'InternalServerError',
      code: 'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred' : err.message,
      statusCode: 500,
      requestId
    }
  });
}
