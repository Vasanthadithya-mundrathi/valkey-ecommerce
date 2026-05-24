import { createValkeyClient } from "./connection";
import { loadConfig } from "./config";
import { createEmbeddingClient } from "./embeddings";
import { ensureProductVectorIndex, upsertProductEmbeddings } from "./search";
import { seedCoupons } from "./cart";
import { seedCatalog } from "./catalog";
import { listProducts } from "./store";

async function main() {
  const client = createValkeyClient();
  try {
    const config = loadConfig();
    const embeddingClient = createEmbeddingClient(config.embeddingServiceUrl);
    await client.call("FT.DROPINDEX", "idx:product_vectors").catch(() => undefined);
    await seedCatalog(client);
    await seedCoupons(client);
    const products = await listProducts(client);
    await upsertProductEmbeddings(client, products, embeddingClient.embedText);
    const vectorIndexReady = await ensureProductVectorIndex(client);
    console.log(JSON.stringify({ seededProducts: products.length, firstProductId: products[0]?.id, vectorIndexReady }));
  } finally {
    await client.quit();
  }
}

void main();
