import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "valkey-demo-cart";

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => readCart());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = useCallback((product, quantity = 1) => {
    setItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? { ...item, product, quantity: Math.min(item.quantity + quantity, product.inventory.quantity) }
            : item
        );
      }
      return [...current, { productId: product.id, product, quantity }];
    });
  }, []);

  const updateQuantity = useCallback((productId, quantity) => {
    setItems((current) =>
      current
        .map((item) =>
          item.productId === productId
            ? { ...item, quantity: Math.max(1, Math.min(Number(quantity) || 1, item.product.inventory.quantity)) }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((productId) => {
    setItems((current) => current.filter((item) => item.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const loadDemoCart = useCallback((products) => {
    const demoProducts = products.slice(0, 2);
    setItems(demoProducts.map((product) => ({ productId: product.id, product, quantity: 1 })));
  }, []);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.product.price.amount * item.quantity, 0);
    return {
      subtotal,
      total: subtotal,
      count: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      totals,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      loadDemoCart,
    }),
    [addItem, clearCart, items, loadDemoCart, removeItem, totals, updateQuantity]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within CartProvider");
  }
  return context;
}

function readCart() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
