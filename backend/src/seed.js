'use strict';

// A handful of demo products so the live page has something to interact with
// out of the box. In a real system this would be sourced from the catalog
// service (Challenge 2). The IDs follow the `domain:uuidv7` convention from
// HACKATHON.md.

const DEMO_PRODUCTS = [
  {
    id: 'product:0192d4e6-2c4e-7a6b-8d8f-0a1b2c3d4e5f',
    name: 'Galaxy Ultra Pro 256GB',
    price: 89999,
    initialStock: 25,
  },
  {
    id: 'product:0192d4e6-3d5f-7b8c-9e0a-1b2c3d4e5f6a',
    name: 'AirSound Pro Earbuds',
    price: 12999,
    initialStock: 80,
  },
  {
    id: 'product:0192d4e6-4e6a-7c9d-8f1b-2c3d4e5f6a7b',
    name: 'TitanFit Smart Watch',
    price: 8499,
    initialStock: 50,
  },
  {
    id: 'product:0192d4e6-5f7b-7d0e-9a2c-3d4e5f6a7b8c',
    name: 'AeroBook 14 Laptop',
    price: 64999,
    initialStock: 12,
  },
  {
    id: 'product:0192d4e6-6a8c-7e1f-8b3d-4e5f6a7b8c9d',
    name: 'BrewMaster Coffee Machine',
    price: 18999,
    initialStock: 30,
  },
  {
    id: 'product:0192d4e6-7b9d-7f2a-9c4e-5f6a7b8c9d0e',
    name: 'GlowLite Smart Bulb (4-pack)',
    price: 1499,
    initialStock: 200,
  },
];

/**
 * @param {{ inventory: import('./inventory').InventoryService, valkey: any }} deps
 */
async function seedDemoData({ inventory, valkey }) {
  // Cache the catalog as JSON so the frontend can fetch product names
  // without setting up a full catalog service.
  await valkey.set('demo:catalog', JSON.stringify(DEMO_PRODUCTS));

  for (const p of DEMO_PRODUCTS) {
    const existing = await inventory.get(p.id);
    if (existing > 0) continue; // don't reset stock if the demo restarts
    await inventory.setStock(p.id, p.initialStock);
  }
}

async function getDemoCatalog(valkey) {
  const raw = await valkey.get('demo:catalog');
  return raw ? JSON.parse(raw) : DEMO_PRODUCTS;
}

module.exports = { seedDemoData, getDemoCatalog, DEMO_PRODUCTS };
