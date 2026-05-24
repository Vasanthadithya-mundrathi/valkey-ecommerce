'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AdsService } = require('../src/ads');

function makeFakeValkey() {
  const strings = new Map();
  const sortedSets = new Map();
  const ensureZ = (k) => {
    if (!sortedSets.has(k)) sortedSets.set(k, new Map());
    return sortedSets.get(k);
  };
  return {
    strings,
    sortedSets,
    async set(k, v) {
      strings.set(k, v);
    },
    async get(k) {
      return strings.has(k) ? strings.get(k) : null;
    },
    async incr(k) {
      const next = parseInt(strings.get(k) ?? '0', 10) + 1;
      strings.set(k, String(next));
      return next;
    },
    async incrBy(k, n) {
      const next = parseInt(strings.get(k) ?? '0', 10) + n;
      strings.set(k, String(next));
      return next;
    },
    async expire() {},
    multi() {
      const ops = [];
      const api = {
        zAdd(key, entry) {
          ops.push(['zAdd', key, entry]);
          return api;
        },
        incr(key) {
          ops.push(['incr', key]);
          return api;
        },
        incrBy(key, n) {
          ops.push(['incrBy', key, n]);
          return api;
        },
        expire() {
          return api;
        },
        async exec() {
          for (const op of ops) {
            const [name, key, arg] = op;
            if (name === 'zAdd') {
              ensureZ(key).set(arg.value, arg.score);
            } else if (name === 'incr') {
              const next = parseInt(strings.get(key) ?? '0', 10) + 1;
              strings.set(key, String(next));
            } else if (name === 'incrBy') {
              const next = parseInt(strings.get(key) ?? '0', 10) + arg;
              strings.set(key, String(next));
            }
          }
        },
      };
      return api;
    },
    async zRangeWithScores(key, start, stop, _opts) {
      const z = sortedSets.get(key) ?? new Map();
      const sorted = [...z.entries()]
        .map(([value, score]) => ({ value, score }))
        .sort((a, b) => b.score - a.score);
      return sorted.slice(start, stop + 1);
    },
  };
}

const baseAds = [
  {
    id: 'ad:1',
    title: 'High bid phone ad',
    targetCategories: ['category:smartphones'],
    targetKeywords: ['phone'],
    bidAmount: 800,
    dailyBudget: 5000,
  },
  {
    id: 'ad:2',
    title: 'Mid bid phone ad',
    targetCategories: ['category:smartphones'],
    targetKeywords: ['phone'],
    bidAmount: 500,
    dailyBudget: 5000,
  },
  {
    id: 'ad:3',
    title: 'Audio ad',
    targetCategories: ['category:audio'],
    targetKeywords: ['earbuds', 'audio'],
    bidAmount: 600,
    dailyBudget: 5000,
  },
];

test('select returns highest-bid ads first within a category', async () => {
  const valkey = makeFakeValkey();
  const ads = new AdsService({ valkey });
  for (const ad of baseAds) await ads.create(ad);

  const result = await ads.select({ categoryId: 'category:smartphones', limit: 2 });
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'ad:1');
  assert.equal(result[1].id, 'ad:2');
});

test('select skips ads whose daily budget would be exceeded', async () => {
  const valkey = makeFakeValkey();
  const ads = new AdsService({
    valkey,
  }, { now: () => new Date('2025-05-24T00:00:00Z') });
  await ads.create({
    id: 'ad:1',
    title: 'Tight budget',
    targetCategories: ['category:smartphones'],
    targetKeywords: [],
    bidAmount: 800,
    dailyBudget: 500, // less than one impression
  });
  await ads.create({
    id: 'ad:2',
    title: 'OK budget',
    targetCategories: ['category:smartphones'],
    targetKeywords: [],
    bidAmount: 200,
    dailyBudget: 2000,
  });

  const result = await ads.select({ categoryId: 'category:smartphones' });
  assert.deepEqual(result.map((a) => a.id), ['ad:2']);
});

test('frequency cap: a user is not shown the same ad more than the cap', async () => {
  const valkey = makeFakeValkey();
  const ads = new AdsService(
    { valkey },
    { frequencyCap: 2, now: () => new Date('2025-05-24T00:00:00Z') }
  );
  await ads.create({
    id: 'ad:1',
    title: 'Cap test',
    targetCategories: ['category:smartphones'],
    targetKeywords: [],
    bidAmount: 100,
    dailyBudget: 100000,
  });

  // First two impressions are allowed
  for (let i = 0; i < 2; i++) {
    const r = await ads.select({ categoryId: 'category:smartphones', userId: 'u1' });
    assert.equal(r[0].id, 'ad:1');
    await ads.recordImpression('ad:1', 'u1');
  }
  // Third impression hits the cap
  const r3 = await ads.select({ categoryId: 'category:smartphones', userId: 'u1' });
  assert.equal(r3.length, 0);
});

test('getStats reports impressions, clicks, ctr and spend', async () => {
  const valkey = makeFakeValkey();
  const ads = new AdsService(
    { valkey },
    { now: () => new Date('2025-05-24T00:00:00Z') }
  );
  await ads.create({
    id: 'ad:1',
    title: 'Stats test',
    targetCategories: ['category:smartphones'],
    targetKeywords: [],
    bidAmount: 100,
    dailyBudget: 10000,
  });

  await ads.recordImpression('ad:1', 'u1');
  await ads.recordImpression('ad:1', 'u2');
  await ads.recordImpression('ad:1', 'u3');
  await ads.recordImpression('ad:1', 'u4');
  await ads.recordClick('ad:1', 'u1');

  const stats = await ads.getStats('ad:1');
  assert.equal(stats.impressions, 4);
  assert.equal(stats.clicks, 1);
  assert.equal(stats.spend, 400);
  assert.equal(stats.ctr, 0.25);
});

test('keyword targeting picks ads even without categoryId', async () => {
  const valkey = makeFakeValkey();
  const ads = new AdsService({ valkey });
  for (const ad of baseAds) await ads.create(ad);

  const result = await ads.select({ keywords: ['earbuds'] });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'ad:3');
});
