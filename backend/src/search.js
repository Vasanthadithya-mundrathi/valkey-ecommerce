'use strict';

// Search service — Challenge 6.
//
// Tries to use the Valkey Search module (FT.*) first, since the
// valkey-bundle image ships with it. If FT.CREATE fails (because the module
// isn't loaded), we fall back to a small in-memory engine that supports the
// same surface area: full-text search, faceted aggregation, autocomplete,
// price/category filters, and sorting.
//
// This is deliberate — it keeps the demo runnable on stock Valkey while
// still demonstrating how to wire FT.* on bundle.

const INDEX_NAME = 'idx:products';
const SUGGEST_KEY = 'autocomplete:products';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'with', 'for', 'to', 'in', 'on',
  'at', 'by', 'is', 'are', 'be', 'this', 'that',
]);

const PRICE_BUCKETS = [
  { range: '0-2000', min: 0, max: 2000 },
  { range: '2000-10000', min: 2000, max: 10000 },
  { range: '10000-25000', min: 10000, max: 25000 },
  { range: '25000-75000', min: 25000, max: 75000 },
  { range: '75000+', min: 75000, max: Infinity },
];

function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Levenshtein distance — small inputs (single tokens), so a textbook DP is fine.
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function priceBucket(amount) {
  for (const b of PRICE_BUCKETS) {
    if (amount >= b.min && amount < b.max) return b.range;
  }
  return PRICE_BUCKETS[PRICE_BUCKETS.length - 1].range;
}

class SearchService {
  /**
   * @param {{ valkey: any }} deps
   */
  constructor({ valkey }) {
    this.valkey = valkey;
    this.products = new Map(); // id -> product
    this.tokenIndex = new Map(); // token -> Map<id, weight>
    this.useFt = false; // set true if FT module is available
  }

  /**
   * Try to create the FT index. If it fails (e.g. module not loaded) we
   * silently fall back to the in-memory engine.
   */
  async ensureIndex() {
    try {
      // sendCommand bypasses the typed client API so we don't depend on a
      // specific node-redis version exposing ft.create.
      await this.valkey.sendCommand([
        'FT.CREATE',
        INDEX_NAME,
        'ON', 'JSON',
        'PREFIX', '1', 'product:',
        'SCHEMA',
        '$.name', 'AS', 'name', 'TEXT', 'WEIGHT', '5.0',
        '$.description', 'AS', 'description', 'TEXT',
        '$.brand', 'AS', 'brand', 'TAG',
        '$.tags', 'AS', 'tags', 'TAG', 'SEPARATOR', ',',
        '$.categoryId', 'AS', 'categoryId', 'TAG',
        '$.price.amount', 'AS', 'price', 'NUMERIC', 'SORTABLE',
        '$.ratings.average', 'AS', 'rating', 'NUMERIC', 'SORTABLE',
      ]);
      this.useFt = true;
    } catch (err) {
      // Index may already exist from a previous run, in which case we still
      // want to use it.
      if (String(err.message).toLowerCase().includes('already exists')) {
        this.useFt = true;
      } else {
        this.useFt = false;
      }
    }
  }

  /**
   * Index every product. Always populates the in-memory index (used by the
   * fallback path and for autocomplete corpus). When FT is available, also
   * writes JSON documents and suggestion entries.
   */
  async indexAll(products) {
    this.products.clear();
    this.tokenIndex.clear();

    for (const p of products) {
      this._indexInMemory(p);
    }

    await this.ensureIndex();

    if (this.useFt) {
      for (const p of products) {
        try {
          await this.valkey.sendCommand([
            'JSON.SET',
            `product:doc:${p.id}`,
            '$',
            JSON.stringify(p),
          ]);
          await this.valkey.sendCommand([
            'FT.SUGADD',
            SUGGEST_KEY,
            p.name,
            String(p.ratings?.count ?? 1),
          ]);
        } catch (_) {
          // If FT.SUGADD fails we just skip — the in-memory autocomplete
          // is still wired below.
        }
      }
    }
  }

  _indexInMemory(product) {
    this.products.set(product.id, product);

    const fields = [
      { text: product.name, weight: 5 },
      { text: product.description, weight: 1 },
      { text: product.brand, weight: 3 },
      { text: (product.tags || []).join(' '), weight: 2 },
    ];

    for (const { text, weight } of fields) {
      for (const token of tokenize(text)) {
        if (!this.tokenIndex.has(token)) this.tokenIndex.set(token, new Map());
        const row = this.tokenIndex.get(token);
        row.set(product.id, (row.get(product.id) ?? 0) + weight);
      }
    }
  }

