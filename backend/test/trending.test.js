'use strict';

// Unit-tests the TrendingService against a fake Valkey client. We don't need
// a live Valkey for these checks — only the contract between the service and
// the client matters.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TrendingService } = require('../src/trending');
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
    async zRangeWithScores(key, start, stop, _opts) {
      const set = store.get(key) ?? new Map();
      const sorted = [...set.entries()]
        .map(([value, score]) => ({ value, score }))
        .sort((a, b) => b.score - a.score);
      return sorted.slice(start, stop + 1);
    },
  };
}

function makeFakeIo() {
  const emits = [];
  return {
    emits,
    to() {
      return {
        emit(event, payload) {
          emits.push({ event, payload });
        },
      };
    },
  };
}

test('recordEvent applies weights and getTop returns descending scores', async () => {
  const valkey = makeFakeValkey();
  const io = makeFakeIo();
  const trending = new TrendingService({ valkey, io });

  await trending.recordEvent('p1', 'view'); // +1
  await trending.recordEvent('p2', 'addToCart'); // +3
  await trending.recordEvent('p3', 'purchase'); // +5
  await trending.recordEvent('p1', 'purchase'); // +5 -> p1 = 6

  const top = await trending.getTop(3);
  assert.equal(top.length, 3);
  assert.equal(top[0].productId, 'p1');
  assert.equal(top[0].score, config.trendingWeights.view + config.trendingWeights.purchase);
  assert.equal(top[1].productId, 'p3');
  assert.equal(top[2].productId, 'p2');
});

test('recordEvent rejects unknown actions', async () => {
  const trending = new TrendingService({ valkey: makeFakeValkey(), io: makeFakeIo() });
  await assert.rejects(() => trending.recordEvent('p1', 'unknown'), /Unknown trending action/);
});
