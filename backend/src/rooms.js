'use strict';

// Helpers for building consistent socket.io room names. Keeping these in one
// place avoids subtle bugs where one part of the code emits to `cart:123` and
// another listens on `cart-123`.

const product = (productId) => `product:${productId}`;
const cart = (userId) => `cart:${userId}`;
const order = (orderId) => `order:${orderId}`;
const trending = () => 'trending:global';
const inventory = () => 'inventory:global';

module.exports = { product, cart, order, trending, inventory };
