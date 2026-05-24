// Shared response helpers so every endpoint returns the same error shape
// (see HACKATHON.md > General Guidelines > Error Handling).

function sendError(res, status, error, message, details = {}) {
  return res.status(status).json({ error, message, details });
}

// JSON.GET with path '$' returns a JSON-encoded array like "[{...}]" (or null if missing).
// This unwraps it to the single document, or null.
function parseJsonGet(raw) {
  if (raw == null) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (Array.isArray(parsed)) return parsed.length ? parsed[0] : null;
  return parsed;
}

module.exports = { sendError, parseJsonGet };
