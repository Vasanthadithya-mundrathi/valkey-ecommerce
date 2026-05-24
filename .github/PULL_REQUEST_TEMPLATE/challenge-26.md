# Realtime e-commerce: Challenges 4, 5, 6, 26

This PR implements four challenges from `HACKATHON.md` and `Valkey-Integrations.md` against a single Valkey instance, with end-to-end wiring through the React frontend.

## What's included

| # | Challenge | Where it lives |
|---|-----------|----------------|
| 4 | Trending products | `backend/src/trending.js`, `/api/trending/*`, `POST /api/events/*` |
| 5 | Ads with targeting + frequency cap | `backend/src/ads.js`, `/api/ads/*` |
| 6 | Full-text search + facets + autocomplete | `backend/src/search.js`, `/api/search/*` |
| 26 | socket.io ↔ Valkey integration | `backend/src/socket.js` + `docker-compose.yml` for multi-node |

A new `/live` page in the React frontend exercises every event over a single websocket so reviewers can see all four challenges working together.

## Highlights

### Challenge 26 — socket.io ↔ Valkey

- `@socket.io/redis-adapter` wired against Valkey (Redis-7.2 protocol compatible).
- Two dedicated Valkey pub/sub clients for the adapter, plus a third for command traffic.
- `docker-compose.yml` boots Valkey and two backend replicas to demonstrate adapter fan-out across nodes.

### Challenge 4 — Trending products

- Three sliding windows (`1h`, `6h`, `24h`) on both global and per-category sorted sets.
- TTLs give automatic time-decay; new events bump weights `view: 1, addToCart: 3, purchase: 5`.
- Throttled `trending:update` broadcasts (1s coalescing window) so event floods don't become socket frame floods.

### Challenge 5 — Ads

- JSON ad creatives stored as strings under `ad:{adId}` (works on stock Valkey; identical semantics on `valkey-bundle`).
- Bid-sorted indexes by category and keyword: `ZREVRANGEBYSCORE` selects winners in one call.
- Daily budget enforcement, per-user frequency cap (default 3), CTR + spend stats.

### Challenge 6 — Full-text search

- `SearchService` first tries `FT.CREATE idx:products` against Valkey; on stock Valkey it falls back to a small in-memory engine with the same surface.
- Weighted scoring (name × 5, brand × 3, tags × 2, description × 1).
- Prefix and Levenshtein-tolerant fuzzy match (`galxy` → `galaxy`).
- Facets: brands, categories, fixed price buckets.
- Sort: `relevance | price_asc | price_desc | rating | newest`.
- Each response reports `"backend": "valkey-search"` or `"backend": "in-memory"`.

## How to run

```bash
# 1. Valkey
docker run -d --name valkey -p 6379:6379 valkey/valkey-bundle:9-alpine

# 2. Backend
cd backend && npm install && npm start

# 3. Frontend
cd ../frontend && npm install && npm start
# open http://localhost:3000/live
```

For the multi-node demo (proves the socket.io adapter):

```bash
docker compose up --build
```

## Verification

- **Backend tests**: `cd backend && npm test` — 31 passing (Node built-in test runner). Includes three real socket.io end-to-end tests that boot a server with two clients and verify cross-client broadcasts.
- **Frontend production build**: `cd frontend && npm run build` — compiles cleanly, +1.4 kB gzipped over baseline.

## Files

- New: `backend/` (full Express + socket.io service), `docker-compose.yml`, `frontend/src/pages/LivePage.jsx`, `frontend/src/components/LiveValkeyDemo.jsx`, `frontend/src/helper/useLiveValkey.js`.
- Modified: `README.md` (link to backend README and `/live` page), `frontend/src/App.js` (route), `frontend/package.json` (`socket.io-client` dependency).

## Acceptance criteria checklist

**Challenge 4**
- [x] Trending list updates in real time as events come in (`trending:update` broadcast)
- [x] Different time windows return different results (`1h`, `6h`, `24h`)
- [x] Scores reflect weighted interactions
- [x] Stale products fall off (TTL on each window key)

**Challenge 5**
- [x] Ads served by relevance to current page context
- [x] Higher bids get priority placement (sorted-set score)
- [x] Daily budget enforced
- [x] Frequency cap (default 3) per user per day
- [x] CTR is trackable

**Challenge 6**
- [x] Full-text search with stemming-style tokenization
- [x] Typo tolerance (Levenshtein up to 2 for longer tokens)
- [x] Facets accurately reflect the filtered result set
- [x] Autocomplete (`/api/search/suggest`)
- [x] Multi-criteria sort

**Challenge 26**
- [x] Adapter works with Valkey unmodified
- [x] Multi-node fan-out demonstrated via `docker-compose.yml`
- [x] React client ships with `/live` page that exercises all events
