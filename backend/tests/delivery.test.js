// Challenge 11 — Delivery + Geo API tests.
// Requires a running valkey-bundle (JSON + GEO modules):
//   docker run -d --name valkey -p 6379:6379 valkey/valkey-bundle:9-alpine
const request = require('supertest');
const app = require('../src/index');
const client = require('../src/valkey');
const { seedDelivery, TRACKINGS } = require('../src/seed/seed');

const TRACK = TRACKINGS[0].trackingId; // 'DEL-HYD-98765'

beforeAll(async () => {
  await seedDelivery();
});

afterAll(async () => {
  await client.quit();
});

describe('GET /api/delivery/check-serviceability', () => {
  test('address near a Hyderabad warehouse is serviceable', async () => {
    const res = await request(app).get('/api/delivery/check-serviceability?lat=17.4156&lng=78.4347');
    expect(res.status).toBe(200);
    expect(res.body.serviceable).toBe(true);
    expect(res.body.nearestWarehouse).toHaveProperty('warehouseId');
    expect(res.body.nearestWarehouse.distanceKm).toBeLessThanOrEqual(res.body.radiusKm);
  });

  test('far-away address is not serviceable', async () => {
    const res = await request(app).get('/api/delivery/check-serviceability?lat=0&lng=0');
    expect(res.status).toBe(200);
    expect(res.body.serviceable).toBe(false);
    expect(res.body.nearestWarehouse).toBeNull();
  });

  test('missing coordinates return 400', async () => {
    const res = await request(app).get('/api/delivery/check-serviceability');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_coordinates');
  });
});

describe('GET /api/delivery/eta', () => {
  test('computes distance and ETA between two points', async () => {
    const res = await request(app).get('/api/delivery/eta?from=17.4156,78.4347&to=17.43,78.41');
    expect(res.status).toBe(200);
    expect(res.body.distanceKm).toBeGreaterThan(0);
    expect(res.body.etaMinutes).toBeGreaterThan(0);
    expect(typeof res.body.estimatedArrival).toBe('string');
  });
});

describe('GET /api/delivery/:trackingId', () => {
  test('returns the seeded tracking document', async () => {
    const res = await request(app).get(`/api/delivery/${TRACK}`);
    expect(res.status).toBe(200);
    expect(res.body.trackingId).toBe(TRACK);
    expect(res.body).toHaveProperty('currentLocation.lat');
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  test('unknown trackingId returns 404', async () => {
    const res = await request(app).get('/api/delivery/DEL-DOES-NOT-EXIST');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tracking_not_found');
  });
});

describe('POST /api/delivery/:trackingId/location', () => {
  test('persists a new location, appends history, and recomputes ETA', async () => {
    const res = await request(app)
      .post(`/api/delivery/${TRACK}/location`)
      .send({ lat: 17.4285, lng: 78.412, status: 'in_transit' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tracking.currentLocation).toEqual({ lat: 17.4285, lng: 78.412 });
    expect(res.body.eta.etaMinutes).toBeGreaterThanOrEqual(0);

    // Re-read to confirm it was actually stored in Valkey.
    const after = await request(app).get(`/api/delivery/${TRACK}`);
    expect(after.body.currentLocation).toEqual({ lat: 17.4285, lng: 78.412 });
    expect(after.body.history.length).toBeGreaterThanOrEqual(3);
  });

  test('invalid coordinates return 400', async () => {
    const res = await request(app)
      .post(`/api/delivery/${TRACK}/location`)
      .send({ lat: 999, lng: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_coordinates');
  });

  test('invalid status returns 400', async () => {
    const res = await request(app)
      .post(`/api/delivery/${TRACK}/location`)
      .send({ lat: 17.42, lng: 78.42, status: 'teleporting' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
  });
});
