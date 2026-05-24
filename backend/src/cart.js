'use strict';

// Server-authoritative cart with cross-device live sync. The cart is stored
// as a Valkey hash (productId -> quantity, see HACKATHON Challenge 3). Every
// mutation is broadcast to the user's `cart:{userId}` room so all of their
// open tabs and devices update in real time without polling.

const rooms = require('./rooms');

const CART_TTL_SECONDS = 7 * 24 * 60 * 60; // mirror the abandoned-cart window

const cartKey = (userId) => `cart:${userId}`;

class CartService {
  /**
   * @param {{ valkey: any, io: import('socket.io').Server }} deps
   */
  constructor({ valkey, io }) {
    this.valkey = valkey;
    this.io = io;
  }

  /**
   * @param {string} userId
   * @returns {Promise<Record<string, number>>}
   */
  async getCart(userId) {
    const raw = await this.valkey.hGetAll(cartKey(userId));
    const out = {};
    for (const [productId, qty] of Object.entries(raw)) {
      out[productId] = parseInt(qty, 10);
    }
    return out;
  }

  async addItem(userId, productId, qty = 1) {
    if (qty <= 0) throw new Error('qty must be positive');
    const newQty = await this.valkey.hIncrBy(cartKey(userId), productId, qty);
    await this.valkey.expire(cartKey(userId), CART_TTL_SECONDS);
    this._broadcast(userId, { type: 'add', productId, quantity: newQty });
    return newQty;
  }

  async setItem(userId, productId, qty) {
    if (qty < 0) throw new Error('qty must be non-negative');
    if (qty === 0) {
      return this.removeItem(userId, productId);
    }
    await this.valkey.hSet(cartKey(userId), productId, String(qty));
    await this.valkey.expire(cartKey(userId), CART_TTL_SECONDS);
    this._broadcast(userId, { type: 'set', productId, quantity: qty });
    return qty;
  }

  async removeItem(userId, productId) {
    await this.valkey.hDel(cartKey(userId), productId);
    this._broadcast(userId, { type: 'remove', productId, quantity: 0 });
    return 0;
  }

  async clear(userId) {
    await this.valkey.del(cartKey(userId));
    this._broadcast(userId, { type: 'clear' });
  }

  _broadcast(userId, change) {
    this.io.to(rooms.cart(userId)).emit('cart:update', {
      userId,
      ...change,
      updatedAt: new Date().toISOString(),
    });
  }
}

module.exports = { CartService, cartKey, CART_TTL_SECONDS };
