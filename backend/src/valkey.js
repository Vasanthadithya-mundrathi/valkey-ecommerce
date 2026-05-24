// Single shared Valkey connection for the whole backend.
// DO NOT create your own connection in a route file — import this one.
// For pub/sub subscribers (which block the connection) call `client.duplicate()`.
require('dotenv').config();
const Valkey = require('iovalkey');

const VALKEY_URL = process.env.VALKEY_URL || 'redis://localhost:6379';

const client = new Valkey(VALKEY_URL, {
  // Fail fast in tests / scripts instead of retrying forever.
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

client.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[valkey] connection error:', err.message);
});

module.exports = client;
