// Lightweight factories/validators for the shared data contracts in HACKATHON.md.
// Kept dependency-free on purpose. Challenge 11 (Delivery) uses makeTracking + validateLatLng.

function validateLatLng(lat, lng) {
  const nlat = Number(lat);
  const nlng = Number(lng);
  if (Number.isNaN(nlat) || Number.isNaN(nlng)) return null;
  if (nlat < -90 || nlat > 90 || nlng < -180 || nlng > 180) return null;
  return { lat: nlat, lng: nlng };
}

// Delivery tracking document (HACKATHON.md > Challenge 11).
function makeTracking({
  trackingId,
  orderId,
  agentId,
  status = 'pending',
  pickupLocation,
  dropLocation,
  currentLocation,
  estimatedArrival = null,
}) {
  return {
    trackingId,
    orderId,
    agentId,
    status, // pending | picked_up | in_transit | delivered | cancelled
    pickupLocation,
    dropLocation,
    currentLocation: currentLocation || pickupLocation,
    estimatedArrival,
    history: [],
  };
}

const DELIVERY_STATUSES = ['pending', 'picked_up', 'in_transit', 'delivered', 'cancelled'];

module.exports = { validateLatLng, makeTracking, DELIVERY_STATUSES };
