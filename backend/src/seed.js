'use strict';

// Demo data shared across challenges 4, 5, 6 so trending, ads, and search all
// have something coherent to operate on. IDs follow the `domain:uuidv7`
// convention from HACKATHON.md.

const CATEGORIES = [
  { id: 'category:electronics', name: 'Electronics', slug: 'electronics' },
  { id: 'category:smartphones', name: 'Smartphones', slug: 'smartphones', parentId: 'category:electronics' },
  { id: 'category:audio', name: 'Audio', slug: 'audio', parentId: 'category:electronics' },
  { id: 'category:wearables', name: 'Wearables', slug: 'wearables', parentId: 'category:electronics' },
  { id: 'category:laptops', name: 'Laptops', slug: 'laptops', parentId: 'category:electronics' },
  { id: 'category:home', name: 'Home & Kitchen', slug: 'home-kitchen' },
];

const DEMO_PRODUCTS = [
  {
    id: 'product:0192d4e6-2c4e-7a6b-8d8f-0a1b2c3d4e5f',
    sku: 'ELEC-PHN-SAM-001',
    name: 'Galaxy Ultra Pro 256GB',
    brand: 'Samsung',
    description:
      'Flagship Samsung Galaxy smartphone with a 200MP camera, a 6.8-inch AMOLED display and a 5000mAh battery.',
    categoryId: 'category:smartphones',
    tags: ['smartphone', '5g', 'flagship', 'camera', 'samsung', 'phone'],
    price: { amount: 89999, currency: 'INR', compareAt: 99999 },
    ratings: { average: 4.6, count: 2341 },
    initialStock: 25,
  },
  {
    id: 'product:0192d4e6-3d5f-7b8c-9e0a-1b2c3d4e5f6a',
    sku: 'ELEC-AUD-AIR-002',
    name: 'AirSound Pro Earbuds',
    brand: 'AirSound',
    description:
      'Wireless earbuds with active noise cancellation, transparency mode and 30 hours of battery life.',
    categoryId: 'category:audio',
    tags: ['earbuds', 'wireless', 'audio', 'noise-cancelling'],
    price: { amount: 12999, currency: 'INR', compareAt: 14999 },
    ratings: { average: 4.4, count: 870 },
    initialStock: 80,
  },
  {
    id: 'product:0192d4e6-4e6a-7c9d-8f1b-2c3d4e5f6a7b',
    sku: 'ELEC-WEAR-TFT-003',
    name: 'TitanFit Smart Watch',
    brand: 'TitanFit',
    description:
      'A smart watch with continuous heart-rate tracking, blood-oxygen monitoring, GPS and a 14-day battery.',
    categoryId: 'category:wearables',
    tags: ['smartwatch', 'wearable', 'fitness', 'health'],
    price: { amount: 8499, currency: 'INR' },
    ratings: { average: 4.2, count: 540 },
    initialStock: 50,
  },
  {
    id: 'product:0192d4e6-5f7b-7d0e-9a2c-3d4e5f6a7b8c',
    sku: 'ELEC-LAP-AERO-004',
    name: 'AeroBook 14 Laptop',
    brand: 'AeroBook',
    description:
      'Ultra-light 14-inch laptop with a 2K display, 16GB RAM, 1TB SSD and 18 hours of battery life.',
    categoryId: 'category:laptops',
    tags: ['laptop', 'ultrabook', 'computer', 'work'],
    price: { amount: 64999, currency: 'INR', compareAt: 74999 },
    ratings: { average: 4.5, count: 312 },
    initialStock: 12,
  },
  {
    id: 'product:0192d4e6-6a8c-7e1f-8b3d-4e5f6a7b8c9d',
    sku: 'HOME-COFFEE-BRW-005',
    name: 'BrewMaster Coffee Machine',
    brand: 'BrewMaster',
    description:
      'Bean-to-cup espresso machine with built-in grinder, milk frother and programmable presets.',
    categoryId: 'category:home',
    tags: ['coffee', 'kitchen', 'espresso', 'home', 'appliance'],
    price: { amount: 18999, currency: 'INR' },
    ratings: { average: 4.7, count: 188 },
    initialStock: 30,
  },
  {
    id: 'product:0192d4e6-7b9d-7f2a-9c4e-5f6a7b8c9d0e',
    sku: 'HOME-LIGHT-GLO-006',
    name: 'GlowLite Smart Bulb (4-pack)',
    brand: 'GlowLite',
    description:
      'Smart Wi-Fi LED bulbs with 16 million colors, voice-assistant support and scheduling.',
    categoryId: 'category:home',
    tags: ['smart-home', 'lighting', 'iot', 'home'],
    price: { amount: 1499, currency: 'INR' },
    ratings: { average: 4.1, count: 412 },
    initialStock: 200,
  },
  {
    id: 'product:0192d4e6-8c0e-7a3b-9d4f-5e6a7b8c9d0f',
    sku: 'ELEC-PHN-PXG-007',
    name: 'Pixel Glow 8 Pro',
    brand: 'Pixel',
    description:
      'Pure-Android phone with computational photography, 6.7-inch LTPO display and 7 years of OS updates.',
    categoryId: 'category:smartphones',
    tags: ['smartphone', '5g', 'android', 'phone', 'pixel'],
    price: { amount: 79999, currency: 'INR', compareAt: 84999 },
    ratings: { average: 4.5, count: 1102 },
    initialStock: 18,
  },
  {
    id: 'product:0192d4e6-9d1f-7b4c-8e5a-6f7b8c9d0e1f',
    sku: 'ELEC-LAP-PRO-008',
    name: 'ProMatte 16 Studio',
    brand: 'AeroBook',
    description:
      'Creator laptop with a 16-inch mini-LED display, discrete GPU, 32GB RAM and a color-accurate panel.',
    categoryId: 'category:laptops',
    tags: ['laptop', 'creator', 'computer', 'studio'],
    price: { amount: 154999, currency: 'INR' },
    ratings: { average: 4.6, count: 96 },
    initialStock: 6,
  },
];

