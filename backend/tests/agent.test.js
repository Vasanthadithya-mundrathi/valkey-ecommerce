// Challenge 14 — Agentic Search tests.
// The catalog-search tool is tested deterministically (no API call). The /search
// endpoint is tested end-to-end; it works with Gemini OR its keyword fallback, so
// assertions stay tolerant and quota-safe.
const request = require('supertest');
const app = require('../src/index');
const client = require('../src/valkey');
const { seedCatalog, CAT } = require('../src/seed/seed');
const { searchCatalog } = require('../src/routes/agent');

beforeAll(async () => {
  await seedCatalog();
});
afterAll(async () => {
  await client.quit();
});

describe('searchCatalog tool (deterministic)', () => {
  test('filters by category', async () => {
    const results = await searchCatalog({ categories: [CAT.smartphones] });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.categoryId === CAT.smartphones)).toBe(true);
  });

  test('filters by max price', async () => {
    const results = await searchCatalog({ maxPrice: 5000 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.price.amount <= 5000)).toBe(true);
  });

  test('ranks keyword matches first', async () => {
    const results = await searchCatalog({ keywords: ['galaxy'] });
    expect(results[0].name.toLowerCase()).toContain('galaxy');
  });
});

describe('POST /api/agent/search', () => {
  test('returns results, an assistant response, and a sessionId', async () => {
    const res = await request(app)
      .post('/api/agent/search')
      .send({ message: 'I need a good smartphone under 100000' });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(typeof res.body.response).toBe('string');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0]).toHaveProperty('reason');
  }, 20000);

  test('maintains conversation context across turns', async () => {
    const first = await request(app)
      .post('/api/agent/search')
      .send({ message: 'show me smartphones' });
    const { sessionId } = first.body;

    const second = await request(app)
      .post('/api/agent/search')
      .send({ sessionId, message: 'show me cheaper options' });
    expect(second.body.sessionId).toBe(sessionId);

    const convo = await request(app).get(`/api/agent/conversation/${sessionId}`);
    expect(convo.status).toBe(200);
    expect(convo.body.turns.length).toBeGreaterThanOrEqual(4); // 2 user + 2 agent
  }, 30000);

  test('missing message returns 400', async () => {
    const res = await request(app).post('/api/agent/search').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_message');
  });
});
