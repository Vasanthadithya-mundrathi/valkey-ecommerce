'use strict';

// HTTP surface for the realtime backend. Mirrors the API shapes called out
// in HACKATHON.md for challenges 4, 5, and 6 so the frontend can use either
// REST or socket.io interchangeably.

const express = require('express');
const config = require('./config');
const { getDemoCatalog, getDemoCategories } = require('./seed');

/**
 * @param {{
 *   trending: import('./trending').TrendingService,
 *   inventory: import('./inventory').InventoryService,
 *   cart: import('./cart').CartService,
 *   ads: import('./ads').AdsService,
 *   search: import('./search').SearchService,
 *   valkey: any,
 *   io: import('socket.io').Server
 * }} deps
 */
function buildRouter({ trending, inventory, cart, ads, search, valkey, io }) {
  const router = express.Router();

  router.get('/health', async (_req, res) => {
    let valkeyOk = false;
    try {
      valkeyOk = (await valkey.ping()) === 'PONG';
    } catch (_) {
      valkeyOk = false;
    }
    res.json({
      ok: true,
      nodeId: config.nodeId,
      valkey: valkeyOk,
      sockets: io.engine.clientsCount,
      time: new Date().toISOString(),
    });
  });

  router.get('/products', async (_req, res) => {
    const products = await getDemoCatalog(valkey);
    const stock = await inventory.getAll();
    res.json(
      products.map((p) => ({
        ...p,
        stock: stock[p.id] ?? 0,
      }))
    );
  });

  router.get('/categories', async (_req, res) => {
    res.json(await getDemoCategories(valkey));
  });

  router.get('/inventory', async (_req, res) => {
    res.json({ stock: await inventory.getAll() });
  });

  router.get('/cart/:userId', async (req, res) => {
    res.json({ items: await cart.getCart(req.params.userId) });
  });

  // ---- Challenge 4: Trending --------------------------------------------
  router.get('/trending', async (req, res) => {
    res.json({
      window: req.query.window || '1h',
      top: await trending.getTop({
        window: req.query.window,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      }),
    });
  });

  router.get('/trending/:categoryId', async (req, res) => {
    res.json({
      categoryId: req.params.categoryId,
      window: req.query.window || '1h',
      top: await trending.getTop({
        categoryId: req.params.categoryId,
        window: req.query.window,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      }),
    });
  });

  router.post('/events/view', async (req, res) => {
    const { productId, categoryId } = req.body || {};
    if (!productId) return res.status(400).json({ ok: false, error: 'productId required' });
    await trending.recordEvent(productId, 'view', { categoryId });
    res.json({ ok: true });
  });

  router.post('/events/add-to-cart', async (req, res) => {
    const { productId, categoryId } = req.body || {};
    if (!productId) return res.status(400).json({ ok: false, error: 'productId required' });
    await trending.recordEvent(productId, 'addToCart', { categoryId });
    res.json({ ok: true });
  });

  router.post('/events/purchase', async (req, res) => {
    const { productId, categoryId } = req.body || {};
    if (!productId) return res.status(400).json({ ok: false, error: 'productId required' });
    await trending.recordEvent(productId, 'purchase', { categoryId });
    res.json({ ok: true });
  });

  // ---- Challenge 5: Ads --------------------------------------------------
  router.get('/ads', async (req, res) => {
    const keywords = req.query.keywords
      ? String(req.query.keywords).split(',').filter(Boolean)
      : undefined;

    let categoryId;
    if (req.query.context === 'category') {
      categoryId = req.query.value;
    }

    const selected = await ads.select({
      categoryId: req.query.categoryId || categoryId,
      keywords,
      userId: req.query.userId,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
    });
    res.json({ ads: selected });
  });

  router.post('/ads', async (req, res) => {
    try {
      const ad = await ads.create(req.body);
      res.status(201).json(ad);
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.get('/ads/:adId/stats', async (req, res) => {
    res.json(await ads.getStats(req.params.adId, req.query.date));
  });

  router.post('/ads/:adId/impression', async (req, res) => {
    try {
      await ads.recordImpression(req.params.adId, req.body?.userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ ok: false, error: err.message });
    }
  });

  router.post('/ads/:adId/click', async (req, res) => {
    try {
      await ads.recordClick(req.params.adId, req.body?.userId);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ ok: false, error: err.message });
    }
  });

  // ---- Challenge 6: Search ----------------------------------------------
  router.get('/search', async (req, res) => {
    const q = req.query.q || '';
    const result = await search.search({
      q,
      categoryId: req.query.category || req.query.categoryId,
      brand: req.query.brand,
      minPrice: req.query.minPrice ? parseInt(req.query.minPrice, 10) : undefined,
      maxPrice: req.query.maxPrice ? parseInt(req.query.maxPrice, 10) : undefined,
      sort: req.query.sort,
      page: req.query.page ? parseInt(req.query.page, 10) : 1,
      pageSize: req.query.pageSize ? parseInt(req.query.pageSize, 10) : 20,
    });
    res.json(result);
  });

  router.get('/search/suggest', async (req, res) => {
    const suggestions = await search.suggest(req.query.q, req.query.max ? parseInt(req.query.max, 10) : 5);
    res.json({ suggestions });
  });

  router.get('/search/facets', async (req, res) => {
    const result = await search.search({ q: req.query.q, pageSize: 0 });
    res.json({ facets: result.facets, total: result.total });
  });

  return router;
}

module.exports = { buildRouter };