const DEMO_ADS = [
  {
    id: 'ad:0192d4e9-6f7a-7d8e-9b0c-3d4e5f6a7b8c',
    vendorId: 'vendor:samsung',
    title: 'Samsung Summer Days — up to 20% off flagship phones',
    imageUrl: '/assets/images/banner/banner-img1.png',
    targetUrl: '/shop?brand=samsung',
    targetCategories: ['category:smartphones', 'category:electronics'],
    targetKeywords: ['phone', 'galaxy', 'samsung', 'smartphone', '5g'],
    bidAmount: 850,
    dailyBudget: 50000,
    status: 'active',
  },
  {
    id: 'ad:0192d4e9-7a8b-7e9f-9c0d-4e5f6a7b8c9d',
    vendorId: 'vendor:airsound',
    title: 'AirSound Pro — flat ₹2000 off this week',
    imageUrl: '/assets/images/banner/banner-img2.png',
    targetUrl: '/shop?brand=airsound',
    targetCategories: ['category:audio', 'category:electronics'],
    targetKeywords: ['earbuds', 'audio', 'wireless', 'headphones'],
    bidAmount: 600,
    dailyBudget: 25000,
    status: 'active',
  },
  {
    id: 'ad:0192d4e9-8b9c-7f0a-9d1e-5f6a7b8c9d0e',
    vendorId: 'vendor:aerobook',
    title: 'AeroBook 14 — student exchange offer',
    imageUrl: '/assets/images/banner/banner-img3.png',
    targetUrl: '/shop?brand=aerobook',
    targetCategories: ['category:laptops', 'category:electronics'],
    targetKeywords: ['laptop', 'ultrabook', 'computer', 'student'],
    bidAmount: 720,
    dailyBudget: 40000,
    status: 'active',
  },
  {
    id: 'ad:0192d4e9-9c0d-7a1b-9e2f-6a7b8c9d0e1f',
    vendorId: 'vendor:brewmaster',
    title: 'BrewMaster — barista-grade coffee at home',
    imageUrl: '/assets/images/banner/banner-img4.png',
    targetUrl: '/shop?brand=brewmaster',
    targetCategories: ['category:home'],
    targetKeywords: ['coffee', 'espresso', 'kitchen', 'appliance'],
    bidAmount: 400,
    dailyBudget: 15000,
    status: 'active',
  },
];

/**
 * @param {{ inventory: import('./inventory').InventoryService, valkey: any }} deps
 */
async function seedDemoData({ inventory, valkey, ads, search }) {
  await valkey.set('demo:catalog', JSON.stringify(DEMO_PRODUCTS));
  await valkey.set('demo:categories', JSON.stringify(CATEGORIES));

  for (const p of DEMO_PRODUCTS) {
    const existing = await inventory.get(p.id);
    if (existing > 0) continue;
    await inventory.setStock(p.id, p.initialStock);
  }

  if (ads) {
    for (const ad of DEMO_ADS) {
      // Don't reseed if the ad already exists; this preserves counters between
      // restarts.
      const existing = await ads.get(ad.id);
      if (existing) continue;
      await ads.create(ad);
    }
  }

  if (search) {
    await search.indexAll(DEMO_PRODUCTS);
  }
}

async function getDemoCatalog(valkey) {
  const raw = await valkey.get('demo:catalog');
  return raw ? JSON.parse(raw) : DEMO_PRODUCTS;
}

async function getDemoCategories(valkey) {
  const raw = await valkey.get('demo:categories');
  return raw ? JSON.parse(raw) : CATEGORIES;
}

module.exports = {
  seedDemoData,
  getDemoCatalog,
  getDemoCategories,
  DEMO_PRODUCTS,
  DEMO_ADS,
  CATEGORIES,
};
