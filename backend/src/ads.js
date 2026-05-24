'use strict';

// Ads service — Challenge 5.
//
// Storage:
//   ad:{adId}                       JSON document (when JSON module available),
//                                   string fallback otherwise.
//   ads:category:{categoryId}       sorted set, score = bidAmount, member = adId
//   ads:keyword:{keyword}           sorted set, score = bidAmount, member = adId
//   ad_impressions:{adId}:{date}    counter (TTL 24h)
//   ad_clicks:{adId}:{date}         counter (TTL 24h)
//   ad_freq:{userId}:{adId}:{date}  counter (TTL 24h)
//   ad_spend:{adId}:{date}          counter (TTL 24h)
//
// We use plain string for the ad document so the implementation works on
// stock Valkey (without the JSON module). When valkey-bundle is present the
// behaviour is identical; the JSON module just makes server-side updates
// more efficient.

const FREQUENCY_CAP_DEFAULT = 3;

const adKey = (adId) => `ad:${adId}`;
const categoryIdxKey = (categoryId) => `ads:category:${categoryId}`;
const keywordIdxKey = (keyword) => `ads:keyword:${normalizeKeyword(keyword)}`;
const impressionsKey = (adId, date) => `ad_impressions:${adId}:${date}`;
const clicksKey = (adId, date) => `ad_clicks:${adId}:${date}`;
const freqKey = (userId, adId, date) => `ad_freq:${userId}:${adId}:${date}`;
const spendKey = (adId, date) => `ad_spend:${adId}:${date}`;

function normalizeKeyword(keyword) {
  return String(keyword || '').toLowerCase().trim();
}

function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

class AdsService {
  /**
   * @param {{ valkey: any }} deps
   * @param {{ frequencyCap?: number, now?: () => Date }} [opts]
   */
  constructor({ valkey }, opts = {}) {
    this.valkey = valkey;
    this.frequencyCap = opts.frequencyCap ?? FREQUENCY_CAP_DEFAULT;
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Create or replace an ad creative.
   * @param {object} ad
   */
  async create(ad) {
    if (!ad?.id) throw new Error('ad.id required');
    if (typeof ad.bidAmount !== 'number') {
      throw new Error('ad.bidAmount required');
    }
    const stored = {
      status: 'active',
      targetCategories: [],
      targetKeywords: [],
      dailyBudget: 0,
      ...ad,
    };

    await this.valkey.set(adKey(stored.id), JSON.stringify(stored));

    const multi = this.valkey.multi();
    for (const cat of stored.targetCategories) {
      multi.zAdd(categoryIdxKey(cat), { score: stored.bidAmount, value: stored.id });
    }
    for (const kw of stored.targetKeywords) {
      multi.zAdd(keywordIdxKey(kw), { score: stored.bidAmount, value: stored.id });
    }
    await multi.exec();

    return stored;
  }

  /**
   * Fetch an ad by id. Returns null if missing.
   */
  async get(adId) {
    const raw = await this.valkey.get(adKey(adId));
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Pick the best ads for a given context.
   *
   * @param {{ categoryId?: string, keywords?: string[], userId?: string, limit?: number }} ctx
   */
  async select(ctx = {}) {
    const limit = ctx.limit ?? 3;
    const date = todayUtc(this.now());

    // Gather candidate adIds with their bid scores. Keep the highest bid
    // observed for each ad.
    const candidates = new Map(); // adId -> bidScore

    const collectFromKey = async (key) => {
      const entries = await this.valkey.zRangeWithScores(key, 0, 49, { REV: true });
      for (const { value, score } of entries) {
        const prev = candidates.get(value) ?? -Infinity;
        if (score > prev) candidates.set(value, score);
      }
    };

    if (ctx.categoryId) {
      await collectFromKey(categoryIdxKey(ctx.categoryId));
    }
    if (Array.isArray(ctx.keywords)) {
      for (const kw of ctx.keywords) {
        await collectFromKey(keywordIdxKey(kw));
      }
    }

    if (candidates.size === 0) return [];

    // Sort by bid desc, then check budget + frequency cap.
    const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
    const winners = [];

    for (const [adId] of sorted) {
      if (winners.length >= limit) break;
      const ad = await this.get(adId);
      if (!ad || ad.status !== 'active') continue;

      const spend = parseInt(
        (await this.valkey.get(spendKey(adId, date))) ?? '0',
        10
      );
      if (ad.dailyBudget && spend + ad.bidAmount > ad.dailyBudget) continue;

      if (ctx.userId) {
        const seen = parseInt(
          (await this.valkey.get(freqKey(ctx.userId, adId, date))) ?? '0',
          10
        );
        if (seen >= this.frequencyCap) continue;
      }

      winners.push(ad);
    }

    return winners;
  }

  /**
   * Record an impression: bumps impression counter, frequency counter, and
   * spend (using the cost-per-impression bid model in HACKATHON.md).
   */
  async recordImpression(adId, userId) {
    const ad = await this.get(adId);
    if (!ad) throw new Error('ad not found');
    const date = todayUtc(this.now());

    const multi = this.valkey.multi();
    multi.incr(impressionsKey(adId, date));
    multi.expire(impressionsKey(adId, date), 86400);
    multi.incrBy(spendKey(adId, date), ad.bidAmount);
    multi.expire(spendKey(adId, date), 86400);
    if (userId) {
      multi.incr(freqKey(userId, adId, date));
      multi.expire(freqKey(userId, adId, date), 86400);
    }
    await multi.exec();
  }

  async recordClick(adId, userId) {
    const ad = await this.get(adId);
    if (!ad) throw new Error('ad not found');
    const date = todayUtc(this.now());
    const multi = this.valkey.multi();
    multi.incr(clicksKey(adId, date));
    multi.expire(clicksKey(adId, date), 86400);
    if (userId) {
      // Click also consumes frequency so a user clicking doesn't get spammed.
      multi.incr(freqKey(userId, adId, date));
      multi.expire(freqKey(userId, adId, date), 86400);
    }
    await multi.exec();
  }

  /**
   * Daily stats for an ad.
   */
  async getStats(adId, date = todayUtc(this.now())) {
    const [impressions, clicks, spend] = await Promise.all([
      this.valkey.get(impressionsKey(adId, date)),
      this.valkey.get(clicksKey(adId, date)),
      this.valkey.get(spendKey(adId, date)),
    ]);
    const i = parseInt(impressions ?? '0', 10);
    const c = parseInt(clicks ?? '0', 10);
    const s = parseInt(spend ?? '0', 10);
    return {
      adId,
      date,
      impressions: i,
      clicks: c,
      ctr: i > 0 ? c / i : 0,
      spend: s,
    };
  }
}

module.exports = {
  AdsService,
  todayUtc,
  normalizeKeyword,
  adKey,
  categoryIdxKey,
  keywordIdxKey,
};
