'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const rooms = require('../src/rooms');

test('rooms helpers produce stable, prefixed names', () => {
  assert.equal(rooms.product('p1'), 'product:p1');
  assert.equal(rooms.cart('u1'), 'cart:u1');
  assert.equal(rooms.order('o1'), 'order:o1');
  assert.equal(rooms.trending(), 'trending:global');
  assert.equal(rooms.inventory(), 'inventory:global');
});
