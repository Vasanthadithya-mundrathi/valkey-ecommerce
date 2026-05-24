// Shared seed data. Run with `npm run seed` (Valkey must be running).
// Covers: Challenge 11 (warehouses/agents/tracking) and a small product catalog
// used by Challenge 13 (recommendations). Other challenges can extend this file.
const client = require('../valkey');

// ---- Challenge 11: delivery geo + tracking ---------------------------------
const WAREHOUSES = [
  { id: 'HYD-WH-01', lng: 78.4347, lat: 17.4156 },
  { id: 'HYD-WH-02', lng: 78.3772, lat: 17.4435 },
  { id: 'HYD-WH-03', lng: 78.4867, lat: 17.385 },
];

const AGENTS = [
  { id: 'agent_raj_001', lng: 78.41, lat: 17.43 },
  { id: 'agent_kumar_002', lng: 78.45, lat: 17.42 },
];

const TRACKINGS = [
  {
    trackingId: 'DEL-HYD-98765',
    orderId: 'order:0192d4e8-5e6f-7c8d-8a0b-2c3d4e5f6a7b',
    agentId: 'agent_raj_001',
    status: 'in_transit',
    pickupLocation: { lat: 17.4156, lng: 78.4347 },
    dropLocation: { lat: 17.43, lng: 78.41 },
    currentLocation: { lat: 17.42, lng: 78.42 },
    estimatedArrival: new Date(Date.now() + 30 * 60_000).toISOString(),
    history: [
      { status: 'picked_up', timestamp: '2025-05-22T10:00:00Z', lat: 17.4156, lng: 78.4347 },
      { status: 'in_transit', timestamp: '2025-05-22T10:15:00Z', lat: 17.42, lng: 78.42 },
    ],
  },
];

// ---- Product catalog (shared; minimal subset of the Challenge 2 contract) --
const CAT = {
  smartphones: 'category:0192d4e2-3a7b-7e1f-8c4d-2b6a9f0e5d7c',
  electronics: 'category:0192d4e2-1f5a-7c3d-9b2e-8a4f6d0c1e3b',
  fashion: 'category:0192d4e3-7b1c-7d4e-8a2f-9c3b5d6e0f1a',
  home: 'category:0192d4e4-1a2b-7c3d-8e4f-5a6b7c8d9e0f',
  sports: 'category:0192d4e5-5e6f-7a7b-8c8d-9e0f1a2b3c4d',
};

const PRODUCTS = [
  { id: 'product:p-galaxy', name: 'Galaxy Ultra Pro 256GB', categoryId: CAT.smartphones, brand: 'Samsung', price: 89999, image: '/assets/images/thumbs/product-two-img1.png', rating: 4.6 },
  { id: 'product:p-iphone', name: 'iPhone Pro Max 256GB', categoryId: CAT.smartphones, brand: 'Apple', price: 129999, image: '/assets/images/thumbs/product-two-img2.png', rating: 4.8 },
  { id: 'product:p-pixel', name: 'Pixel 9 Pro', categoryId: CAT.smartphones, brand: 'Google', price: 79999, image: '/assets/images/thumbs/product-two-img3.png', rating: 4.5 },
  { id: 'product:p-buds', name: 'Wireless Noise-Cancel Earbuds', categoryId: CAT.electronics, brand: 'Sony', price: 14999, image: '/assets/images/thumbs/product-two-img4.png', rating: 4.4 },
  { id: 'product:p-watch', name: 'Smart Watch Series 7', categoryId: CAT.electronics, brand: 'Samsung', price: 24999, image: '/assets/images/thumbs/product-two-img5.png', rating: 4.3 },
  { id: 'product:p-tshirt', name: 'Cotton Crew T-Shirt', categoryId: CAT.fashion, brand: 'Urban', price: 999, image: '/assets/images/thumbs/product-two-img6.png', rating: 4.1 },
  { id: 'product:p-blender', name: 'Pro Kitchen Blender', categoryId: CAT.home, brand: 'HomeMax', price: 4999, image: '/assets/images/thumbs/product-two-img7.png', rating: 4.2 },
  { id: 'product:p-ball', name: 'Official Match Football', categoryId: CAT.sports, brand: 'KickPro', price: 1999, image: '/assets/images/thumbs/product-two-img8.png', rating: 4.0 },
];

function fullProduct(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    categoryId: p.categoryId,
    brand: p.brand,
    price: { amount: p.price, currency: 'INR', compareAt: Math.round(p.price * 1.15) },
    images: [{ url: p.image, alt: p.name, isPrimary: true }],
    tags: [p.brand.toLowerCase()],
    ratings: { average: p.rating, count: 100 + Math.round(p.rating * 50) },
    inventory: { quantity: 120, reserved: 0, warehouse: 'HYD-WH-01' },
    status: 'active',
  };
}

async function seedDelivery() {
  for (const w of WAREHOUSES) await client.call('GEOADD', 'warehouses', w.lng, w.lat, w.id);
  for (const a of AGENTS) await client.call('GEOADD', 'delivery_agents', a.lng, a.lat, a.id);
  for (const t of TRACKINGS) {
    await client.call('JSON.SET', t.trackingId, '$', JSON.stringify(t));
    await client.set(`order_tracking:${t.orderId}`, t.trackingId);
  }
  return { warehouses: WAREHOUSES.length, agents: AGENTS.length, trackings: TRACKINGS.length };
}

async function seedCatalog() {
  for (const p of PRODUCTS) {
    await client.call('JSON.SET', p.id, '$', JSON.stringify(fullProduct(p)));
    await client.sadd(`category_products:${p.categoryId}`, p.id);
    // Baseline global trending so "trending-for-you" isn't empty before any events.
    await client.zadd('trending:global:24h', p.rating, p.id);
  }
  return { products: PRODUCTS.length };
}

async function run() {
  const d = await seedDelivery();
  const c = await seedCatalog();
  // eslint-disable-next-line no-console
  console.log('Seeded:', { ...d, ...c });
  await client.quit();
}

if (require.main === module) {
  run().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedDelivery, seedCatalog, WAREHOUSES, AGENTS, TRACKINGS, PRODUCTS, CAT };
