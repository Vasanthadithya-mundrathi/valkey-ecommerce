'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CartService } = require('../src/cart');

function makeFakeValkey() {
  const hashes = new Map();
  const ensureHash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  return {
    hashes,
    async hIncrBy(key, field, delta) {
      const h = ensureHash(key);
      const next = parseInt(h.get(field) ?? '0', 10) + delta;
      h.set(field, String(next));
      return next;
    },
    async hSet(key, field, value) {
      ensureHash(key).set(field, value);
    },
    async hDel(key, field) {
      ensureHash(key).delete(field);
    },
    async hGetAll(key) {
      return Object.fromEntries(ensureHash(key));
    },
    async expire() {
      /* no-op for tests */
    },
    async del(key) {
      hashes.delete(key);
    },
  };
}

const broadcasts = [];
const fakeIo = {
  to() {
    return {
      emit(event, payload) {
        broadcasts.push({ event, payload });
      },
    };
  },
};

test('cart add/set/remove/clear flow', async () => {
  broadcasts.length = 0;
  const cart = new CartService({ valkey: makeFakeValkey(), io: fakeIo });

  await cart.addItem('u1', 'p1', 2);
  await cart.addItem('u1', 'p1', 1);
  await cart.addItem('u1', 'p2', 5);

  let snap = await cart.getCart('u1');
  assert.deepEqual(snap, { p1: 3, p2: 5 });

  await cart.setItem('u1', 'p2', 1);
  snap = await cart.getCart('u1');
  assert.equal(snap.p2, 1);

  await cart.removeItem('u1', 'p1');
  snap = await cart.getCart('u1');
  assert.deepEqual(snap, { p2: 1 });

  await cart.clear('u1');
  snap = await cart.getCart('u1');
  assert.deepEqual(snap, {});

  // every mutation should have broadcast a cart:update
  assert.ok(broadcasts.length > 0);
  for (const b of broadcasts) {
    assert.equal(b.event, 'cart:update');
    assert.equal(b.payload.userId, 'u1');
  }
});

test('cart rejects negative quantities', async () => {
  const cart = new CartService({ valkey: makeFakeValkey(), io: fakeIo });
  await assert.rejects(() => cart.addItem('u1', 'p1', 0), /must be positive/);
  await assert.rejects(() => cart.setItem('u1', 'p1', -1), /must be non-negative/);
});

test('cart setItem with qty 0 removes the item', async () => {
  const cart = new CartService({ valkey: makeFakeValkey(), io: fakeIo });
  await cart.addItem('u1', 'p1', 3);
  const result = await cart.setItem('u1', 'p1', 0);
  assert.equal(result, 0);
  const snap = await cart.getCart('u1');
  assert.deepEqual(snap, {});
});
