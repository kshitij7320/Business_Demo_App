import { env } from '../config/env.js';

/**
 * In-memory sliding-window rate limiter middleware.
 * Protects local and intranet endpoints from abusive query bursts.
 * @param {object} [options]
 * @param {number} [options.windowMs]
 * @param {number} [options.max]
 * @returns {import('express').RequestHandler}
 */
export function rateLimiter(options = {}) {
  const windowMs = options.windowMs || env.RATE_LIMIT_WINDOW_MS || 60000;
  const maxRequests = options.max || env.RATE_LIMIT_MAX || 120;

  // IP -> Array<timestamp>
  const hitMap = new Map();

  // Periodically purge stale IPs
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of hitMap.entries()) {
      const active = timestamps.filter(t => now - t < windowMs);
      if (active.length === 0) {
        hitMap.delete(ip);
      } else {
        hitMap.set(ip, active);
      }
    }
  }, windowMs);

  // Allow clean process exit without waiting for interval
  if (interval.unref) interval.unref();

  return (req, res, next) => {
    // Skip rate limiting in test suite runs
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const existingHits = hitMap.get(ip) || [];
    const windowHits = existingHits.filter(t => now - t < windowMs);

    if (windowHits.length >= maxRequests) {
      const oldestHit = windowHits[0];
      const resetTimeSec = Math.ceil((oldestHit + windowMs - now) / 1000);

      res.setHeader('Retry-After', resetTimeSec);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);

      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests from this IP. Please try again in ${resetTimeSec} seconds.`,
          statusCode: 429
        }
      });
    }

    windowHits.push(now);
    hitMap.set(ip, windowHits);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - windowHits.length));

    next();
  };
}
