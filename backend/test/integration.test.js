'use strict';

// End-to-end style test: real socket.io server + real socket.io-client over a
// real TCP socket, but with a fake in-memory Valkey for speed and zero deps.
//
// In production, swap the fake for the @socket.io/redis-adapter and a live
// Valkey via socket.js — that is the integration this whole module exists for.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');

const { TrendingService } = require('../src/trending');
const { InventoryService } = require('../src/inventory');
const { CartService } = require('../src/cart');
const { registerHandlers } = require('../src/handlers');

function makeFakeValkey() {
  const hashes = new Map();
  const sortedSets = new Map();
  const ensureHash = (k) => {
    if (!hashes.has(k)) hashes.set(k, new Map());
    return hashes.get(k);
  };
  const ensureZSet = (k) => {
    if (!sortedSets.has(k)) sortedSets.set(k, new Map());
    return sortedSets.get(k);
  };

  return {
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
    async hDel(key, field) {
      ensureHash(key).delete(field);
    },
    async expire() {},
    async del(key) {
      hashes.delete(key);
      sortedSets.delete(key);
    },
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
            const z = ensureZSet(key);
            z.set(member, (z.get(member) ?? 0) + score);
          }
        },
      };
      return api;
    },
    async zRangeWithScores(key, start, stop) {
      const z = ensureZSet(key);
      const sorted = [...z.entries()]
        .map(([value, score]) => ({ value, score }))
        .sort((a, b) => b.score - a.score);
      return sorted.slice(start, stop + 1);
    },
  };
}

async function bootServer() {
  const httpServer = http.createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const valkey = makeFakeValkey();
  const trending = new TrendingService({ valkey, io });
  const inventory = new InventoryService({ valkey, io });
  const cart = new CartService({ valkey, io });
  await inventory.setStock('product:p1', 5);
  registerHandlers({ io, trending, inventory, cart });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  return { httpServer, io, port, valkey };
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} ack timeout`)), 2000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

function waitFor(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${event} not received in time`)), 3000);
    const handler = (payload) => {
      if (predicate(payload)) {
        clearTimeout(t);
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });
}

test('product:add-to-cart reserves stock, updates cart, and broadcasts', async () => {
  const { httpServer, port } = await bootServer();
  try {
    const url = `http://localhost:${port}`;
    const a = createClient(url, { transports: ['websocket'] });
    const b = createClient(url, { transports: ['websocket'] });

    await Promise.all([
      new Promise((res) => a.on('connect', res)),
      new Promise((res) => b.on('connect', res)),
    ]);

    // Both clients subscribe to the same user's cart room
    await emitWithAck(a, 'subscribe:cart', { userId: 'user:demo' });
    await emitWithAck(b, 'subscribe:cart', { userId: 'user:demo' });

    // Subscribe b to inventory updates so we can observe stock change
    await emitWithAck(b, 'subscribe:inventory', {});

    const cartUpdate = waitFor(b, 'cart:update', (p) => p.productId === 'product:p1');
    const inventoryUpdate = waitFor(b, 'inventory:update', (p) => p.productId === 'product:p1');

    const ack = await emitWithAck(a, 'product:add-to-cart', {
      productId: 'product:p1',
      userId: 'user:demo',
      qty: 2,
    });

    assert.equal(ack.ok, true);
    assert.equal(ack.remaining, 3);

    const cu = await cartUpdate;
    assert.equal(cu.userId, 'user:demo');
    assert.equal(cu.quantity, 2);

    const iu = await inventoryUpdate;
    assert.equal(iu.quantity, 3);
    assert.equal(iu.reason, 'reserve');

    a.close();
    b.close();
  } finally {
    await new Promise((res) => httpServer.close(res));
  }
});

test('out-of-stock add-to-cart returns error and does not mutate cart', async () => {
  const { httpServer, port } = await bootServer();
  try {
    const url = `http://localhost:${port}`;
    const c = createClient(url, { transports: ['websocket'] });
    await new Promise((res) => c.on('connect', res));

    await emitWithAck(c, 'subscribe:cart', { userId: 'user:demo' });

    const ack = await emitWithAck(c, 'product:add-to-cart', {
      productId: 'product:p1',
      userId: 'user:demo',
      qty: 999,
    });

    assert.equal(ack.ok, false);
    assert.equal(ack.error, 'out_of_stock');

    const cartGet = await emitWithAck(c, 'cart:get', { userId: 'user:demo' });
    assert.deepEqual(cartGet.items, {});

    c.close();
  } finally {
    await new Promise((res) => httpServer.close(res));
  }
});

test('trending:get reflects recorded events across multiple clients', async () => {
  const { httpServer, port } = await bootServer();
  try {
    const url = `http://localhost:${port}`;
    const c = createClient(url, { transports: ['websocket'] });
    await new Promise((res) => c.on('connect', res));

    await emitWithAck(c, 'product:view', { productId: 'product:p1' });
    await emitWithAck(c, 'product:purchase', { productId: 'product:p1', qty: 1 });
    await emitWithAck(c, 'product:view', { productId: 'product:p2' });

    const ack = await emitWithAck(c, 'trending:get', {});
    assert.equal(ack.ok, true);
    assert.ok(ack.top.length >= 2);
    assert.equal(ack.top[0].productId, 'product:p1');
    assert.equal(ack.top[0].score, 6);
    assert.equal(ack.top[1].productId, 'product:p2');
    assert.equal(ack.top[1].score, 1);

    c.close();
  } finally {
    await new Promise((res) => httpServer.close(res));
  }
});
