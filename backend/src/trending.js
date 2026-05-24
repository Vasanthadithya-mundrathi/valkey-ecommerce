'use strict';

// Trending products service — Challenge 4 wired into the live feed.
//
// Events get scored using the weights from config.js and stored in Valkey
// sorted sets (ZINCRBY). Each event updates four windows:
//   - global 1h   trending:global:1h    (TTL 3600)
//   - global 6h   trending:global:6h    (TTL 21600)
//   - global 24h  trending:global:24h   (TTL 86400)
//   - per-category, all three windows: trending:category:{categoryId}:{w}
//
// The TTL on each key gives us automatic time-decay: older buckets just fall
// off when they expire.
//
// The top-N members of the global 1h window are broadcast to every connected
// client through socket.io. Because the socket.io adapter is backed by
// Valkey, this works the same with one backend or twenty.

const config = require('./config');
const rooms = require('./rooms');

const WINDOW_SECONDS = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
};

const VALID_WINDOWS = Object.keys(WINDOW_SECONDS);
const VALID_ACTIONS = ['view', 'addToCart', 'purchase'];

const globalKey = (window) => `trending:global:${window}`;
const categoryKey = (categoryId, window) =>
  `trending:category:${categoryId}:${window}`;

class TrendingService {
  /**
   * @param {{ valkey: any, io: import('socket.io').Server }} deps
   */
  constructor({ valkey, io }) {
    this.valkey = valkey;
    this.io = io;
    this._broadcastTimer = null;
    this._lastBroadcast = 0;
  }

  /**
   * Record an interaction for a product. The score increment depends on the
   * action ("view" | "addToCart" | "purchase"). When `categoryId` is provided
   * the same increment is applied to the per-category sorted sets.
   *
   * @param {string} productId
   * @param {'view'|'addToCart'|'purchase'} action
   * @param {{ categoryId?: string }} [opts]
   */
  async recordEvent(productId, action, opts = {}) {
    if (!VALID_ACTIONS.includes(action)) {
      throw new Error(`Unknown trending action: ${action}`);
    }
    const weight = config.trendingWeights[action];

    const multi = this.valkey.multi();
    for (const window of VALID_WINDOWS) {
      const ttl = WINDOW_SECONDS[window];
      multi.zIncrBy(globalKey(window), weight, productId);
      multi.expire(globalKey(window), ttl);
      if (opts.categoryId) {
        multi.zIncrBy(categoryKey(opts.categoryId, window), weight, productId);
        multi.expire(categoryKey(opts.categoryId, window), ttl);
      }
    }
    await multi.exec();

    this._scheduleBroadcast();
  }

  /**
   * Read the top-N trending products in a given window.
   * @param {{ window?: '1h'|'6h'|'24h', categoryId?: string, limit?: number }} [opts]
   * @returns {Promise<Array<{ productId: string, score: number }>>}
   */
  async getTop(opts = {}) {
    const window = opts.window ?? '1h';
    const limit = opts.limit ?? config.trendingTopN;
    if (!VALID_WINDOWS.includes(window)) {
      throw new Error(`Unknown trending window: ${window}`);
    }
    const key = opts.categoryId
      ? categoryKey(opts.categoryId, window)
      : globalKey(window);

    const items = await this.valkey.zRangeWithScores(key, 0, limit - 1, {
      REV: true,
    });
    return items.map((entry) => ({ productId: entry.value, score: entry.score }));
  }

  /**
   * Throttle broadcasts so a flood of events doesn't turn into a flood of
   * socket frames. Coalesces into one emit per `trendingBroadcastMs` window.
   */
  _scheduleBroadcast() {
    if (this._broadcastTimer) return;

    const wait = Math.max(
      0,
      this._lastBroadcast + config.trendingBroadcastMs - Date.now()
    );

    this._broadcastTimer = setTimeout(async () => {
      this._broadcastTimer = null;
      this._lastBroadcast = Date.now();
      try {
        const top = await this.getTop({ window: '1h' });
        this.io.to(rooms.trending()).emit('trending:update', {
          window: '1h',
          top,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[trending] broadcast failed:', err.message);
      }
    }, wait);
  }
}

module.exports = {
  TrendingService,
  VALID_WINDOWS,
  WINDOW_SECONDS,
  globalKey,
  categoryKey,
};
