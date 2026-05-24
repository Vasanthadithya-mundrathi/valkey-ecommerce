'use strict';

// Wires socket.io to Valkey using @socket.io/redis-adapter.
//
// The adapter needs two dedicated Valkey connections (a publisher and a
// subscriber). Once attached, every emit on this node is published to a
// Valkey channel and re-broadcast on every other node subscribed to the same
// channel. That is the entire mechanism that makes the e-commerce demo work
// across multiple backend replicas.

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const config = require('./config');
const { createValkeyClient } = require('./valkey');

/**
 * @param {import('http').Server} httpServer
 * @returns {Promise<{ io: import('socket.io').Server, pubClient: any, subClient: any }>}
 */
async function buildSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
      credentials: true,
    },
    pingInterval: config.pingInterval,
    pingTimeout: config.pingTimeout,
  });

  // Two distinct Valkey connections are required by the adapter.
  const pubClient = await createValkeyClient('socketio-pub');
  const subClient = await createValkeyClient('socketio-sub');

  io.adapter(createAdapter(pubClient, subClient));

  io.engine.on('connection_error', (err) => {
    console.warn('[socket.io] connection_error:', err.code, err.message);
  });

  return { io, pubClient, subClient };
}

module.exports = { buildSocketServer };
