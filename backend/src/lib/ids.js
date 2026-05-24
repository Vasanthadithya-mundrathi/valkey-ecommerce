// Shared ID helpers — every challenge uses `domain:uuidv7` (see HACKATHON.md > ID Strategy).
// UUIDv7 is time-sortable, so IDs sort chronologically without a separate createdAt index.
const { v7: uuidv7 } = require('uuid');

const DOMAINS = ['user', 'product', 'category', 'vendor', 'order', 'addr', 'ad', 'session'];

function createId(domain) {
  return `${domain}:${uuidv7()}`;
}

function parseId(id) {
  const colonIndex = id.indexOf(':');
  if (colonIndex === -1) return { domain: null, uuid: id };
  return {
    domain: id.substring(0, colonIndex),
    uuid: id.substring(colonIndex + 1),
  };
}

module.exports = { createId, parseId, DOMAINS };
