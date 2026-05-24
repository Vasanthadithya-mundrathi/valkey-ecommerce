'use strict';

// All client-facing socket.io event handlers in one place.
//
// Event vocabulary (kept stable so the React client can rely on it):
//   subscribe:product    { productId }                -> joins product room
//   subscribe:cart       { userId }                   -> joins cart room
//   subscribe:trending   {}                           -> joins trending room
//   subscribe:inventory  {}                           -> joins inventory room
//   product:view         { productId, categoryId? }   -> trending event
//   product:add-to-cart  { productId, userId, qty?, categoryId? }
//   product:purchase     { productId, qty?, categoryId? }
//   cart:set             { userId, productId, qty }
//   cart:remove          { userId, productId }
//   cart:clear           { userId }
//   trending:get         { window?, categoryId? }     -> ack returns top-N
//   ads:select           { categoryId?, keywords?, userId?, limit? } -> ack
//   ads:impression       { adId, userId? }
//   ads:click            { adId, userId? }
//   search:query         { q, ... }                   -> ack returns results
//   search:suggest       { q, max? }                  -> ack returns names

const config = require('./config');
const rooms = require('./rooms');

/**
 * @param {{
 *   io: import('socket.io').Server,
 *   trending: import('./trending').TrendingService,
 *   inventory: import('./inventory').InventoryService,
 *   cart: import('./cart').CartService,
 *   ads: import('./ads').AdsService,
 *   search: import('./search').SearchService
 * }} deps
 */
function registerHandlers({ io, trending, inventory, cart, ads, search }) {
  io.on('connection', (socket) => {
    const handshakeUserId = socket.handshake.auth?.userId;
    if (handshakeUserId) {
      socket.data.userId = handshakeUserId;
    }

    socket.emit('hello', {
      socketId: socket.id,
      nodeId: config.nodeId,
      serverTime: new Date().toISOString(),
    });

    // ---- subscriptions ------------------------------------------------------
    socket.on('subscribe:product', ({ productId } = {}, ack) => {
      if (!productId) return ack?.({ ok: false, error: 'productId required' });
      socket.join(rooms.product(productId));
      ack?.({ ok: true, room: rooms.product(productId) });
    });

    socket.on('unsubscribe:product', ({ productId } = {}) => {
      if (productId) socket.leave(rooms.product(productId));
    });

    socket.on('subscribe:cart', ({ userId } = {}, ack) => {
      const id = userId || socket.data.userId;
      if (!id) return ack?.({ ok: false, error: 'userId required' });
      socket.data.userId = id;
      socket.join(rooms.cart(id));
      ack?.({ ok: true, room: rooms.cart(id) });
    });

    socket.on('subscribe:trending', (_payload, ack) => {
      socket.join(rooms.trending());
      try {
        ack?.({ ok: true, room: rooms.trending() });
      } catch (_) {
        /* ack optional */
      }
    });

    socket.on('subscribe:inventory', (_payload, ack) => {
      socket.join(rooms.inventory());
      ack?.({ ok: true, room: rooms.inventory() });
    });

    // ---- product interactions ----------------------------------------------
    socket.on('product:view', async (payload = {}, ack) => {
      const { productId, categoryId } = payload;
      if (!productId) return ack?.({ ok: false, error: 'productId required' });
      try {
        await trending.recordEvent(productId, 'view', { categoryId });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('product:add-to-cart', async (payload = {}, ack) => {
      const { productId, userId, qty = 1, categoryId } = payload;
      const uid = userId || socket.data.userId;
      if (!productId || !uid) {
        return ack?.({ ok: false, error: 'productId and userId required' });
      }
      try {
        const remaining = await inventory.reserve(productId, qty);
        if (remaining === null) {
          return ack?.({ ok: false, error: 'out_of_stock' });
        }
        await cart.addItem(uid, productId, qty);
        await trending.recordEvent(productId, 'addToCart', { categoryId });
        ack?.({ ok: true, remaining });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('product:purchase', async (payload = {}, ack) => {
      const { productId, qty = 1, categoryId } = payload;
      if (!productId) return ack?.({ ok: false, error: 'productId required' });
      try {
        await trending.recordEvent(productId, 'purchase', { categoryId });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // ---- cart mutations ----------------------------------------------------
    socket.on('cart:set', async (payload = {}, ack) => {
      const { userId, productId, qty } = payload;
      const uid = userId || socket.data.userId;
      if (!uid || !productId || qty == null) {
        return ack?.({ ok: false, error: 'userId, productId, qty required' });
      }
      try {
        const newQty = await cart.setItem(uid, productId, qty);
        ack?.({ ok: true, quantity: newQty });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('cart:remove', async (payload = {}, ack) => {
      const { userId, productId } = payload;
      const uid = userId || socket.data.userId;
      if (!uid || !productId) {
        return ack?.({ ok: false, error: 'userId and productId required' });
      }
      try {
        await cart.removeItem(uid, productId);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('cart:clear', async (payload = {}, ack) => {
      const { userId } = payload;
      const uid = userId || socket.data.userId;
      if (!uid) return ack?.({ ok: false, error: 'userId required' });
      try {
        await cart.clear(uid);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('cart:get', async (payload = {}, ack) => {
      const uid = payload.userId || socket.data.userId;
      if (!uid) return ack?.({ ok: false, error: 'userId required' });
      try {
        const items = await cart.getCart(uid);
        ack?.({ ok: true, items });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // ---- read APIs ---------------------------------------------------------
    socket.on('trending:get', async (payload = {}, ack) => {
      try {
        const top = await trending.getTop({
          window: payload.window,
          categoryId: payload.categoryId,
          limit: payload.limit,
        });
        ack?.({ ok: true, top });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('inventory:get', async (payload = {}, ack) => {
      try {
        if (payload.productId) {
          const qty = await inventory.get(payload.productId);
          return ack?.({ ok: true, quantity: qty });
        }
        const all = await inventory.getAll();
        ack?.({ ok: true, stock: all });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // ---- ads ---------------------------------------------------------------
    if (ads) {
      socket.on('ads:select', async (payload = {}, ack) => {
        try {
          const uid = payload.userId || socket.data.userId;
          const selected = await ads.select({ ...payload, userId: uid });
          ack?.({ ok: true, ads: selected });
        } catch (err) {
          ack?.({ ok: false, error: err.message });
        }
      });

      socket.on('ads:impression', async (payload = {}, ack) => {
        const { adId } = payload;
        const uid = payload.userId || socket.data.userId;
        if (!adId) return ack?.({ ok: false, error: 'adId required' });
        try {
          await ads.recordImpression(adId, uid);
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err.message });
        }
      });

      socket.on('ads:click', async (payload = {}, ack) => {
        const { adId } = payload;
        const uid = payload.userId || socket.data.userId;
        if (!adId) return ack?.({ ok: false, error: 'adId required' });
        try {
          await ads.recordClick(adId, uid);
          ack?.({ ok: true });
        } catch (err) {
          ack?.({ ok: false, error: err.message });
        }
      });
    }

    // ---- search ------------------------------------------------------------
    if (search) {
      socket.on('search:query', async (payload = {}, ack) => {
        try {
          const result = await search.search(payload);
          ack?.({ ok: true, ...result });
        } catch (err) {
          ack?.({ ok: false, error: err.message });
        }
      });

      socket.on('search:suggest', async (payload = {}, ack) => {
        try {
          const suggestions = await search.suggest(payload.q, payload.max);
          ack?.({ ok: true, suggestions });
        } catch (err) {
          ack?.({ ok: false, error: err.message });
        }
      });
    }
  });
}

module.exports = { registerHandlers };
