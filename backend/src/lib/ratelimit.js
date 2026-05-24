// Challenge 12 — Rate Limiting (reusable middleware).
// Sliding-window log using a Valkey Sorted Set (ZADD/ZREMRANGEBYSCORE/ZCARD):
// precise limits with no fixed-window burst edges.
//
// Usage in any router:
//   const { rateLimit } = require('../lib/ratelimit');
//   router.get('/search', rateLimit('/api/search'), handler);
//
// Identity: authenticated users (X-User-Id header) get higher limits than anonymous
// (identified by IP). Returns X-RateLimit-* headers and 429 + Retry-After when exceeded.
const client = require('../valkey');

// Per-endpoint limits (from HACKATHON.md > Challenge 12). `window` is in seconds.
const CONFIG = {
  '/api/search': { anonymous: 20, authenticated: 60, window: 60 },
  '/api/checkout/start': { anonymous: 0, authenticated: 5, window: 60 },
  '/api/auth/login': { anonymous: 5, authenticated: 5, window: 900 },
  '/api/products': { anonymous: 30, authenticated: 100, window: 60 },
  '/api/cart': { anonymous: 10, authenticated: 30, window: 60 },
  // Tight limit used by the demo endpoint + tests.
  '/api/ratelimit/test': { anonymous: 3, authenticated: 6, window: 60 },
  default: { anonymous: 60, authenticated: 120, window: 60 },
};

function getConfig(name) {
  return CONFIG[name] || CONFIG.default;
}

function identify(req) {
  const userId = req.header('x-user-id');
  if (userId) return { id: userId, authenticated: true };
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return { id: `ip:${ip}`, authenticated: false };
}

function rateLimit(name) {
  const cfg = getConfig(name);
  const windowMs = cfg.window * 1000;

  return async function rateLimitMiddleware(req, res, next) {
    try {
      const who = identify(req);
      const limit = who.authenticated ? cfg.authenticated : cfg.anonymous;
      const now = Date.now();
      const resetSec = Math.ceil((now + windowMs) / 1000);

      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Reset', String(resetSec));

      // Anonymous limit of 0 means the endpoint is closed to guests.
      if (limit <= 0) {
        res.set('X-RateLimit-Remaining', '0');
        res.set('Retry-After', String(cfg.window));
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: 'This endpoint requires authentication.',
          details: { limit, window: cfg.window },
        });
      }

      const key = `ratelimit:sliding:${who.id}:${name}`;

      // Drop entries outside the window, then count what remains.
      const tx = await client
        .multi()
        .zremrangebyscore(key, 0, now - windowMs)
        .zcard(key)
        .exec();
      const count = tx[1][1];

      if (count >= limit) {
        res.set('X-RateLimit-Remaining', '0');
        res.set('Retry-After', String(cfg.window));
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: `Too many requests. Try again in ${cfg.window} seconds.`,
          details: { limit, window: cfg.window },
        });
      }

      // Record this request and keep the key alive for one window.
      await client
        .multi()
        .zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`)
        .expire(key, cfg.window)
        .exec();

      res.set('X-RateLimit-Remaining', String(limit - count - 1));
      return next();
    } catch (err) {
      // Fail open: never block real traffic because of a limiter error.
      // eslint-disable-next-line no-console
      console.error('[ratelimit] error:', err.message);
      return next();
    }
  };
}

module.exports = { rateLimit, CONFIG, getConfig };
