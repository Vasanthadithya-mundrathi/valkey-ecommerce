// Shared Express app for the Valkey E-Commerce Demo backend.
//
// HOW TEAMMATES ADD A CHALLENGE (keeps merges conflict-free):
//   1. Create  src/routes/<your-feature>.js  exporting an express.Router().
//   2. Add ONE require + ONE app.use(...) line in the marked block below.
//   3. Reuse src/valkey.js and src/lib/* — never open a second Valkey connection.
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ---- challenge routers (one line per member) -------------------------------
app.use('/api/delivery', require('./routes/delivery')); // Challenge 11 — Delivery + Geo
app.use('/api/ratelimit', require('./routes/ratelimit')); // Challenge 12 — Rate Limiting (demo)
app.use('/api/recommendations', require('./routes/recommendations')); // Challenge 13 — Recommendations
app.use('/api/agent', require('./routes/agent').router); // Challenge 14 — Agentic Search (Gemini)
// app.use('/api/auth',     require('./routes/auth'));      // Challenge 1
// app.use('/api/products', require('./routes/products'));  // Challenge 2
// app.use('/api/cart',     require('./routes/cart'));      // Challenge 3
// ... add yours here ...
// ----------------------------------------------------------------------------

// 404 + error fallbacks in the shared error shape.
app.use((req, res) => res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}`, details: {} }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error', message: err.message, details: {} });
});

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
}

module.exports = app;
