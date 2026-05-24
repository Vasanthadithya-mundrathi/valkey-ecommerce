# Valkey E-Commerce Backend

Realtime backend for the Valkey e-commerce demo. Implements four challenges from `HACKATHON.md` and `Valkey-Integrations.md` against the same Valkey instance:

| # | Challenge                  | Where it lives                       |
| - | -------------------------- | ------------------------------------ |
| 4 | Trending products          | `src/trending.js`, `/api/trending/*` |
| 5 | Ads with targeting + caps  | `src/ads.js`, `/api/ads/*`           |
| 6 | Full-text search + facets  | `src/search.js`, `/api/search/*`     |
| 26| socket.io ↔ Valkey adapter | `src/socket.js`, `/api/health`       |

## Architecture

```
   ┌──────────────┐     ┌──────────────┐
   │ React client │     │ React client │  (multiple browser tabs / devices)
   └──────┬───────┘     └──────┬───────┘
          │ websocket          │ websocket
          ▼                    ▼
   ┌──────────────┐     ┌──────────────┐
   │ backend node1│     │ backend node2│
   └──────┬───────┘     └──────┬───────┘
          │ pub/sub + commands │
          ▼                    ▼
            ┌──────────────────┐
            │      Valkey      │  sorted sets (trending, ads index)
            │                  │  hashes      (cart, inventory)
            │                  │  strings     (ads, counters)
            │                  │  pub/sub     (socket.io adapter)
            │                  │  FT.* opt.   (search, when bundle is used)
            └──────────────────┘
```

## Challenge 4 — Trending products

Score weights live in `config.js` (`view: 1, addToCart: 3, purchase: 5`). Each event updates three sliding windows (`1h`, `6h`, `24h`) of both a **global** and a **per-category** sorted set:

```
trending:global:1h    trending:global:6h    trending:global:24h
trending:category:{categoryId}:1h           …:6h    …:24h
```

TTLs on each key give automatic time-decay.

REST surface:

| Method | Path                           | Notes                                     |
| ------ | ------------------------------ | ----------------------------------------- |
| GET    | `/api/trending?window=1h`      | global trending; window = `1h`/`6h`/`24h` |
| GET    | `/api/trending/:categoryId`    | category-scoped trending                  |
| POST   | `/api/events/view`             | `{ productId, categoryId? }`              |
| POST   | `/api/events/add-to-cart`      | `{ productId, categoryId? }`              |
| POST   | `/api/events/purchase`         | `{ productId, categoryId? }`              |

Socket events: `product:view`, `product:add-to-cart`, `product:purchase`, `trending:get`, `trending:update` (broadcast).

## Challenge 5 — Ads

Ads are stored as JSON strings under `ad:{adId}`. Two indexes are kept as sorted sets keyed by category and keyword, with the bid as score, so selection is a simple `ZREVRANGEBYSCORE` followed by per-ad budget and frequency-cap checks.

| Counter                          | Purpose                  | TTL   |
| -------------------------------- | ------------------------ | ----- |
| `ad_impressions:{adId}:{date}`   | impressions today        | 24h   |
| `ad_clicks:{adId}:{date}`        | clicks today             | 24h   |
| `ad_freq:{userId}:{adId}:{date}` | per-user frequency cap   | 24h   |
| `ad_spend:{adId}:{date}`         | running spend today      | 24h   |

REST surface:

| Method | Path                              | Notes                                |
| ------ | --------------------------------- | ------------------------------------ |
| GET    | `/api/ads?categoryId=…`           | also accepts `keywords=a,b,c`        |
| POST   | `/api/ads`                        | create / replace ad creative         |
| POST   | `/api/ads/:adId/impression`       | increments counter + spend           |
| POST   | `/api/ads/:adId/click`            | increments click counter             |
| GET    | `/api/ads/:adId/stats?date=…`     | `{impressions, clicks, ctr, spend}`  |

Socket events: `ads:select`, `ads:impression`, `ads:click`.

## Challenge 6 — Full-text search

`SearchService` first tries `FT.CREATE idx:products` against Valkey (works on the `valkey-bundle` image). If the module is not loaded it transparently falls back to a small in-memory engine that supports the same surface area:

- Full-text scoring with field weights (name × 5, brand × 3, tags × 2, description × 1)
- Prefix match and Levenshtein-tolerant fuzzy match (`galxy` → `galaxy`)
- Filters: `categoryId`, `brand`, `minPrice`, `maxPrice`
- Facets: brands, categories, fixed price buckets
- Sort: `relevance | price_asc | price_desc | rating | newest`
- Autocomplete via `/api/search/suggest`

REST surface:

| Method | Path                                                        | Returns                            |
| ------ | ----------------------------------------------------------- | ---------------------------------- |
| GET    | `/api/search?q=&category=&brand=&minPrice=&maxPrice=&sort=` | `{ total, results, facets, … }`    |
| GET    | `/api/search/suggest?q=&max=`                               | `{ suggestions: [{name, …}] }`     |
| GET    | `/api/search/facets?q=`                                     | `{ facets, total }`                |

Socket events: `search:query`, `search:suggest`.

The active backend is reported in every search response as `"backend": "valkey-search"` or `"backend": "in-memory"`.

## Challenge 26 — socket.io ↔ Valkey adapter

`@socket.io/redis-adapter` is wired against Valkey in `src/socket.js`. Two dedicated pub/sub clients are required by the adapter; a third connection handles ordinary command traffic. Once attached, every emit on this node is published to a Valkey channel and re-broadcast on every other node subscribed to the same channel.

See `docker-compose.yml` for a multi-node demo (`backend-node1` on port 4001, `backend-node2` on port 4002, both pointed at the same Valkey).

## Run it

### Local, single backend

```bash
docker run -d --name valkey -p 6379:6379 valkey/valkey-bundle:9-alpine

cd backend
npm install
npm start
# -> [server] node-12345 listening on :4000 (valkey=redis://localhost:6379, search=valkey-search)

cd ../frontend
npm install
npm start
# visit http://localhost:3000/live
```

### Multi-node (proves the adapter)

```bash
docker compose up --build
# backend-node1 -> http://localhost:4001
# backend-node2 -> http://localhost:4002
```

## Tests

```bash
cd backend
npm test
```

Runs the full suite (31 tests) using Node's built-in test runner — unit tests with fake Valkeys for trending / inventory / cart / ads / search, plus end-to-end socket.io integration tests that boot a real server with two real clients.

## Configuration

| Variable      | Default                  | Purpose                                      |
| ------------- | ------------------------ | -------------------------------------------- |
| `PORT`        | `4000`                   | HTTP/WS port                                 |
| `NODE_ID`     | `node-{pid}`             | label echoed in `hello` and `/api/health`    |
| `VALKEY_URL`  | `redis://localhost:6379` | Valkey connection string                     |
| `CORS_ORIGIN` | `*`                      | comma-separated allowed origins              |
