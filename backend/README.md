# Valkey E-Commerce Backend (Challenge 26)

Realtime backend for the Valkey e-commerce demo. Implements **Challenge 26** from `Valkey-Integrations.md`: a first-class **socket.io ↔ Valkey** integration using the `@socket.io/redis-adapter` package against Valkey's Redis-7.2 wire protocol.

## What this demonstrates

- **Drop-in adapter** — `@socket.io/redis-adapter` connects to Valkey with no code changes. Two pub/sub clients are sufficient to scale socket.io across replicas.
- **Multi-node fan-out** — emit a socket event on `node1` and every client connected to `node2`, `node3`, … receives it via Valkey pub/sub.
- **E-commerce events** — live trending products, live inventory deltas, and cross-tab cart sync all driven through socket.io rooms.

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
            │      Valkey      │  (sorted sets, hashes, pub/sub)
            └──────────────────┘
```

## Event vocabulary

| Direction | Event                | Payload                              | Notes                                    |
| --------- | -------------------- | ------------------------------------ | ---------------------------------------- |
| C → S     | `subscribe:product`  | `{ productId }`                      | join product room for stock updates      |
| C → S     | `subscribe:cart`     | `{ userId }`                         | join personal cart room                  |
| C → S     | `subscribe:trending` | `{}`                                 | join global trending room                |
| C → S     | `subscribe:inventory`| `{}`                                 | join global inventory room               |
| C → S     | `product:view`       | `{ productId }`                      | trending + 1                             |
| C → S     | `product:add-to-cart`| `{ productId, userId, qty }`         | reserve stock, cart hash, trending + 3   |
| C → S     | `product:purchase`   | `{ productId, qty }`                 | trending + 5                             |
| C → S     | `cart:set` / `:remove` / `:clear` | cart mutations         | server-authoritative                     |
| C → S     | `trending:get` / `inventory:get` / `cart:get` | reads w/ ack       | for initial bootstrap                    |
| S → C     | `hello`              | `{ socketId, nodeId, serverTime }`   | tells client which backend node served it|
| S → C     | `trending:update`    | `{ top: [{productId, score}], updatedAt }` | throttled to once per 1s            |
| S → C     | `inventory:update`   | `{ productId, quantity, reason }`    | broadcast on every stock change          |
| S → C     | `cart:update`        | `{ userId, type, productId, quantity }` | cross-tab cart sync                   |

## Run it

### Local (single backend)

```bash
# 1. Start Valkey
docker run -d --name valkey -p 6379:6379 valkey/valkey-bundle:9-alpine

# 2. Install + start backend
cd backend
npm install
npm start
# -> [server] node-12345 listening on :4000 (valkey=redis://localhost:6379)

# 3. (separate shell) start frontend, visit http://localhost:3000/live
cd frontend
npm install
npm start
```

### Multi-node (proves the adapter)

```bash
docker compose up --build
# backend-node1 -> http://localhost:4001
# backend-node2 -> http://localhost:4002

# Point the frontend at one node
REACT_APP_BACKEND_URL=http://localhost:4001 npm start --prefix frontend
```

Open `/live` in two browser tabs. One tab will be served by `node1`, the other may be served by either node depending on your reverse proxy (here you connect them directly to one node, but their messages flow through Valkey to all connected nodes — you can verify by switching `REACT_APP_BACKEND_URL` between tabs).

## REST API

The HTTP surface is intentionally tiny — its only job is to bootstrap state.

| Method | Path                  | Returns                                |
| ------ | --------------------- | -------------------------------------- |
| GET    | `/api/health`         | `{ ok, nodeId, valkey, sockets, time }`|
| GET    | `/api/products`       | seeded catalog with current stock      |
| GET    | `/api/trending`       | top-N trending products                |
| GET    | `/api/inventory`      | full stock map                         |
| GET    | `/api/cart/:userId`   | current cart for a user                |

## Tests

```bash
cd backend
npm test
```

Runs unit tests against `TrendingService`, `InventoryService`, `CartService`, and the room-name helpers using Node's built-in test runner. No live Valkey required for tests.

## Configuration

All knobs are environment variables (see `.env.example`):

| Variable      | Default                  | Purpose                                      |
| ------------- | ------------------------ | -------------------------------------------- |
| `PORT`        | `4000`                   | HTTP/WS port                                 |
| `NODE_ID`     | `node-{pid}`             | label echoed in `hello` and `/api/health`    |
| `VALKEY_URL`  | `redis://localhost:6379` | Valkey connection string                     |
| `CORS_ORIGIN` | `*`                      | comma-separated allowed origins              |

## Why this counts as a Valkey integration

Although `@socket.io/redis-adapter` is named after Redis, it ships against the wire protocol that Valkey implements. This project demonstrates:

1. The adapter works against Valkey unmodified.
2. Valkey's data structures (sorted sets for trending, hashes for cart and inventory, strings for bootstrapping) cleanly back the realtime e-commerce surface.
3. Horizontal scale-out works as advertised: events emitted on one node reach clients connected to any other node through Valkey pub/sub.
