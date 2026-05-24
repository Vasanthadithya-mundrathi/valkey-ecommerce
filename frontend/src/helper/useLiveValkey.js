import { useEffect, useMemo, useRef, useState } from "react";
import { io as createSocket } from "socket.io-client";

/**
 * useLiveValkey wires a React component to the realtime backend that's
 * powered by socket.io + the Valkey adapter. It subscribes to trending,
 * inventory, and cart updates and exposes imperative actions to publish
 * product events.
 *
 * @param {Object} opts
 * @param {string} [opts.url] backend URL; defaults to REACT_APP_BACKEND_URL or http://localhost:4000
 * @param {string} [opts.userId] user id used for cart sync
 */
export default function useLiveValkey({ url, userId } = {}) {
  const backendUrl = useMemo(
    () => url || process.env.REACT_APP_BACKEND_URL || "http://localhost:4000",
    [url]
  );

  const socketRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [hello, setHello] = useState(null);
  const [trending, setTrending] = useState([]);
  const [stock, setStock] = useState({});
  const [cart, setCart] = useState({});
  const [events, setEvents] = useState([]);

  const pushEvent = (entry) => {
    setEvents((prev) => [{ at: new Date().toISOString(), ...entry }, ...prev].slice(0, 50));
  };

  useEffect(() => {
    const socket = createSocket(backendUrl, {
      transports: ["websocket"],
      auth: userId ? { userId } : undefined,
      reconnectionDelay: 500,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connected");
      socket.emit("subscribe:trending");
      socket.emit("subscribe:inventory");
      if (userId) socket.emit("subscribe:cart", { userId });

      socket.emit("trending:get", {}, (resp) => {
        if (resp?.ok) setTrending(resp.top);
      });
      socket.emit("inventory:get", {}, (resp) => {
        if (resp?.ok && resp.stock) setStock(resp.stock);
      });
      if (userId) {
        socket.emit("cart:get", { userId }, (resp) => {
          if (resp?.ok) setCart(resp.items || {});
        });
      }
    });

    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", (err) => {
      setStatus("error");
      pushEvent({ kind: "error", message: err.message });
    });

    socket.on("hello", (payload) => {
      setHello(payload);
      pushEvent({ kind: "hello", payload });
    });

    socket.on("trending:update", (payload) => {
      setTrending(payload.top);
      pushEvent({ kind: "trending:update", count: payload.top.length });
    });

    socket.on("inventory:update", (payload) => {
      setStock((prev) => ({ ...prev, [payload.productId]: payload.quantity }));
      pushEvent({ kind: "inventory:update", payload });
    });

    socket.on("cart:update", (payload) => {
      setCart((prev) => {
        const next = { ...prev };
        if (payload.type === "clear") return {};
        if (payload.type === "remove") {
          delete next[payload.productId];
          return next;
        }
        next[payload.productId] = payload.quantity;
        return next;
      });
      pushEvent({ kind: "cart:update", payload });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [backendUrl, userId]);

  const emit = (event, payload) =>
    new Promise((resolve) => {
      if (!socketRef.current) return resolve({ ok: false, error: "no socket" });
      socketRef.current.emit(event, payload, (ack) => resolve(ack));
    });

  const actions = {
    view: (productId) => emit("product:view", { productId }),
    addToCart: (productId, qty = 1) =>
      emit("product:add-to-cart", { productId, userId, qty }),
    purchase: (productId, qty = 1) => emit("product:purchase", { productId, qty }),
    setCartQty: (productId, qty) => emit("cart:set", { productId, userId, qty }),
    removeFromCart: (productId) => emit("cart:remove", { productId, userId }),
    clearCart: () => emit("cart:clear", { userId }),
  };

  return { status, hello, trending, stock, cart, events, actions, backendUrl };
}
