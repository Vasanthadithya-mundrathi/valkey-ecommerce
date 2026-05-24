'use strict';

// Centralized configuration. Read from environment so the same image can be
// run with different roles (node1, node2, ...) when demonstrating the
// multi-instance Valkey adapter.

const env = process.env;

module.exports = {
  port: parseInt(env.PORT || '4000', 10),
  nodeId: env.NODE_ID || `node-${process.pid}`,
  valkeyUrl: env.VALKEY_URL || 'redis://localhost:6379',
  corsOrigin: env.CORS_ORIGIN || '*',

  // socket.io tuning
  pingInterval: 25000,
  pingTimeout: 20000,

  // Trending product score weights (mirrors Challenge 4 in HACKATHON.md)
  trendingWeights: {
    view: 1,
    addToCart: 3,
    purchase: 5,
  },

  // How many trending products to broadcast on each update
  trendingTopN: 10,

  // Trending broadcast throttle in ms (avoid hot-loop floods)
  trendingBroadcastMs: 1000,
};
