import type { Product } from "./types";

const now = "2026-05-24T00:00:00.000Z";
const categoryId = "category:0192d4e2-3a7b-7e1f-8c4d-2b6a9f0e5d7c";
const vendorId = "vendor:0192d4e7-4d5e-7b7c-9e9f-1a2b3c4d5e6f";

function product(
  index: number,
  name: string,
  price: number,
  quantity: number,
  searchTerms: string[],
  attributes: Record<string, string | number | boolean> = {}
): Product {
  const suffix = String(index).padStart(12, "0");

  return {
    id: `product:0192d4e6-2c4e-7a6b-8d8f-${suffix}`,
    sku: `VALKEY-DEMO-${String(index).padStart(3, "0")}`,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    description: `${name} seeded for the BullMQ checkout integration demo with ${searchTerms.join(", ")}.`,
    shortDescription: searchTerms.slice(0, 4).join(" "),
    categoryId,
    vendorId,
    brand: "Valkey Demo",
    price: {
      amount: price,
      currency: "INR",
      compareAt: Math.round(price * 1.12),
    },
    images: [
      {
        url: "/assets/images/thumbs/product-img1.png",
        alt: name,
        isPrimary: true,
      },
    ],
    attributes: {
      integration: "BullMQ",
      ...attributes,
    },
    tags: ["valkey", "checkout", "demo", ...searchTerms],
    inventory: {
      quantity,
      reserved: 0,
      warehouse: "HYD-WH-01",
    },
    ratings: {
      average: 4.6,
      count: 100 + index,
    },
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export const PRODUCT_FIXTURES: Product[] = [
  product(1, "Valkey Wireless Keyboard", 2499, 25, ["typing", "keys", "wireless", "desk"], { color: "Graphite" }),
  product(2, "Valkey Ergonomic Mouse", 1499, 30, ["cursor", "ergonomic", "wireless", "desk"], { color: "Green" }),
  product(3, "Valkey USB-C Hub", 3299, 18, ["adapter", "ports", "dock", "usb"], { ports: 7 }),
  product(4, "Valkey Studio Headphones", 5499, 12, ["audio", "sound", "music", "studio"], { color: "Black" }),
  product(5, "Valkey Desk Lamp", 1999, 20, ["lighting", "reading", "office", "desk"], { color: "White" }),
  product(6, "Valkey Smart Bottle", 1199, 35, ["hydration", "water", "smart", "travel"], { color: "Blue" }),
  product(7, "Valkey Laptop Stand", 2799, 22, ["laptop", "stand", "ergonomic", "portable"], { color: "Silver" }),
  product(8, "Valkey Travel Charger", 1899, 28, ["power", "charger", "travel", "adapter"], { watts: 65 }),
  product(9, "Valkey Notebook Set", 699, 45, ["paper", "notes", "writing", "office"], { color: "Green" }),
  product(10, "Valkey Backpack", 3999, 16, ["bag", "carry", "travel", "laptop"], { color: "Navy" }),
];
