import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { API_BASE } from "../api/config";

// Challenge 11 UI — track a delivery in real time.
// Talks to the backend delivery API and subscribes to its SSE stream
// (GET /api/delivery/:id/track) so the location/ETA update live.
const DeliveryTracking = () => {
  const { trackingId: paramId } = useParams();
  const [trackingId, setTrackingId] = useState(paramId || "DEL-HYD-98765");
  const [tracking, setTracking] = useState(null);
  const [eta, setEta] = useState(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const esRef = useRef(null);

  const loadAndStream = async (id) => {
    setError("");
    setTracking(null);
    setEta(null);
    // Close any previous stream.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setLive(false);
    }
    try {
      const res = await fetch(`${API_BASE}/api/delivery/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Tracking ${id} not found`);
      }
      const doc = await res.json();
      setTracking(doc);
      setEta(doc.estimatedArrival || null);

      // Open the live stream.
      const es = new EventSource(`${API_BASE}/api/delivery/${id}/track`);
      es.addEventListener("snapshot", (e) => setTracking(JSON.parse(e.data)));
      es.addEventListener("location", (e) => {
        const update = JSON.parse(e.data);
        setTracking((prev) =>
          prev ? { ...prev, currentLocation: update.location, status: update.status } : prev
        );
        if (update.eta) setEta(update.eta.estimatedArrival);
      });
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      esRef.current = es;
    } catch (err) {
      setError(err.message);
    }
  };

  // Load tracking on mount / when the URL :trackingId changes; clean up on unmount.
  useEffect(() => {
    const id = paramId || "DEL-HYD-98765";
    setTrackingId(id);
    loadAndStream(id);
    return () => esRef.current && esRef.current.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramId]);

  const onTrack = (e) => {
    e.preventDefault();
    if (trackingId.trim()) loadAndStream(trackingId.trim());
  };

  const loc = tracking?.currentLocation;
  const mapUrl = loc ? `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=14/${loc.lat}/${loc.lng}` : null;

  return (
    <section className="py-80">
      <div className="container container-lg">
        <div className="row justify-content-center">
          <div className="col-xl-8">
            {/* Tracking lookup */}
            <form onSubmit={onTrack} className="d-flex gap-12 mb-32 flex-wrap">
              <input
                type="text"
                className="common-input flex-grow-1"
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
                placeholder="Enter tracking ID (e.g. DEL-HYD-98765)"
              />
              <button type="submit" className="btn btn-main py-18 px-40">
                Track
              </button>
            </form>

            {error && (
              <div className="bg-danger-50 text-danger-600 border border-danger-100 rounded-12 px-24 py-16 mb-24">
                <i className="ph ph-warning me-8" />
                {error}
              </div>
            )}

            {tracking && (
              <div className="border border-gray-100 rounded-16 px-24 py-32">
                {/* Status header */}
                <div className="flex-between flex-wrap gap-16 mb-24">
                  <div>
                    <h6 className="mb-4">Tracking {tracking.trackingId}</h6>
                    <span className="text-gray-500 text-sm">Order: {tracking.orderId}</span>
                  </div>
                  <span className="bg-main-50 text-main-600 px-20 py-8 rounded-pill fw-medium text-uppercase">
                    {String(tracking.status).replace("_", " ")}
                  </span>
                </div>

                {/* Live position + ETA */}
                <div className="row gy-3 mb-24">
                  <div className="col-sm-6">
                    <p className="text-gray-500 text-sm mb-4">
                      Current location {live && <span className="text-success-600">● live</span>}
                    </p>
                    <p className="fw-medium">
                      {loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : "—"}
                    </p>
                    {mapUrl && (
                      <a href={mapUrl} target="_blank" rel="noreferrer" className="text-main-600 text-sm hover-text-decoration-underline">
                        View on map <i className="ph ph-arrow-up-right" />
                      </a>
                    )}
                  </div>
                  <div className="col-sm-6">
                    <p className="text-gray-500 text-sm mb-4">Estimated arrival</p>
                    <p className="fw-medium">
                      {eta ? new Date(eta).toLocaleString() : "—"}
                    </p>
                  </div>
                </div>

                {/* History timeline */}
                <h6 className="text-md mb-16">History</h6>
                <ul className="list-unstyled">
                  {[...tracking.history].reverse().map((h, i) => (
                    <li key={i} className="d-flex gap-12 mb-12">
                      <i className="ph-fill ph-circle text-main-600 mt-4" />
                      <div>
                        <span className="fw-medium text-capitalize">{h.status.replace("_", " ")}</span>
                        <span className="text-gray-500 text-sm d-block">
                          {new Date(h.timestamp).toLocaleString()} · {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default DeliveryTracking;
