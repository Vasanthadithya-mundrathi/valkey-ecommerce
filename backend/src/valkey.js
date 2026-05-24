'use strict';

// Thin wrapper around the redis client to make it explicit that we are
// connecting to Valkey. Valkey is wire-compatible with the Redis protocol up
// to and including 7.2, so the official `redis` client and the
// `@socket.io/redis-adapter` package work without any code changes.

const { createClient } = require('redis');
const config = require('./config');

/**
 * Create a connected Valkey client. Each caller gets its own connection so
 * pub/sub clients are not shared with command clients (a hard requirement of
 * the socket.io adapter).
 *
 * @param {string} role A label used only for log messages.
 * @returns {Promise<import('redis').RedisClientType>}
 */
async function createValkeyClient(role = 'app') {
  const client = createClient({ url: config.valkeyUrl });

  client.on('error', (err) => {
    // Logged once per error event; the redis client auto-reconnects.
    console.error(`[valkey:${role}] error:`, err.message);
  });
  client.on('reconnecting', () => {
    console.warn(`[valkey:${role}] reconnecting...`);
  });
  client.on('ready', () => {
    console.log(`[valkey:${role}] ready (${config.valkeyUrl})`);
  });

  await client.connect();
  return client;
}

module.exports = { createValkeyClient };
