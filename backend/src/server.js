'use strict';

// Entry point. Wires Express + socket.io + the Valkey adapter together,
// boots the demo data, and starts listening.

const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const { createValkeyClient } = require('./valkey');
const { buildSocketServer } = require('./socket');
const { TrendingService } = require('./trending');
const { InventoryService } = require('./inventory');
const { CartService } = require('./cart');
const { AdsService } = require('./ads');
const { SearchService } = require('./search');
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

  const { io } = await buildSocketServer(httpServer);
  const valkey = await createValkeyClient('app');

  const trending = new TrendingService({ valkey, io });
  const inventory = new InventoryService({ valkey, io });
  const cart = new CartService({ valkey, io });
  const ads = new AdsService({ valkey });
  const search = new SearchService({ valkey });

  await seedDemoData({ inventory, valkey, ads, search });

  registerHandlers({ io, trending, inventory, cart, ads, search });
  app.use(
    '/api',
    buildRouter({ trending, inventory, cart, ads, search, valkey, io })
  );

  app.get('/', (_req, res) => {
    res.json({
      service: 'valkey-ecommerce-backend',
      nodeId: config.nodeId,
      challenges: [4, 5, 6, 26],
      message:
        'Realtime e-commerce backend powered by socket.io + Valkey adapter.',
    });
  });

  httpServer.listen(config.port, () => {
    console.log(
      `[server] ${config.nodeId} listening on :${config.port} ` +
        `(valkey=${config.valkeyUrl}, search=${
          search.useFt ? 'valkey-search' : 'in-memory'
        })`
    );
  });

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
