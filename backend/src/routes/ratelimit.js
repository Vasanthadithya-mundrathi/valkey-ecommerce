// Challenge 12 — Rate Limiting (demo + introspection routes).
// The actual enforcement lives in lib/ratelimit.js so any challenge can reuse it.
const express = require('express');
const { rateLimit, CONFIG } = require('../lib/ratelimit');

const router = express.Router();

// Protected demo endpoint — limited to 3/min for anonymous, 6/min authenticated.
// Hit it repeatedly to see X-RateLimit-* headers count down and a 429 appear.
router.get('/test', rateLimit('/api/ratelimit/test'), (_req, res) => {
  res.json({ ok: true, message: 'within rate limit' });
});

// Expose the configured limits (handy for a UI / debugging).
router.get('/config', (_req, res) => res.json(CONFIG));

module.exports = router;
