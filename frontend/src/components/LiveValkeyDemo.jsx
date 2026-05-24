import React, { useMemo, useState } from "react";
import useLiveValkey from "../helper/useLiveValkey";

// A demo product list. The IDs match the backend seed (backend/src/seed.js)
// so the live stock numbers line up out of the box.
const DEMO_PRODUCTS = [
  { id: "product:0192d4e6-2c4e-7a6b-8d8f-0a1b2c3d4e5f", name: "Galaxy Ultra Pro 256GB", price: 89999 },
  { id: "product:0192d4e6-3d5f-7b8c-9e0a-1b2c3d4e5f6a", name: "AirSound Pro Earbuds", price: 12999 },
  { id: "product:0192d4e6-4e6a-7c9d-8f1b-2c3d4e5f6a7b", name: "TitanFit Smart Watch", price: 8499 },
  { id: "product:0192d4e6-5f7b-7d0e-9a2c-3d4e5f6a7b8c", name: "AeroBook 14 Laptop", price: 64999 },
  { id: "product:0192d4e6-6a8c-7e1f-8b3d-4e5f6a7b8c9d", name: "BrewMaster Coffee Machine", price: 18999 },
  { id: "product:0192d4e6-7b9d-7f2a-9c4e-5f6a7b8c9d0e", name: "GlowLite Smart Bulb (4-pack)", price: 1499 },
];

const formatPrice = (paise) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise);

const productNameById = (id) =>
  DEMO_PRODUCTS.find((p) => p.id === id)?.name || id;

const statusColor = {
  connecting: "#9aa0a6",
  connected: "#00b86b",
  disconnected: "#d93025",
  error: "#d93025",
};

