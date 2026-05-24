// Challenge 14 — Google Gemini wrapper (chat / JSON generation).
// Uses the REST API via global fetch (Node 18+). No SDK dependency.
// Key + model come from env (see .env). Never hardcode the key.
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const isConfigured = () => Boolean(API_KEY);

// Ask Gemini for a JSON object. Returns the parsed object.
// Throws on missing key / HTTP error / unparseable output so callers can fall back.
async function generateJSON(systemPrompt, userPrompt) {
  if (!API_KEY) throw new Error('gemini_not_configured');

  const res = await fetch(`${BASE}/${MODEL}:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`gemini_http_${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini_empty_response');
  return JSON.parse(text);
}

module.exports = { generateJSON, isConfigured, MODEL };
