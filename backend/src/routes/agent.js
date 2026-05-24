// Challenge 14 — Agentic Search (Google Gemini + Valkey).
// Gemini interprets the natural-language query into structured search params and writes
// the conversational reply; the actual product retrieval runs as tools over the Valkey
// catalog. Conversation context is kept in Valkey (JSON) so follow-ups like
// "show me cheaper options" reference the previous turn.
const express = require('express');
const { v7: uuidv7 } = require('uuid');
const client = require('../valkey');
const { sendError, parseJsonGet } = require('../lib/respond');
const { generateJSON, isConfigured } = require('../lib/gemini');
const { CAT } = require('../seed/seed');

const router = express.Router();

const CONVO_TTL = 1800; // 30 min
const convoKey = (id) => `conversation:${id}`;

// id -> human name (so Gemini can map "phones" to the smartphones category id).
const CATEGORY_NAMES = {
  [CAT.smartphones]: 'Smartphones',
  [CAT.electronics]: 'Electronics',
  [CAT.fashion]: 'Fashion',
  [CAT.home]: 'Home & Kitchen',
  [CAT.sports]: 'Sports & Outdoors',
};

// ---- tools (operate on the Valkey product catalog) -------------------------

async function listProducts() {
  const ids = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(cursor, 'MATCH', 'product:*', 'COUNT', 200);
    cursor = next;
    ids.push(...batch);
  } while (cursor !== '0');
  const docs = await Promise.all(ids.map((id) => client.call('JSON.GET', id, '$')));
  return docs.map(parseJsonGet).filter(Boolean);
}

function toCard(p) {
  return {
    productId: p.id,
    name: p.name,
    price: p.price?.amount,
    currency: p.price?.currency,
    image: p.images?.[0]?.url,
    categoryId: p.categoryId,
    rating: p.ratings?.average,
    brand: p.brand,
  };
}

// search_products / semantic_search tool — filter + rank the catalog.
async function searchCatalog({ keywords = [], categories = [], minPrice, maxPrice, minRating } = {}) {
  const products = await listProducts();
  const kw = keywords.map((k) => String(k).toLowerCase()).filter(Boolean);

  const scored = products
    .filter((p) => {
      const amount = p.price?.amount ?? 0;
      if (categories.length && !categories.includes(p.categoryId)) return false;
      if (minPrice != null && amount < minPrice) return false;
      if (maxPrice != null && amount > maxPrice) return false;
      if (minRating != null && (p.ratings?.average ?? 0) < minRating) return false;
      return true;
    })
    .map((p) => {
      const haystack = `${p.name} ${p.brand} ${(p.tags || []).join(' ')}`.toLowerCase();
      const matches = kw.filter((k) => haystack.includes(k)).length;
      return { p, score: matches * 10 + (p.ratings?.average ?? 0), matches };
    })
    // Keywords rank results (matches float to the top) but don't exclude items that
    // already passed the category/price/rating filters — otherwise a query like
    // "smartphone under 100000" would drop every phone (none are tagged "smartphone").
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.p);
}

async function findSimilar(productId, limit = 5) {
  const ids = await client.zrevrange(`copurchase:${productId}`, 0, limit - 1);
  const docs = await Promise.all(ids.map((id) => client.call('JSON.GET', id, '$')));
  return docs.map(parseJsonGet).filter(Boolean);
}

// Build a short human explanation of why a product fits the query.
function reasonFor(p, params) {
  const bits = [];
  const cat = CATEGORY_NAMES[p.categoryId];
  if (params.categories?.includes(p.categoryId) && cat) bits.push(`in ${cat}`);
  const hay = `${p.name} ${p.brand} ${(p.tags || []).join(' ')}`.toLowerCase();
  const hit = (params.keywords || []).find((k) => hay.includes(String(k).toLowerCase()));
  if (hit) bits.push(`matches "${hit}"`);
  if (params.maxPrice != null && p.price?.amount <= params.maxPrice) bits.push('within your budget');
  if ((p.ratings?.average ?? 0) >= 4.5) bits.push(`highly rated (${p.ratings.average}★)`);
  return bits.length ? `Recommended because it is ${bits.join(', ')}.` : `Popular pick rated ${p.ratings?.average ?? '—'}★.`;
}

// ---- agent orchestration ---------------------------------------------------

function catalogPromptContext() {
  const cats = Object.entries(CATEGORY_NAMES).map(([id, name]) => `- ${name}: ${id}`).join('\n');
  return `Available product categories (name: id):\n${cats}`;
}

