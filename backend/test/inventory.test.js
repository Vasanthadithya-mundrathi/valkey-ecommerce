'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { InventoryService } = require('../src/inventory');

function makeFakeValkey() {
  const hashes = new Map(); // key -> Map<field, string>
  const ensureHash = (key) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  return {
    hashes,
    async hSet(key, field, value) {
      ensureHash(key).set(field, value);
    },
    async hGet(key, field) {
      return ensureHash(key).get(field);
    },
    async hGetAll(key) {
      return Object.fromEntries(ensureHash(key));
    },
    async hIncrBy(key, field, delta) {
      const h = ensureHash(key);
      const next = parseInt(h.get(field) ?? '0', 10) + delta;
      h.set(field, String(next));
      return next;
    },
  };
}

const fakeIo = {
  to: () => ({ emit() {} }),
};

test('reserve subtracts stock and rejects when not enough is available', async () => {
  const valkey = makeFakeValkey();
  const inv = new InventoryService({ valkey, io: fakeIo });

  await inv.setStock('p1', 5);
  assert.equal(await inv.reserve('p1', 2), 3);
  assert.equal(await inv.reserve('p1', 10), null, 'should refuse when insufficient');
  assert.equal(await inv.get('p1'), 3, 'stock unchanged after refused reserve');
});

test('release adds stock back', async () => {
  const valkey = makeFakeValkey();
  const inv = new InventoryService({ valkey, io: fakeIo });

  await inv.setStock('p1', 4);
  await inv.reserve('p1', 3);
  assert.equal(await inv.release('p1', 2), 3);
});

test('reserve rejects non-positive quantities', async () => {
  const inv = new InventoryService({ valkey: makeFakeValkey(), io: fakeIo });
  await assert.rejects(() => inv.reserve('p1', 0), /must be positive/);
  await assert.rejects(() => inv.reserve('p1', -1), /must be positive/);
});
