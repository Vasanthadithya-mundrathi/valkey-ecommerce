'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SearchService, tokenize, editDistance, priceBucket } = require('../src/search');
const { DEMO_PRODUCTS } = require('../src/seed');

// SearchService falls back to in-memory when FT is absent. The fake Valkey
// just makes sendCommand throw so ensureIndex() takes the fallback path.
function makeFakeValkey() {
  return {
    async sendCommand() {
      const err = new Error('unknown command FT.CREATE');
      throw err;
    },
  };
}

async function buildService() {
  const search = new SearchService({ valkey: makeFakeValkey() });
  await search.indexAll(DEMO_PRODUCTS);
  return search;
}

test('tokenize strips stopwords and short tokens', () => {
  assert.deepEqual(tokenize('The flagship Galaxy Ultra Pro phone'), [
    'flagship', 'galaxy', 'ultra', 'pro', 'phone',
  ]);
});

test('editDistance handles trivial cases', () => {
  assert.equal(editDistance('galaxy', 'galaxy'), 0);
  assert.equal(editDistance('galaxy', 'galxy'), 1);
  assert.equal(editDistance('phone', 'fone'), 2);
});

test('priceBucket places amounts into the documented ranges', () => {
  assert.equal(priceBucket(1499), '0-2000');
  assert.equal(priceBucket(8499), '2000-10000');
  assert.equal(priceBucket(64999), '25000-75000');
  assert.equal(priceBucket(154999), '75000+');
});

test('search returns relevant products by name', async () => {
  const search = await buildService();
  const result = await search.search({ q: 'galaxy' });
  assert.ok(result.total >= 1);
  assert.equal(result.results[0].name, 'Galaxy Ultra Pro 256GB');
});

test('search tolerates a single typo', async () => {
  const search = await buildService();
  const result = await search.search({ q: 'galxy' });
  assert.ok(result.total >= 1, 'fuzzy match should still find galaxy');
  assert.equal(result.results[0].name, 'Galaxy Ultra Pro 256GB');
});

test('search filters by category and price range', async () => {
  const search = await buildService();
  const result = await search.search({
    q: 'phone',
    categoryId: 'category:smartphones',
    minPrice: 80000,
    maxPrice: 95000,
  });
  for (const r of result.results) {
    assert.equal(r.categoryId, 'category:smartphones');
    assert.ok(r.price.amount >= 80000 && r.price.amount <= 95000);
  }
});

test('search sorts by price ascending and descending', async () => {
  const search = await buildService();
  const asc = await search.search({ q: 'laptop', sort: 'price_asc' });
  const desc = await search.search({ q: 'laptop', sort: 'price_desc' });
  assert.ok(asc.results.length >= 2);
  assert.ok(asc.results[0].price.amount <= asc.results[asc.results.length - 1].price.amount);
  assert.ok(desc.results[0].price.amount >= desc.results[desc.results.length - 1].price.amount);
});

test('search facets count brands and categories on the filtered set', async () => {
  const search = await buildService();
  const result = await search.search({ q: 'phone' });
  assert.ok(result.facets.brands.length >= 1);
  const samsung = result.facets.brands.find((b) => b.name === 'Samsung');
  assert.ok(samsung && samsung.count >= 1);
  assert.ok(result.facets.priceRanges.length === 5);
});

test('suggest matches a short prefix', async () => {
  const search = await buildService();
  const out = await search.suggest('gal');
  assert.ok(out.length >= 1);
  assert.ok(out[0].name.toLowerCase().includes('galaxy'));
});

test('suggest tolerates a typo', async () => {
  const search = await buildService();
  const out = await search.suggest('coffe');
  assert.ok(out.some((s) => s.name.toLowerCase().includes('coffee')));
});

test('search backend reports in-memory when FT is unavailable', async () => {
  const search = await buildService();
  const result = await search.search({ q: 'phone' });
  assert.equal(result.backend, 'in-memory');
});
