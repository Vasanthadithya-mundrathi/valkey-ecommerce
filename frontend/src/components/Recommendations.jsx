import React, { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../api/config";

// Challenge 13 UI — interact with products and watch recommendations update live.
// Demo user is sent via the X-User-Id header so the backend can personalise.
const USER_ID = "user:demo";
const headers = { "Content-Type": "application/json", "X-User-Id": USER_ID };

const ProductCard = ({ p, children }) => (
  <div className="border border-gray-100 rounded-12 p-12 h-100 d-flex flex-column">
    <div
      className="bg-gray-50 rounded-8 mb-12 flex-center"
      style={{ height: 96, overflow: "hidden" }}
    >
      {p.image ? (
        <img src={p.image} alt={p.name} style={{ maxHeight: "100%", objectFit: "contain" }}
          onError={(e) => { e.target.style.display = "none"; }} />
      ) : null}
    </div>
    <span className="fw-medium text-sm d-block mb-4">{p.name || p.id}</span>
    {p.price != null && <span className="text-main-600 fw-semibold">₹{p.price.toLocaleString()}</span>}
    {p.rating != null && <span className="text-gray-500 text-xs d-block">★ {p.rating}</span>}
    <div className="mt-auto pt-8">{children}</div>
  </div>
);

const Row = ({ title, items, empty, render }) => (
  <div className="mb-40">
    <h6 className="text-lg mb-16">{title}</h6>
    {items.length === 0 ? (
      <p className="text-gray-500 text-sm">{empty}</p>
    ) : (
      <div className="row gy-3">
        {items.map((p) => (
          <div className="col-6 col-md-3" key={p.id}>
            <ProductCard p={p}>{render && render(p)}</ProductCard>
          </div>
        ))}
      </div>
    )}
  </div>
);

const Recommendations = () => {
  const [catalog, setCatalog] = useState([]);
  const [recentlyViewed, setRecentlyViewed] = useState([]);
  const [personalized, setPersonalized] = useState([]);
  const [similar, setSimilar] = useState({ productId: null, results: [] });
  const [status, setStatus] = useState("");

  const get = (path) => fetch(`${API_BASE}${path}`, { headers }).then((r) => r.json());

  const refresh = useCallback(async () => {
    const [rv, pf] = await Promise.all([
      get("/api/recommendations/recently-viewed"),
      get("/api/recommendations/personalized"),
    ]);
    setRecentlyViewed(rv.results || []);
    setPersonalized(pf.results || []);
  }, []);

  useEffect(() => {
    get("/api/recommendations/products").then((d) => setCatalog(d.results || []));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendEvent = async (type, product, extra = {}) => {
    await fetch(`${API_BASE}/api/recommendations/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type, productId: product.id, ...extra }),
    });
    setStatus(`Recorded ${type.replace("_", " ")}: ${product.name}`);
    await refresh();
  };

  const viewProduct = async (p) => {
    await sendEvent("view", p);
    const s = await get(`/api/recommendations/similar/${p.id}`);
    setSimilar(s);
  };

  return (
    <section className="py-80">
      <div className="container container-lg">
        <p className="text-gray-500 mb-24">
          Click <b>View</b> or <b>Buy</b> on any product — recommendations update instantly
          from Valkey (lists, sorted sets, co-purchase matrix).
        </p>
        {status && (
          <div className="bg-success-50 text-success-600 border border-success-100 rounded-8 px-16 py-8 mb-24 text-sm">
            <i className="ph ph-check-circle me-8" />{status}
          </div>
        )}

        <Row
          title="Catalog"
          items={catalog}
          empty="Start the backend and run `npm run seed`."
          render={(p) => (
            <div className="d-flex gap-8">
              <button className="btn btn-sm btn-outline-main px-12 py-6 flex-grow-1" onClick={() => viewProduct(p)}>View</button>
              <button className="btn btn-sm btn-main px-12 py-6 flex-grow-1" onClick={() => sendEvent("purchase", p)}>Buy</button>
            </div>
          )}
        />

        <Row title="Recently Viewed" items={recentlyViewed} empty="No views yet — click View above." />
        <Row title="Recommended For You" items={personalized} empty="Interact with products to get personalised picks." />
        {similar.productId && (
          <Row title="Customers Also Bought" items={similar.results} empty="No co-purchase data yet — Buy two items together." />
        )}
      </div>
    </section>
  );
};

export default Recommendations;
