// Challenge 12 — Rate Limiting tests.
const request = require('supertest');
const app = require('../src/index');
const client = require('../src/valkey');

const USER = 'user:test-rl';
const KEY = `ratelimit:sliding:${USER}:/api/ratelimit/test`;

beforeAll(async () => {
  await client.del(KEY); // isolate from previous runs within the window
});
afterAll(async () => {
  await client.del(KEY);
  await client.quit();
});

describe('GET /api/ratelimit/test', () => {
  test('allows up to the authenticated limit, then returns 429', async () => {
    const limit = 6; // authenticated limit for this endpoint
    const headers = { 'x-user-id': USER };

    for (let i = 0; i < limit; i++) {
      const ok = await request(app).get('/api/ratelimit/test').set(headers);
      expect(ok.status).toBe(200);
      expect(ok.headers['x-ratelimit-limit']).toBe(String(limit));
      expect(Number(ok.headers['x-ratelimit-remaining'])).toBe(limit - i - 1);
    }

    const blocked = await request(app).get('/api/ratelimit/test').set(headers);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('rate_limit_exceeded');
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  test('anonymous users get a stricter limit than authenticated', async () => {
    const cfg = await request(app).get('/api/ratelimit/config');
    expect(cfg.status).toBe(200);
    expect(cfg.body['/api/ratelimit/test'].anonymous).toBeLessThan(
      cfg.body['/api/ratelimit/test'].authenticated
    );
  });
});