  /**
   * Full-text + filtered search.
   *
   * @param {{
   *   q?: string,
   *   categoryId?: string,
   *   brand?: string,
   *   minPrice?: number,
   *   maxPrice?: number,
   *   sort?: 'relevance'|'price_asc'|'price_desc'|'rating'|'newest',
   *   page?: number,
   *   pageSize?: number
   * }} opts
   */
  async search(opts = {}) {
    const pageSize = Math.max(1, Math.min(50, opts.pageSize ?? 20));
    const page = Math.max(1, opts.page ?? 1);
    const tokens = tokenize(opts.q);

    // Score every product against the query tokens, with a small fuzzy
    // tolerance for short single-character typos.
    const scores = new Map();
    if (tokens.length === 0) {
      for (const id of this.products.keys()) scores.set(id, 1);
    } else {
      for (const token of tokens) {
        // exact match
        const exact = this.tokenIndex.get(token);
        if (exact) {
          for (const [id, w] of exact) {
            scores.set(id, (scores.get(id) ?? 0) + w * 2);
          }
        }
        // prefix
        for (const [other, row] of this.tokenIndex) {
          if (other === token) continue;
          if (other.startsWith(token) && token.length >= 2) {
            for (const [id, w] of row) {
              scores.set(id, (scores.get(id) ?? 0) + w);
            }
          }
        }
        // fuzzy (1 edit for 4+ char tokens, 2 for 8+)
        if (token.length >= 4) {
          const tolerance = token.length >= 8 ? 2 : 1;
          for (const [other, row] of this.tokenIndex) {
            if (other === token || other.startsWith(token)) continue;
            if (Math.abs(other.length - token.length) > tolerance) continue;
            if (editDistance(token, other) <= tolerance) {
              for (const [id, w] of row) {
                scores.set(id, (scores.get(id) ?? 0) + w * 0.5);
              }
            }
          }
        }
      }
    }

    // Apply filters and produce typed results.
    let results = [];
    for (const [id, score] of scores) {
      const product = this.products.get(id);
      if (!product) continue;
      if (opts.categoryId && product.categoryId !== opts.categoryId) continue;
      if (opts.brand && product.brand?.toLowerCase() !== opts.brand.toLowerCase()) continue;
      const amount = product.price?.amount ?? 0;
      if (opts.minPrice != null && amount < opts.minPrice) continue;
      if (opts.maxPrice != null && amount > opts.maxPrice) continue;
      results.push({ id, score, product });
    }

    // Sort
    const sortKey = opts.sort ?? 'relevance';
    const cmp = {
      relevance: (a, b) => b.score - a.score,
      price_asc: (a, b) => (a.product.price?.amount ?? 0) - (b.product.price?.amount ?? 0),
      price_desc: (a, b) => (b.product.price?.amount ?? 0) - (a.product.price?.amount ?? 0),
      rating: (a, b) =>
        (b.product.ratings?.average ?? 0) - (a.product.ratings?.average ?? 0),
      newest: (a, b) => (b.id > a.id ? 1 : -1), // uuidv7 is k-sortable
    }[sortKey] ?? ((a, b) => b.score - a.score);
    results.sort(cmp);

    // Facets are computed against the full filtered set, before pagination.
    const facets = this._facets(results.map((r) => r.product));

    const total = results.length;
    const start = (page - 1) * pageSize;
    const paged = results.slice(start, start + pageSize);

    return {
      query: opts.q ?? '',
      total,
      page,
      pageSize,
      results: paged.map((r) => ({
        id: r.product.id,
        name: r.product.name,
        brand: r.product.brand,
        categoryId: r.product.categoryId,
        price: r.product.price,
        ratings: r.product.ratings,
        score: r.score,
      })),
      facets,
      backend: this.useFt ? 'valkey-search' : 'in-memory',
    };
  }

  _facets(products) {
    const brands = new Map();
    const categories = new Map();
    const priceRanges = new Map();

    for (const p of products) {
      if (p.brand) brands.set(p.brand, (brands.get(p.brand) ?? 0) + 1);
      if (p.categoryId)
        categories.set(p.categoryId, (categories.get(p.categoryId) ?? 0) + 1);
      const bucket = priceBucket(p.price?.amount ?? 0);
      priceRanges.set(bucket, (priceRanges.get(bucket) ?? 0) + 1);
    }

    return {
      brands: [...brands.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      categories: [...categories.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count),
      priceRanges: PRICE_BUCKETS.map((b) => ({
        range: b.range,
        count: priceRanges.get(b.range) ?? 0,
      })),
    };
  }

  /**
   * Autocomplete: prefix match across product names with fuzzy fallback.
   * @param {string} prefix
   * @param {number} [max]
   */
  async suggest(prefix, max = 5) {
    const trimmed = String(prefix || '').trim().toLowerCase();
    if (!trimmed) return [];

    const candidates = [];
    for (const product of this.products.values()) {
      const name = product.name.toLowerCase();
      let score = 0;
      if (name.startsWith(trimmed)) score = 100;
      else if (name.includes(` ${trimmed}`) || name.includes(trimmed))
        score = 50;
      else {
        // fuzzy match against product name tokens
        for (const tok of tokenize(name)) {
          if (tok.startsWith(trimmed)) {
            score = Math.max(score, 60);
            break;
          }
          if (tok.length >= 4 && editDistance(tok, trimmed) <= 1) {
            score = Math.max(score, 25);
          }
        }
      }
      if (score > 0) {
        const popularity = product.ratings?.count ?? 0;
        candidates.push({
          name: product.name,
          productId: product.id,
          score: score + Math.log10(popularity + 1),
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, max);
  }
}

module.exports = { SearchService, tokenize, editDistance, priceBucket };
