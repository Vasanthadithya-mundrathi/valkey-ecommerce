'use strict';

// Live inventory: stock counts kept in a Valkey hash, with deltas pushed out
// over socket.io as soon as they happen. Useful for "Only 3 left" badges, and
// — because broadcasts go through the Valkey adapter — every backend replica
// sees the same updates.

const rooms = require('./rooms');

const INVENTORY_KEY = 'inventory:stock';

class InventoryService {
  /**
   * @param {{ valkey: any, io: import('socket.io').Server }} deps
   */
  constructor({ valkey, io }) {
    this.valkey = valkey;
    this.io = io;
  }

  /**
   * Set the absolute stock for a product. Used at seed time.
   * @param {string} productId
   * @param {number} quantity
   */
  async setStock(productId, quantity) {
    await this.valkey.hSet(INVENTORY_KEY, productId, String(quantity));
    this._emit(productId, quantity, 'set');
  }

  /**
   * Atomically reserve `qty` units. Refuses to go below zero. Returns the
   * remaining stock on success, or null if there wasn't enough.
   *
   * @param {string} productId
   * @param {number} qty
   * @returns {Promise<number|null>}
   */
  async reserve(productId, qty) {
    if (qty <= 0) throw new Error('qty must be positive');

    // HINCRBY is atomic per key, so we increment by -qty and roll back if we
    // ended up below zero. This keeps the implementation single-round-trip
    // simple without needing a Lua script for the demo.
    const remaining = await this.valkey.hIncrBy(INVENTORY_KEY, productId, -qty);
    if (remaining < 0) {
      await this.valkey.hIncrBy(INVENTORY_KEY, productId, qty);
      return null;
    }
    this._emit(productId, remaining, 'reserve');
    return remaining;
  }

  /**
   * Release reserved units back to stock (e.g. on cart removal or order
   * cancellation).
   */
  async release(productId, qty) {
    if (qty <= 0) throw new Error('qty must be positive');
    const remaining = await this.valkey.hIncrBy(INVENTORY_KEY, productId, qty);
    this._emit(productId, remaining, 'release');
    return remaining;
  }

  /**
   * @param {string} productId
   * @returns {Promise<number>}
   */
  async get(productId) {
    const raw = await this.valkey.hGet(INVENTORY_KEY, productId);
    return raw == null ? 0 : parseInt(raw, 10);
  }

  /**
   * Get all known stock levels keyed by productId.
   * @returns {Promise<Record<string, number>>}
   */
  async getAll() {
    const raw = await this.valkey.hGetAll(INVENTORY_KEY);
    const out = {};
    for (const [productId, qty] of Object.entries(raw)) {
      out[productId] = parseInt(qty, 10);
    }
    return out;
  }

  _emit(productId, quantity, reason) {
    const payload = {
      productId,
      quantity,
      reason,
      updatedAt: new Date().toISOString(),
    };
    // Fan out to every viewer of this product's detail page, plus a global
    // inventory channel for dashboards.
    this.io.to(rooms.product(productId)).emit('inventory:update', payload);
    this.io.to(rooms.inventory()).emit('inventory:update', payload);
  }
}

module.exports = { InventoryService, INVENTORY_KEY };