const SYSTEM_PROMPT = `You are a helpful shopping assistant for an online store.
Convert the shopper's message into structured search parameters and a friendly reply.
${''}
Respond ONLY with JSON of this exact shape:
{
  "intent": "string short label",
  "response": "one or two friendly sentences to show the shopper",
  "followUp": "a clarifying question to refine results, or empty string",
  "searchParams": {
    "keywords": ["string"],
    "categories": ["category-id from the provided list, or omit"],
    "minPrice": number or null,
    "maxPrice": number or null,
    "minRating": number or null
  }
}
Prices are in INR (whole rupees). Only use category ids from the provided list.
If the shopper refers to a previous search (e.g. "cheaper", "show more"), adjust the PREVIOUS parameters accordingly.`;

async function runAgent(message, previousParams) {
  if (isConfigured()) {
    try {
      const userPrompt = [
        catalogPromptContext(),
        previousParams ? `Previous search parameters: ${JSON.stringify(previousParams)}` : '',
        `Shopper message: "${message}"`,
      ].filter(Boolean).join('\n\n');
      const parsed = await generateJSON(SYSTEM_PROMPT, userPrompt);
      const params = parsed.searchParams || {};
      return {
        source: 'gemini',
        intent: parsed.intent || 'product_search',
        response: parsed.response || 'Here are some options I found:',
        followUp: parsed.followUp || '',
        params: {
          keywords: params.keywords || [],
          categories: params.categories || [],
          minPrice: params.minPrice ?? null,
          maxPrice: params.maxPrice ?? null,
          minRating: params.minRating ?? null,
        },
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[agent] Gemini unavailable, using keyword fallback:', err.message);
    }
  }
  // Fallback: naive keyword extraction so the endpoint still works without Gemini.
  const keywords = String(message).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return {
    source: 'fallback',
    intent: 'product_search',
    response: 'Here are some products that match your search:',
    followUp: 'Want me to narrow this down by price or category?',
    params: { ...(previousParams || {}), keywords },
  };
}

// POST /api/agent/search  { sessionId?, message }
router.post('/search', async (req, res) => {
  const { message } = req.body || {};
  if (!message || !String(message).trim()) {
    return sendError(res, 400, 'missing_message', 'message is required.');
  }
  const sessionId = req.body.sessionId || `sess_${uuidv7()}`;

  // Load prior conversation (for multi-turn context).
  const convo = parseJsonGet(await client.call('JSON.GET', convoKey(sessionId), '$')) || {
    sessionId,
    turns: [],
  };
  const lastAgentTurn = [...convo.turns].reverse().find((t) => t.role === 'agent');
  const previousParams = lastAgentTurn?.searchParams || null;

  const agent = await runAgent(message, previousParams);
  const products = await searchCatalog(agent.params);
  const results = products.slice(0, 6).map((p) => ({ ...toCard(p), reason: reasonFor(p, agent.params) }));

  // Persist the turn.
  const now = new Date().toISOString();
  convo.turns.push({ role: 'user', content: message, timestamp: now });
  convo.turns.push({
    role: 'agent',
    content: agent.response,
    intent: agent.intent,
    searchParams: agent.params,
    results: results.map((r) => r.productId),
    timestamp: now,
  });
  await client.call('JSON.SET', convoKey(sessionId), '$', JSON.stringify(convo));
  await client.expire(convoKey(sessionId), CONVO_TTL);

  return res.json({
    sessionId,
    source: agent.source,
    response: agent.response,
    intent: agent.intent,
    followUp: agent.followUp,
    searchParams: agent.params,
    results,
  });
});

// GET /api/agent/conversation/:sessionId
router.get('/conversation/:sessionId', async (req, res) => {
  const convo = parseJsonGet(await client.call('JSON.GET', convoKey(req.params.sessionId), '$'));
  if (!convo) return sendError(res, 404, 'conversation_not_found', 'No such conversation.');
  return res.json(convo);
});

// POST /api/agent/feedback  { sessionId, productId, vote: 'up'|'down' }
router.post('/feedback', async (req, res) => {
  const { sessionId, productId, vote } = req.body || {};
  if (!sessionId || !productId || !['up', 'down'].includes(vote)) {
    return sendError(res, 400, 'invalid_feedback', 'sessionId, productId and vote (up|down) are required.');
  }
  await client.hincrby(`agent_feedback:${productId}`, vote, 1);
  return res.json({ ok: true });
});

module.exports = { router, searchCatalog, findSimilar, listProducts };
