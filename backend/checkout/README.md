# Integrated Valkey E-Commerce Backend

This backend implements the challenge 7-10 demo API for the Valkey e-commerce app. It uses BullMQ queues backed by Valkey, Valkey JSON for product and order documents, Valkey Search/Vector Search for semantic product search, Lua scripts for atomic inventory mutation, Valkey-backed metrics for Prometheus, and Valkey Streams as the durable OpenSearch log buffer.

## Run Locally

Start the required services from the repository root:

```bash
docker compose up -d valkey opensearch embeddings
```

Install, seed, and run the backend:

```bash
cd backend/checkout
npm ci
npm run seed
npm run dev
```

The service listens on `http://localhost:4000` by default.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `VALKEY_URL` | unset | Full Redis-compatible Valkey URL. Takes precedence over host/port fields. |
| `VALKEY_HOST` | `localhost` | Valkey host when `VALKEY_URL` is unset. |
| `VALKEY_PORT` | `6379` | Valkey port when `VALKEY_URL` is unset. |
| `VALKEY_USERNAME` | unset | Optional ACL username. |
| `VALKEY_PASSWORD` | unset | Optional ACL password. |
| `VALKEY_TLS` | `false` | Enables TLS options when set to `true`. |
| `CHECKOUT_PORT` | `4000` | HTTP server port. |
| `CHECKOUT_WORKER_CONCURRENCY` | `4` | Worker concurrency per queue. |
| `RESERVATION_TTL_SECONDS` | `600` | Inventory reservation expiry. |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed frontend origin. |
| `EMBEDDING_SERVICE_URL` | `http://localhost:8001` | FastAPI embedding service URL. |
| `OPENSEARCH_URL` | `http://localhost:9200` | OpenSearch URL for log forwarding. |
| `OPENSEARCH_INDEX` | `valkey-ecommerce-logs` | OpenSearch index name. |

## API

Catalog, search, metrics, and observability endpoints are public for the demo. Checkout and order endpoints require `X-User-Id`; side-effecting checkout steps also require `Idempotency-Key`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/products` | List active products from Valkey JSON. |
| `GET` | `/api/products/:id` | Fetch one product. |
| `GET` | `/api/search/semantic?q=...` | Vector search with optional `categoryId`, `minPrice`, and `maxPrice` filters. |
| `GET` | `/api/products/:id/similar` | Similar products using stored embeddings. |
| `GET` | `/metrics` | Prometheus exposition text backed by Valkey metrics. |
| `GET` | `/api/analytics/dashboard` | JSON dashboard for orders, revenue, latency, active users, and inventory. |
| `GET` | `/api/observability/logs` | Recent structured logs from the `logs:app` Valkey Stream. |
| `GET` | `/api/observability/traces/:traceId` | Trace lookup across recent logs. |
| `GET` | `/api/observability/errors` | Top API errors from the log stream. |
| `GET` | `/api/observability/health` | Trace/log/OpenSearch health. |
| `POST` | `/api/checkout/start` | Create an order and reserve inventory through BullMQ. Requires `Idempotency-Key`. |
| `POST` | `/api/checkout/payment` | Run deterministic stub payment through BullMQ. Requires `Idempotency-Key`. |
| `POST` | `/api/checkout/confirm` | Commit reserved inventory and dispatch delivery through BullMQ. Requires `Idempotency-Key`. |
| `POST` | `/api/checkout/cancel` | Cancel an order and release reserved inventory. |
| `GET` | `/api/orders` | List orders owned by the caller. |
| `GET` | `/api/orders/:id` | Fetch one owned order. |
| `GET` | `/api/orders/:id/events` | Server-Sent Events stream for order state changes. |

Example checkout:

```bash
PRODUCT_ID="$(node -e "console.log(require('./src/fixtures').PRODUCT_FIXTURES[0].id)")"

curl -s http://localhost:4000/api/checkout/start \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: user:demo' \
  -H 'Idempotency-Key: demo-start-1' \
  -d "{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}],\"shippingAddress\":{\"city\":\"Hyderabad\",\"country\":\"IN\"}}"
```

## Validation

```bash
cd backend/checkout
npm run build
npm test
```

The integration tests require a live Valkey Bundle instance on `localhost:6379`. OpenSearch and the embedding service are used for the full browser demo; tests fall back to deterministic local embeddings when the embedding service is unavailable.
