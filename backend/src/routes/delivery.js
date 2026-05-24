// Challenge 11 — Delivery with Geolocation
// Valkey: GEOADD / GEOSEARCH / GEODIST (geospatial), JSON.SET/JSON.GET (tracking docs),
// PUBLISH + SUBSCRIBE (real-time location stream over SSE).
const express = require('express');
const client = require('../valkey');
const { sendError, parseJsonGet } = require('../lib/respond');
const { validateLatLng, DELIVERY_STATUSES } = require('../lib/contracts');

const router = express.Router();

// Geo set key names (shared convention).
const WAREHOUSES_KEY = 'warehouses';
const AGENTS_KEY = 'delivery_agents';
const SERVICE_RADIUS_KM = 15; // a customer is serviceable if a warehouse is within this radius
const AVG_SPEED_KMPH = 30; // city average for ETA estimates

const trackingKey = (id) => id; // tracking doc key IS the trackingId
const channel = (id) => `delivery:location:${id}`;

// ---- helpers ---------------------------------------------------------------

// Haversine great-circle distance in km (used for ETA between arbitrary points).
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function etaFor(distanceKm) {
  const minutes = (distanceKm / AVG_SPEED_KMPH) * 60;
  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    etaMinutes: Math.ceil(minutes),
    estimatedArrival: new Date(Date.now() + minutes * 60_000).toISOString(),
  };
}

async function getTracking(id) {
  const raw = await client.call('JSON.GET', trackingKey(id), '$');
  return parseJsonGet(raw);
}

async function saveTracking(id, doc) {
  await client.call('JSON.SET', trackingKey(id), '$', JSON.stringify(doc));
}

// Parse a "lat,lng" query param into {lat,lng}, or null.
function parsePair(value) {
  if (!value || typeof value !== 'string') return null;
  const [lat, lng] = value.split(',').map((s) => s.trim());
  return validateLatLng(lat, lng);
}

// ---- routes ----------------------------------------------------------------
// NOTE: static paths are declared BEFORE the /:trackingId param route, otherwise
// Express would match "check-serviceability" / "eta" as a trackingId.

// GET /api/delivery/check-serviceability?lat=&lng=
// Finds the nearest warehouse within SERVICE_RADIUS_KM of the customer.
router.get('/check-serviceability', async (req, res) => {
  const point = validateLatLng(req.query.lat, req.query.lng);
  if (!point) {
    return sendError(res, 400, 'invalid_coordinates', 'lat and lng are required and must be valid.');
  }
  const rows = await client.call(
    'GEOSEARCH', WAREHOUSES_KEY,
    'FROMLONLAT', point.lng, point.lat,
    'BYRADIUS', SERVICE_RADIUS_KM, 'km',
    'ASC', 'COUNT', 3, 'WITHDIST', 'WITHCOORD'
  );
  // rows: [ [member, dist, [lng, lat]], ... ]
  const warehouses = rows.map(([id, dist, coord]) => ({
    warehouseId: id,
    distanceKm: Number(dist),
    lat: Number(coord[1]),
    lng: Number(coord[0]),
  }));
  return res.json({
    serviceable: warehouses.length > 0,
    radiusKm: SERVICE_RADIUS_KM,
    nearestWarehouse: warehouses[0] || null,
    warehouses,
  });
});

// GET /api/delivery/eta?from=lat,lng&to=lat,lng
router.get('/eta', async (req, res) => {
  const from = parsePair(req.query.from);
  const to = parsePair(req.query.to);
  if (!from || !to) {
    return sendError(
      res, 400, 'invalid_coordinates',
      'from and to are required as "lat,lng" pairs.'
    );
  }
  return res.json({ from, to, avgSpeedKmph: AVG_SPEED_KMPH, ...etaFor(haversineKm(from, to)) });
});

// GET /api/delivery/:trackingId/track  — Server-Sent Events live stream
router.get('/:trackingId/track', async (req, res) => {
  const { trackingId } = req.params;
  const doc = await getTracking(trackingId);
  if (!doc) {
    return sendError(res, 404, 'tracking_not_found', `No delivery found for ${trackingId}.`);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  // Initial snapshot.
  res.write(`event: snapshot\ndata: ${JSON.stringify(doc)}\n\n`);

  // Dedicated subscriber connection (SUBSCRIBE blocks the connection it runs on).
  const sub = client.duplicate();
  const ch = channel(trackingId);
  await sub.subscribe(ch);
  sub.on('message', (incoming, msg) => {
    if (incoming === ch) res.write(`event: location\ndata: ${msg}\n\n`);
  });

  // Heartbeat keeps proxies from closing the idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sub.unsubscribe(ch).finally(() => sub.quit());
    res.end();
  });
});

// POST /api/delivery/:trackingId/location  — agent pushes a location update
// body: { lat, lng, status?, agentId? }
router.post('/:trackingId/location', async (req, res) => {
  const { trackingId } = req.params;
  const { status, agentId } = req.body || {};
  const point = validateLatLng(req.body?.lat, req.body?.lng);
  if (!point) {
    return sendError(res, 400, 'invalid_coordinates', 'lat and lng are required and must be valid.');
  }
  if (status && !DELIVERY_STATUSES.includes(status)) {
    return sendError(res, 400, 'invalid_status', `status must be one of: ${DELIVERY_STATUSES.join(', ')}`);
  }

  const doc = await getTracking(trackingId);
  if (!doc) {
    return sendError(res, 404, 'tracking_not_found', `No delivery found for ${trackingId}.`);
  }

  const timestamp = new Date().toISOString();
  doc.currentLocation = { lat: point.lat, lng: point.lng };
  if (status) doc.status = status;
  doc.history.push({ status: doc.status, timestamp, lat: point.lat, lng: point.lng });

  // Recompute ETA from current position to drop location.
  let eta = null;
  if (doc.dropLocation) {
    eta = etaFor(haversineKm(point, doc.dropLocation));
    doc.estimatedArrival = eta.estimatedArrival;
  }

  await saveTracking(trackingId, doc);

  // Update the agent's position in the geo index.
  const agent = agentId || doc.agentId;
  if (agent) await client.call('GEOADD', AGENTS_KEY, point.lng, point.lat, agent);

  // Broadcast to any SSE subscribers.
  await client.publish(
    channel(trackingId),
    JSON.stringify({ trackingId, status: doc.status, location: doc.currentLocation, eta, timestamp })
  );

  return res.json({ ok: true, tracking: doc, eta });
});

// GET /api/delivery/:trackingId  — current delivery status + location
router.get('/:trackingId', async (req, res) => {
  const doc = await getTracking(req.params.trackingId);
  if (!doc) {
    return sendError(res, 404, 'tracking_not_found', `No delivery found for ${req.params.trackingId}.`);
  }
  return res.json(doc);
});

module.exports = router;
