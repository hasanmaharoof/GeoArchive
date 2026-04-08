// client/minimap.js
import { API_BASE_URL } from './config.js';

/* ------------------ Helpers ------------------ */
function joinUrl(base, path) {
  const b = (base || '').trim();
  if (!b) return path;
  if (b === '/') return path;
  const cleanBase = b.endsWith('/') ? b.slice(0, -1) : b;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

async function loadFrontPageCount() {
  const el = document.getElementById('pre1900-count');
  if (!el) return;

  try {
    const url = joinUrl(API_BASE_URL, '/api/submissions/count-pre1900');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const n = Number(data.count);
    el.textContent = Number.isFinite(n) ? n.toLocaleString() : '—';
  } catch (e) {
    console.warn('Failed to load pre1900 count:', e);
    el.textContent = '—';
  }
}

// call it on load
document.addEventListener('DOMContentLoaded', () => {
  loadFrontPageCount();
});

function normalizeYear(year) {
  if (year === null || year === undefined) return null;
  const y = parseInt(String(year).trim(), 10);
  return Number.isFinite(y) ? y : null;
}

/* ------------------ Guard: only run if map exists ------------------ */
const element = document.getElementById('map');
if (!element) {
  console.warn('[minimap.js] #map not found, skipping minimap init.');
} else if (!window.L) {
  console.error('[minimap.js] Leaflet (L) not found. Make sure leaflet.js is loaded before minimap.js.');
} else {
  /* ------------------ Map setup ------------------ */
  const map = L.map(element, {
    minZoom: 2,
    maxZoom: 18,
    zoomControl: false,
    attributionControl: false
  });

  // Minimap world view
  map.setView(L.latLng(35, 0), 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    // Keep attribution off on minimap; main map page has it
    attribution: ''
  }).addTo(map);

  /* ------------------ Disable interactions: it's a preview ------------------ */
  map.dragging.disable();
  map.scrollWheelZoom.disable();
  map.doubleClickZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();
  map.touchZoom.disable();
  if (map.tap) map.tap.disable();

  // If you want: disable click events on markers too (optional)
  // map.off('click');

  /* ------------------ Marker Icons ------------------ */
  const LeafIcon = L.Icon.extend({
    options: {
      iconSize: [20, 32],
      iconAnchor: [11, 33],
      popupAnchor: [-1, -33]
    }
  });

  const markerIcons = {
    '1700s': new LeafIcon({ iconUrl: 'markers/1700s and below.png' }),
    '1800s_early': new LeafIcon({ iconUrl: 'markers/1800s early.png' }),
    '1800s_mid': new LeafIcon({ iconUrl: 'markers/1800s mid.png' }),
    '1800s_late': new LeafIcon({ iconUrl: 'markers/1800s late.png' }),
    '1900s': new LeafIcon({ iconUrl: 'markers/1900s.png' }),
    '1910s': new LeafIcon({ iconUrl: 'markers/1910s.png' }),
    '1920s': new LeafIcon({ iconUrl: 'markers/1920s.png' }),
    '1930s': new LeafIcon({ iconUrl: 'markers/1930s.png' }),
    'undated': new LeafIcon({ iconUrl: 'markers/unknown.png' })
  };

  /* ------------------ Data + render ------------------ */
  let allSubmissions = [];
  let markerLayer = L.layerGroup().addTo(map);

  async function fetchSubmissions() {
    try {
      const url = joinUrl(API_BASE_URL, '/api/submissions/approved');
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      allSubmissions = Array.isArray(data) ? data : [];
      renderMarkers();
    } catch (err) {
      console.error('[minimap.js] Error fetching markers:', err);
    }
  }

  function renderMarkers() {
    markerLayer.clearLayers();

    for (const submission of allSubmissions) {
      const { year, lat, lng, location } = submission;

      // Skip entries that are explicitly non-located
      if (location === false) continue;

      // Guard coords
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;

      const y = normalizeYear(year);

      // Pick icon
      let icon;
      if (y === null) icon = markerIcons.undated;
      else if (y < 1800) icon = markerIcons['1700s'];
      else if (y < 1850) icon = markerIcons['1800s_early'];
      else if (y < 1880) icon = markerIcons['1800s_mid'];
      else if (y < 1900) icon = markerIcons['1800s_late'];
      else if (y < 1910) icon = markerIcons['1900s'];
      else if (y < 1920) icon = markerIcons['1910s'];
      else if (y < 1930) icon = markerIcons['1920s'];
      else icon = markerIcons['1930s'];

      // Add marker (no popup on preview)
      const marker = L.marker([lat, lng], { icon, interactive: false });
      markerLayer.addLayer(marker);
    }
  }

  fetchSubmissions();

  // Optional: keep the map looking correct after font/layout changes
  // (Leaflet sometimes needs a resize invalidate)
  window.addEventListener('load', () => {
    setTimeout(() => map.invalidateSize(), 0);
  });
}
