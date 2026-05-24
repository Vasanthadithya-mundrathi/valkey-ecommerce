'use strict';

// Entry point. Wires Express + socket.io + the Valkey adapter together,
// boots the demo data, and starts listening.
//
// Run multiple of these against the same Valkey to see the adapter in action:
//   PORT=4001 NODE_ID=node1 node src/server.js
//   PORT=4002 NODE_ID=node2 node src/server.js
//
// Both nodes will broadcast each other's events through Valkey pub/sub.

const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const { createValkeyClient } = require('./valkey');
const { buildSocketServer } = require('./socket');
const { TrendingService } = require('./trending');
const { InventoryService } = require('./inventory');
const { CartService } = require('./cart');
const { registerHandlers } = require('./handlers');
const { buildRouter } = require('./routes');
const { seedDemoData } = require('./seed');

async function start() {
  const app = express();
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
      credentials: true,
    })
  );
  app.use(express.json());

  const httpServer = http.createServer(app);

  // socket.io with the Valkey-backed adapter.
  const { io } = await buildSocketServer(httpServer);

  // A separate Valkey connection for ordinary commands (data reads / writes).
  // Keeping it distinct from the adapter's pub/sub clients is important: the
  // adapter's subscriber connection cannot run regular commands.
  const valkey = await createValkeyClient('app');

  const trending = new TrendingService({ valkey, io });
  const inventory = new InventoryService({ valkey, io });
  const cart = new CartService({ valkey, io });

  await seedDemoData({ inventory, valkey });

  registerHandlers({ io, trending, inventory, cart });
  app.use('/api', buildRouter({ trending, inventory, cart, valkey, io }));

  app.get('/', (_req, res) => {
    res.json({
      service: 'valkey-ecommerce-backend',
      nodeId: config.nodeId,
      challenge: 26,
      message:
        'Realtime e-commerce backend powered by socket.io + Valkey adapter.',
    });
  });

  httpServer.listen(config.port, () => {
    console.log(
      `[server] ${config.nodeId} listening on :${config.port} ` +
        `(valkey=${config.valkeyUrl})`
    );
  });

  // Graceful shutdown so Docker / ctrl-c stops without ECONNRESET noise.
  const shutdown = async (signal) => {
    console.log(`[server] received ${signal}, shutting down`);
    io.close();
    httpServer.close();
    try {
      await valkey.quit();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
