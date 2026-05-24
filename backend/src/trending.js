'use strict';

// Trending products service — Challenge 4 wired into the live feed.
//
// Events get scored using the weights from config.js and stored in a Valkey
// sorted set (ZINCRBY). The top-N members are broadcast to every connected
// client through socket.io. Because the socket.io adapter is backed by Valkey,
// this works the same whether you have one backend node or twenty.

const config = require('./config');
const rooms = require('./rooms');

const TRENDING_KEY_1H = 'trending:global:1h';
const TRENDING_KEY_24H = 'trending:global:24h';

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
   * action ("view" | "addToCart" | "purchase").
   *
   * @param {string} productId
   * @param {'view'|'addToCart'|'purchase'} action
   */
  async recordEvent(productId, action) {
    const weight = config.trendingWeights[action];
    if (!weight) {
      throw new Error(`Unknown trending action: ${action}`);
    }

    // Increment both windows in a single round trip.
    const multi = this.valkey.multi();
    multi.zIncrBy(TRENDING_KEY_1H, weight, productId);
    multi.expire(TRENDING_KEY_1H, 3600);
    multi.zIncrBy(TRENDING_KEY_24H, weight, productId);
    multi.expire(TRENDING_KEY_24H, 86400);
    await multi.exec();

    this._scheduleBroadcast();
  }

  /**
   * Read the current top-N trending products with scores.
   * @returns {Promise<Array<{ productId: string, score: number }>>}
   */
  async getTop(limit = config.trendingTopN) {
    // zRangeWithScores requires REV for descending order. Using zRange with
    // REV is the modern, non-deprecated path in node-redis v4.
    const items = await this.valkey.zRangeWithScores(
      TRENDING_KEY_1H,
      0,
      limit - 1,
      { REV: true }
    );
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
        const top = await this.getTop();
        this.io.to(rooms.trending()).emit('trending:update', {
          top,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[trending] broadcast failed:', err.message);
      }
    }, wait);
  }
}

module.exports = { TrendingService, TRENDING_KEY_1H, TRENDING_KEY_24H };