const LiveValkeyDemo = () => {
  // A stable per-tab user id makes cross-tab cart sync easy to demo: open
  // two tabs with the same userId in localStorage and watch them mirror.
  const [userId] = useState(() => {
    const cached = typeof window !== "undefined" && window.localStorage
      ? window.localStorage.getItem("live-valkey-user")
      : null;
    if (cached) return cached;
    const fresh = `user:demo-${Math.random().toString(36).slice(2, 10)}`;
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("live-valkey-user", fresh);
    }
    return fresh;
  });

  const { status, hello, trending, stock, cart, events, actions, backendUrl } =
    useLiveValkey({ userId });

  const cartTotal = useMemo(() => {
    return Object.entries(cart).reduce((sum, [productId, qty]) => {
      const product = DEMO_PRODUCTS.find((p) => p.id === productId);
      return sum + (product ? product.price * qty : 0);
    }, 0);
  }, [cart]);

  return (
    <section className="py-80" style={{ background: "#f6f7fb" }}>
      <div className="container">
        <div className="d-flex flex-wrap justify-content-between align-items-end mb-32 gap-3">
          <div>
            <h2 className="mb-8">Live Valkey Demo</h2>
            <p className="text-gray-600 mb-0">
              Realtime e-commerce events delivered through socket.io with the
              Valkey-backed adapter. Open this page in two browser tabs to see
              the cart and inventory sync live.
            </p>
          </div>
          <div className="text-end">
            <div className="d-flex align-items-center gap-2 justify-content-end">
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: statusColor[status] || "#9aa0a6",
                }}
              />
              <strong style={{ textTransform: "uppercase", fontSize: 12 }}>
                {status}
              </strong>
            </div>
            <small className="text-gray-500">{backendUrl}</small>
            {hello?.nodeId && (
              <div>
                <small className="text-gray-500">
                  served by <code>{hello.nodeId}</code>
                </small>
              </div>
            )}
            <div>
              <small className="text-gray-500">
                user: <code>{userId}</code>
              </small>
            </div>
          </div>
        </div>

        <div className="row g-4">
          <div className="col-lg-7">
            <div className="bg-white p-24 rounded-3 shadow-sm h-100">
              <h4 className="mb-16">Catalog</h4>
              <p className="text-gray-600 mb-16" style={{ fontSize: 14 }}>
                Each click emits a socket event. The backend updates Valkey,
                then re-broadcasts to every connected client through the
                Valkey adapter.
              </p>
              <ul className="list-unstyled m-0">
                {DEMO_PRODUCTS.map((product) => {
                  const remaining = stock[product.id];
                  return (
                    <li
                      key={product.id}
                      className="d-flex flex-wrap align-items-center justify-content-between gap-3 py-12 border-bottom"
                    >
                      <div style={{ minWidth: 220 }}>
                        <div className="fw-semibold">{product.name}</div>
                        <small className="text-gray-500">
                          {formatPrice(product.price)} ·{" "}
                          {remaining == null
                            ? "stock loading..."
                            : remaining === 0
                            ? "OUT OF STOCK"
                            : `${remaining} in stock`}
                        </small>
                      </div>
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => actions.view(product.id)}
                        >
                          view (+1)
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-primary btn-sm"
                          onClick={() => actions.addToCart(product.id, 1)}
                          disabled={remaining === 0}
                        >
                          add to cart (+3)
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => actions.purchase(product.id, 1)}
                        >
                          purchase (+5)
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="col-lg-5">
            <div className="bg-white p-24 rounded-3 shadow-sm mb-24">
              <h4 className="mb-16">Trending right now</h4>
              {trending.length === 0 ? (
                <p className="text-gray-500 mb-0">
                  No events yet. Click view, add to cart, or purchase to feed
                  the trending sorted set.
                </p>
              ) : (
                <ol className="ps-3 m-0">
                  {trending.map((item) => (
                    <li key={item.productId} className="py-4">
                      <span className="fw-semibold">
                        {productNameById(item.productId)}
                      </span>{" "}
                      <small className="text-gray-500">
                        score {item.score.toFixed(1)}
                      </small>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="bg-white p-24 rounded-3 shadow-sm mb-24">
              <div className="d-flex justify-content-between align-items-center mb-12">
                <h4 className="m-0">Your cart</h4>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  onClick={() => actions.clearCart()}
                  disabled={Object.keys(cart).length === 0}
                >
                  clear
                </button>
              </div>
              {Object.keys(cart).length === 0 ? (
                <p className="text-gray-500 mb-0">Cart is empty.</p>
              ) : (
                <ul className="list-unstyled m-0">
                  {Object.entries(cart).map(([productId, qty]) => (
                    <li
                      key={productId}
                      className="d-flex justify-content-between align-items-center py-8 border-bottom"
                    >
                      <div>
                        <div>{productNameById(productId)}</div>
                        <small className="text-gray-500">qty {qty}</small>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => actions.removeFromCart(productId)}
                      >
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="d-flex justify-content-between mt-12 pt-12 border-top">
                <strong>Total</strong>
                <strong>{formatPrice(cartTotal)}</strong>
              </div>
            </div>

            <div className="bg-white p-24 rounded-3 shadow-sm">
              <h4 className="mb-16">Recent events</h4>
              <p className="text-gray-600 mb-12" style={{ fontSize: 13 }}>
                Live tail of socket frames received on this client.
              </p>
              <div
                style={{
                  maxHeight: 240,
                  overflow: "auto",
                  fontFamily: "monospace",
                  fontSize: 12,
                  background: "#0f172a",
                  color: "#e2e8f0",
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                {events.length === 0 ? (
                  <div style={{ opacity: 0.6 }}>waiting for events...</div>
                ) : (
                  events.map((event, idx) => (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      <span style={{ color: "#94a3b8" }}>
                        {new Date(event.at).toLocaleTimeString()}
                      </span>{" "}
                      <span style={{ color: "#7dd3fc" }}>{event.kind}</span>{" "}
                      {event.payload
                        ? JSON.stringify(event.payload)
                        : event.message || ""}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LiveValkeyDemo;
