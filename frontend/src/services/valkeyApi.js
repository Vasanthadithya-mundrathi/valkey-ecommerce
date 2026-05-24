const API_BASE_URL = (process.env.REACT_APP_CHECKOUT_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const USER_ID_KEY = "valkey-demo-user-id";

export function getDemoUserId() {
  const existing = window.localStorage.getItem(USER_ID_KEY);
  if (existing) {
    return existing;
  }

  const userId = `user:demo:${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(USER_ID_KEY, userId);
  return userId;
}

export function apiBaseUrl() {
  return API_BASE_URL;
}

export async function getProducts() {
  return request("/api/products");
}

export async function getProduct(productId) {
  return request(`/api/products/${encodeURIComponent(productId)}`);
}

export async function semanticSearch({ query, categoryId, minPrice, maxPrice, limit = 8 }) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (categoryId) params.set("categoryId", categoryId);
  if (minPrice) params.set("minPrice", String(minPrice));
  if (maxPrice) params.set("maxPrice", String(maxPrice));
  return request(`/api/search/semantic?${params.toString()}`);
}

export async function similarProducts(productId, limit = 4) {
  return request(`/api/products/${encodeURIComponent(productId)}/similar?limit=${limit}`);
}

export async function startCheckout({ items, shippingAddress }) {
  return request("/api/checkout/start", {
    method: "POST",
    auth: true,
    idempotencyKey: uniqueKey("checkout-start"),
    body: { items, shippingAddress },
  });
}

export async function authorizePayment({ orderId, outcome }) {
  return request("/api/checkout/payment", {
    method: "POST",
    auth: true,
    idempotencyKey: uniqueKey("checkout-payment"),
    body: { orderId, paymentInput: { outcome } },
  });
}

export async function confirmCheckout({ orderId }) {
  return request("/api/checkout/confirm", {
    method: "POST",
    auth: true,
    idempotencyKey: uniqueKey("checkout-confirm"),
    body: { orderId },
  });
}

export async function cancelCheckout({ orderId }) {
  return request("/api/checkout/cancel", {
    method: "POST",
    auth: true,
    body: { orderId },
  });
}

export async function getOrders() {
  return request("/api/orders", { auth: true });
}

export async function getAnalyticsDashboard() {
  return request("/api/analytics/dashboard");
}

export async function getPrometheusMetrics() {
  const response = await fetch(`${API_BASE_URL}/metrics`);
  return response.text();
}

export async function getObservabilityHealth() {
  return request("/api/observability/health");
}

export async function getObservabilityLogs(limit = 100) {
  return request(`/api/observability/logs?limit=${limit}`);
}

export async function getObservabilityErrors() {
  return request("/api/observability/errors");
}

export async function getTrace(traceId) {
  return request(`/api/observability/traces/${encodeURIComponent(traceId)}`);
}

export async function triggerDemoError() {
  return request("/api/search/semantic");
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth) {
    headers.set("X-User-Id", getDemoUserId());
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const traceId = response.headers.get("X-Trace-Id");
  const contentType = response.headers.get("Content-Type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(body?.message || `API request failed with ${response.status}`);
    error.status = response.status;
    error.code = body?.error;
    error.details = body?.details;
    error.traceId = traceId;
    throw error;
  }

  return typeof body === "object" && body !== null ? { ...body, traceId } : { body, traceId };
}

function uniqueKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
