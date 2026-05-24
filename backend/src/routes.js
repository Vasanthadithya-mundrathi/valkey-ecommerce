'use strict';

// Lightweight HTTP surface so the frontend can bootstrap state on first load
// without a socket connection. Real-time mutations still flow through
// socket.io.

const express = require('express');
const config = require('./config');
const { getDemoCatalog } = require('./seed');

/**
 * @param {{
 *   trending: import('./trending').TrendingService,
 *   inventory: import('./inventory').InventoryService,
 *   cart: import('./cart').CartService,
 *   valkey: any,
 *   io: import('socket.io').Server
 * }} deps
 */
function buildRouter({ trending, inventory, cart, valkey, io }) {
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

  router.get('/trending', async (_req, res) => {
    res.json({ top: await trending.getTop() });
  });

  router.get('/inventory', async (_req, res) => {
    res.json({ stock: await inventory.getAll() });
  });

  router.get('/cart/:userId', async (req, res) => {
    res.json({ items: await cart.getCart(req.params.userId) });
  });

  return router;
}

module.exports = { buildRouter };
