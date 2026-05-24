// Challenge 13 — Real-time Recommendations
// Valkey: Lists (recently viewed), Sorted Sets (co-purchase matrix, category affinity,
// trending), Sets (already-purchased exclusion). Recommendations update the moment an
// interaction event is recorded.
const express = require('express');
const client = require('../valkey');
const { sendError, parseJsonGet } = require('../lib/respond');

const router = express.Router();

// Weights per interaction type (HACKATHON.md > Challenge 13).
const WEIGHTS = { view: 1, add_to_cart: 3, purchase: 5 };
const HISTORY_MAX = 50;

// Identify the user (auth isn't built yet → header or default demo user).
const userOf = (req) => req.header('x-user-id') || req.query.userId || 'user:demo';

// Fetch a product document and reduce it to display fields.
async function enrich(productId) {
  const doc = parseJsonGet(await client.call('JSON.GET', productId, '$'));
  if (!doc) return { id: productId };
  return {
    id: doc.id,
    name: doc.name,
    price: doc.price?.amount,
    currency: doc.price?.currency,
    image: doc.images?.[0]?.url,
    categoryId: doc.categoryId,
    rating: doc.ratings?.average,
  };
}

async function enrichMany(ids) {
  const unique = [...new Set(ids)];
  return Promise.all(unique.map(enrich));
}

// POST /api/recommendations/events
// body: { type: 'view'|'add_to_cart'|'purchase', productId, productIds?, categoryId? }
router.post('/events', async (req, res) => {
  const user = userOf(req);
  const { type, productId } = req.body || {};
  if (!WEIGHTS[type]) {
    return sendError(res, 400, 'invalid_event', `type must be one of: ${Object.keys(WEIGHTS).join(', ')}`);
  }
  const basket = Array.isArray(req.body.productIds) && req.body.productIds.length
    ? req.body.productIds
    : productId ? [productId] : [];
  if (!basket.length) {
    return sendError(res, 400, 'missing_product', 'productId or productIds is required.');
  }

  const weight = WEIGHTS[type];
  for (const pid of basket) {
    // Resolve category (from body or the product document) for affinity scoring.
    let categoryId = req.body.categoryId;
    if (!categoryId) {
      const doc = parseJsonGet(await client.call('JSON.GET', pid, '$'));
      categoryId = doc?.categoryId;
    }
    if (categoryId) await client.zincrby(`user_affinity:${user}`, weight, categoryId);

    // Global trending score (also feeds Challenge 4).
    await client.zincrby('trending:global:24h', weight, pid);

    if (type === 'view') {
      await client.lpush(`user_history:${user}`, pid);
      await client.ltrim(`user_history:${user}`, 0, HISTORY_MAX - 1);
    }
    if (type === 'purchase') {
      await client.sadd(`user_purchased:${user}`, pid);
    }
  }

  // Purchase of multiple items builds the "bought together" co-purchase matrix.
  if (type === 'purchase' && basket.length > 1) {
    for (let i = 0; i < basket.length; i++) {
      for (let j = 0; j < basket.length; j++) {
        if (i !== j) await client.zincrby(`copurchase:${basket[i]}`, 1, basket[j]);
      }
    }
  }

  return res.json({ ok: true, recorded: { type, products: basket } });
});

// GET /api/recommendations/recently-viewed
router.get('/recently-viewed', async (req, res) => {
  const ids = await client.lrange(`user_history:${userOf(req)}`, 0, HISTORY_MAX - 1);
  return res.json({ results: await enrichMany(ids) });
});

// GET /api/recommendations/similar/:productId  — "customers also bought"
router.get('/similar/:productId', async (req, res) => {
  const ids = await client.zrevrange(`copurchase:${req.params.productId}`, 0, 9);
  return res.json({ productId: req.params.productId, results: await enrichMany(ids) });
});

// GET /api/recommendations/trending-for-you  — trending within the user's top categories
router.get('/trending-for-you', async (req, res) => {
  const user = userOf(req);
  const topCats = new Set(await client.zrevrange(`user_affinity:${user}`, 0, 2));
  const trending = await client.zrevrange('trending:global:24h', 0, 30);
  const enriched = await enrichMany(trending);
  const filtered = topCats.size
    ? enriched.filter((p) => topCats.has(p.categoryId))
    : enriched;
  // Fall back to plain trending if the user has no category affinity yet.
  return res.json({ results: (filtered.length ? filtered : enriched).slice(0, 10) });
});

// GET /api/recommendations/personalized  — blended feed
router.get('/personalized', async (req, res) => {
  const user = userOf(req);

  const [history, topCats, purchased] = await Promise.all([
    client.lrange(`user_history:${user}`, 0, 9),
    client.zrevrange(`user_affinity:${user}`, 0, 2),
    client.smembers(`user_purchased:${user}`),
  ]);
  const purchasedSet = new Set(purchased);

  // Candidate scoring: co-purchases of recently viewed + products in top categories.
  const scores = new Map();
  const bump = (id, by) => scores.set(id, (scores.get(id) || 0) + by);

  for (const viewed of history) {
    const co = await client.zrevrange(`copurchase:${viewed}`, 0, 4, 'WITHSCORES');
    for (let i = 0; i < co.length; i += 2) bump(co[i], 2 * Number(co[i + 1]));
  }
  for (const cat of topCats) {
    const inCat = await client.smembers(`category_products:${cat}`);
    for (const id of inCat) bump(id, 1);
  }

  // Exclude already purchased + currently in history (already seen).
  const seen = new Set(history);
  const ranked = [...scores.entries()]
    .filter(([id]) => !purchasedSet.has(id) && !seen.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // Backfill with global trending so the feed is never empty.
  if (ranked.length < 6) {
    const trending = await client.zrevrange('trending:global:24h', 0, 20);
    for (const id of trending) {
      if (ranked.length >= 10) break;
      if (!ranked.includes(id) && !purchasedSet.has(id) && !seen.has(id)) ranked.push(id);
    }
  }

  return res.json({ user, results: await enrichMany(ranked.slice(0, 10)) });
});

// Demo helper: list seeded products so the UI has something to interact with.
// (Temporary — Challenge 2 "Product Catalog" will provide the real /api/products.)
router.get('/products', async (_req, res) => {
  const ids = await client.zrevrange('trending:global:24h', 0, 50);
  return res.json({ results: await enrichMany(ids) });
});

module.exports = router;
