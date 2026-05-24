// Challenge 13 — Real-time Recommendations tests.
// Requires valkey-bundle (JSON module) + seeded catalog.
const request = require('supertest');
const app = require('../src/index');
const client = require('../src/valkey');
const { seedCatalog } = require('../src/seed/seed');

const USER = 'user:test-rec';
const H = { 'x-user-id': USER };
const GALAXY = 'product:p-galaxy';
const BUDS = 'product:p-buds';

beforeAll(async () => {
  await seedCatalog();
  // Isolate this test user / co-purchase data from previous runs.
  await client.del(
    `user_history:${USER}`,
    `user_affinity:${USER}`,
    `user_purchased:${USER}`,
    `copurchase:${GALAXY}`,
    `copurchase:${BUDS}`
  );
});
afterAll(async () => {
  await client.quit();
});

describe('events + recently viewed', () => {
  test('recording a view adds the product to recently-viewed and category affinity', async () => {
    const ev = await request(app).post('/api/recommendations/events').set(H).send({ type: 'view', productId: GALAXY });
    expect(ev.status).toBe(200);

    const rv = await request(app).get('/api/recommendations/recently-viewed').set(H);
    expect(rv.body.results.map((p) => p.id)).toContain(GALAXY);

    const tfy = await request(app).get('/api/recommendations/trending-for-you').set(H);
    expect(tfy.body.results.length).toBeGreaterThan(0);
  });

  test('invalid event type returns 400', async () => {
    const res = await request(app).post('/api/recommendations/events').set(H).send({ type: 'nope', productId: GALAXY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_event');
  });
});

describe('co-purchase + personalized', () => {
  test('buying items together builds "customers also bought"', async () => {
    const buy = await request(app)
      .post('/api/recommendations/events')
      .set(H)
      .send({ type: 'purchase', productIds: [GALAXY, BUDS] });
    expect(buy.status).toBe(200);

    const similar = await request(app).get(`/api/recommendations/similar/${GALAXY}`).set(H);
    expect(similar.body.results.map((p) => p.id)).toContain(BUDS);
  });

  test('personalized feed excludes already-purchased items and is non-empty', async () => {
    const res = await request(app).get('/api/recommendations/personalized').set(H);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    const ids = res.body.results.map((p) => p.id);
    expect(ids).not.toContain(GALAXY); // purchased
    expect(ids).not.toContain(BUDS); // purchased
  });
});
