import React, { useRef, useState } from "react";
import { API_BASE } from "../api/config";

// Challenge 14 UI — conversational AI search. Keeps a sessionId so follow-ups
// like "show me cheaper options" use the backend's stored conversation context.
const SUGGESTIONS = [
  "I need a good smartphone under 100000",
  "Something for the kitchen under 5000",
  "Gift for a sports lover",
];

const AgentSearch = () => {
  const [messages, setMessages] = useState([]); // {role, text, results?, followUp?}
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef(null);

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/agent/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionRef.current, message: q }),
      });
      const data = await res.json();
      sessionRef.current = data.sessionId;
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: data.response,
          results: data.results || [],
          followUp: data.followUp,
          source: data.source,
        },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "agent", text: "Sorry, I couldn't reach the search service." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="py-80">
      <div className="container container-lg">
        <div className="row justify-content-center">
          <div className="col-xl-9">
            {/* Suggestions */}
            {messages.length === 0 && (
              <div className="mb-32">
                <p className="text-gray-500 mb-16">Try asking:</p>
                <div className="d-flex gap-12 flex-wrap">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="btn btn-outline-main btn-sm px-16 py-8 rounded-pill" onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conversation */}
            <div className="d-flex flex-column gap-20 mb-32">
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-end" : ""}>
                  <div
                    className={`d-inline-block text-start px-20 py-12 rounded-16 ${
                      m.role === "user" ? "bg-main-600 text-white" : "bg-gray-50 border border-gray-100"
                    }`}
                    style={{ maxWidth: "100%" }}
                  >
                    {m.text}
                  </div>

                  {/* Result cards */}
                  {m.results && m.results.length > 0 && (
                    <div className="row gy-3 mt-16">
                      {m.results.map((p) => (
                        <div className="col-6 col-md-4" key={p.productId}>
                          <div className="border border-gray-100 rounded-12 p-12 h-100">
                            {p.image && (
                              <div className="bg-gray-50 rounded-8 mb-8 flex-center" style={{ height: 90, overflow: "hidden" }}>
                                <img src={p.image} alt={p.name} style={{ maxHeight: "100%", objectFit: "contain" }}
                                  onError={(e) => (e.target.style.display = "none")} />
                              </div>
                            )}
                            <span className="fw-medium text-sm d-block">{p.name}</span>
                            {p.price != null && <span className="text-main-600 fw-semibold">₹{p.price.toLocaleString()}</span>}
                            <span className="text-gray-500 text-xs d-block mt-4">{p.reason}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {m.followUp && <p className="text-gray-500 text-sm mt-12 fst-italic">{m.followUp}</p>}
                </div>
              ))}
              {loading && <p className="text-gray-500">Thinking…</p>}
            </div>

            {/* Input */}
            <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="d-flex gap-12">
              <input
                type="text"
                className="common-input flex-grow-1"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe what you're looking for…"
              />
              <button type="submit" className="btn btn-main py-18 px-40" disabled={loading}>
                Ask
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AgentSearch;
