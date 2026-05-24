'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TrendingService,
  globalKey,
  categoryKey,
} = require('../src/trending');
const config = require('../src/config');

function makeFakeValkey() {
  const store = new Map(); // key -> Map<member, score>
  return {
    store,
    multi() {
      const ops = [];
      const api = {
        zIncrBy(key, score, member) {
          ops.push(['zIncrBy', key, score, member]);
          return api;
        },
        expire() {
          return api;
        },
        async exec() {
          for (const [op, key, score, member] of ops) {
            if (op !== 'zIncrBy') continue;
            const set = store.get(key) ?? new Map();
            set.set(member, (set.get(member) ?? 0) + score);
            store.set(key, set);
          }
        },
      };
      return api;
    },
    async zRangeWithScores(key, start, stop) {
      const set = store.get(key) ?? new Map();
      const sorted = [...set.entries()]
        .map(([value, score]) => ({ value, score }))
        .sort((a, b) => b.score - a.score);
      return sorted.slice(start, stop + 1);
    },
  };
}

function makeFakeIo() {
  return { to: () => ({ emit() {} }) };
}

test('recordEvent applies weights to all global windows', async () => {
  const valkey = makeFakeValkey();
  const trending = new TrendingService({ valkey, io: makeFakeIo() });

  await trending.recordEvent('p1', 'view'); // +1
  await trending.recordEvent('p1', 'purchase'); // +5

  for (const window of ['1h', '6h', '24h']) {
    const set = valkey.store.get(globalKey(window));
    assert.ok(set, `${window} bucket exists`);
    assert.equal(
      set.get('p1'),
      config.trendingWeights.view + config.trendingWeights.purchase,
      `${window} bucket has weighted score`
    );
  }
});

test('recordEvent with categoryId updates per-category bucket too', async () => {
  const valkey = makeFakeValkey();
  const trending = new TrendingService({ valkey, io: makeFakeIo() });

  await trending.recordEvent('p1', 'addToCart', { categoryId: 'cat:1' });
  await trending.recordEvent('p2', 'addToCart', { categoryId: 'cat:2' });

  const cat1 = valkey.store.get(categoryKey('cat:1', '1h'));
  assert.ok(cat1.has('p1'));
  assert.ok(!cat1.has('p2'));
});

test('getTop respects window and categoryId selectors', async () => {
  const valkey = makeFakeValkey();
  const trending = new TrendingService({ valkey, io: makeFakeIo() });

  await trending.recordEvent('p1', 'purchase', { categoryId: 'cat:1' });
  await trending.recordEvent('p2', 'view');

  const globalTop = await trending.getTop({ window: '24h' });
  assert.equal(globalTop[0].productId, 'p1');

  const cat1Top = await trending.getTop({ categoryId: 'cat:1', window: '1h' });
  assert.equal(cat1Top.length, 1);
  assert.equal(cat1Top[0].productId, 'p1');
});

test('getTop rejects unknown windows', async () => {
  const trending = new TrendingService({ valkey: makeFakeValkey(), io: makeFakeIo() });
  await assert.rejects(() => trending.getTop({ window: '5min' }), /Unknown trending window/);
});

test('recordEvent rejects unknown actions', async () => {
  const trending = new TrendingService({ valkey: makeFakeValkey(), io: makeFakeIo() });
  await assert.rejects(() => trending.recordEvent('p1', 'unknown'), /Unknown trending action/);
});
