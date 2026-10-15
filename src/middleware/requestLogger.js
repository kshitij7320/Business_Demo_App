import crypto from 'node:crypto';

/**
 * Structured HTTP request logging middleware with request IDs and duration metrics.
 * @returns {import('express').RequestHandler}
 */
export function requestLogger() {
  return (req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.id = requestId;
    res.setHeader('x-request-id', requestId);

    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;

      const logEntry = {
        requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        ip: req.ip || req.socket.remoteAddress
      };

      // In production/test environments, formatted JSON output can be directed to log collectors
      if (process.env.NODE_ENV !== 'test') {
        const color = res.statusCode >= 500 ? '\x1b[31m' : res.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
        console.log(`[HTTP] ${color}${req.method} ${req.originalUrl || req.url} ${res.statusCode}\x1b[0m ${logEntry.durationMs}ms - reqId=${requestId}`);
      }
    });

    next();
  };
}
