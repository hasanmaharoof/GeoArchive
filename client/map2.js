//client/map.js
import { API_BASE_URL } from './config.js';
let autoFocusDone = false;

/* ------------------ Query params (must be defined BEFORE fetch) ------------------ */
function getQueryParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const lat = parseFloat(urlParams.get('lat'));
  const lng = parseFloat(urlParams.get('lng'));
  const id = urlParams.get('id');
  const year = urlParams.get('year'); // ✅ add
  return { lat, lng, id, year };
}

const { lat: targetLat, lng: targetLng, id: targetId, year: targetYearRaw } = getQueryParams();

/* ------------------ Helpers ------------------ */
function joinUrl(base, path) {
  const b = (base || '').trim();
  if (!b) return path;
  if (b === '/') return path;
  const cleanBase = b.endsWith('/') ? b.slice(0, -1) : b;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function normalizeYear(year) {
  if (year === null || year === undefined) return null;

  // Handles numbers, "1920", "1920 ", "1920-01-01", etc.
  const y = parseInt(String(year).trim(), 10);

  return Number.isFinite(y) ? y : null;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeHttpUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function openImageModal(src) {
  const modal = document.getElementById('imageModal');
  const modalImg = document.getElementById('modalImage');
  const closeBtn = document.querySelector('#imageModal .close');

  if (!modal || !modalImg) return;

  modal.classList.add('active');
  modalImg.src = src || '';

  // Close button
  if (closeBtn) {
    closeBtn.onclick = () => (modal.style.display = 'none');
  }

  // Click outside image closes
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.remove('active');;
  };

  // ESC closes
  document.addEventListener('keydown', function escClose(ev) {
    if (ev.key === 'Escape') {
      modal.classList.remove('active');;
      document.removeEventListener('keydown', escClose);
    }
  });
}

// Turns: "Title. Publisher. 1920 (https://...)" into:
// '<a href="https://...">Title</a>. Publisher. 1920'
function sourceToLinkedHtml(sourceText) {
  if (!sourceText) return 'N/A';

  const raw = String(sourceText).trim();

  const match = raw.match(/\((https?:\/\/[^\s)]+)\)\s*$/i);
  if (!match) return escapeHtml(raw);

  const url = match[1];
  if (!isSafeHttpUrl(url)) return escapeHtml(raw);

  const withoutUrl = raw.replace(/\s*\((https?:\/\/[^\s)]+)\)\s*$/i, '').trim();

  const dotIndex = withoutUrl.indexOf('. ');
  const title = dotIndex === -1 ? withoutUrl : withoutUrl.slice(0, dotIndex);
  const rest = dotIndex === -1 ? '' : withoutUrl.slice(dotIndex);

  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>${escapeHtml(rest)}`;
}

function bumpYearSliderTo(atLeastYear) {
  const rangeInput = document.getElementById('yearRange');
  const rangeLabel = document.getElementById('rangeLabel');
  if (!rangeInput || !rangeLabel) return;

  const y = normalizeYear(atLeastYear);
  if (y === null) return;

  const min = parseInt(rangeInput.min, 10);
  const max = parseInt(rangeInput.max, 10);

  // Clamp to slider range
  const clamped = Math.max(min, Math.min(max, y));

  const current = parseInt(rangeInput.value, 10);
  if (Number.isFinite(current) && current >= clamped) return;

  rangeInput.value = String(clamped);

  // Keep your current label rule:
  // if slider at min (1830), show "Before 1830", otherwise "Up to X"
  const minVal = parseInt(rangeInput.min, 10);
  rangeLabel.textContent = (clamped === minVal) ? `Before ${minVal}` : `Up to ${clamped}`;
}

/* ------------------ Map setup ------------------ */
const element = document.getElementById('map');

// World-ish default: shows most landmasses without feeling too “zoomed in”
const DEFAULT_CENTER = L.latLng(20, 0); // near Africa / Atlantic (good “world” center)
const DEFAULT_ZOOM = 2;

const map = L.map(element, {
  minZoom: 2,
  maxZoom: 18,
  zoom: DEFAULT_ZOOM,
  worldCopyJump: true
});

map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

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
  '1800s_early': new LeafIcon({ iconUrl: 'markers/1800s early.png', className: 'marker-1800s-early' }),
  '1800s_mid': new LeafIcon({ iconUrl: 'markers/1800s mid.png' }),
  '1800s_late': new LeafIcon({ iconUrl: 'markers/1800s late.png' }),
  '1900s': new LeafIcon({ iconUrl: 'markers/1900s.png' }),
  '1910s': new LeafIcon({ iconUrl: 'markers/1910s.png' }),
  '1920s': new LeafIcon({ iconUrl: 'markers/1920s.png' }),
  '1930s': new LeafIcon({ iconUrl: 'markers/1930s.png' }),
  'undated': new LeafIcon({ iconUrl: 'markers/unknown.png' }),
};

/* ------------------ Global state ------------------ */
let allSubmissions = [];
let markerLayer = L.layerGroup().addTo(map);

/* ------------------ Load Dynamic Markers ------------------ */
async function fetchSubmissions() {
  try {
    const url = joinUrl(API_BASE_URL, '/api/submissions/approved');
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    console.log('Loaded marker data:', data);
    allSubmissions = data;

    // ✅ Fallback: if we have a targetId but no year param, infer the year from the record
    if (targetId && !normalizeYear(targetYearRaw)) {
      const rec = allSubmissions.find(r => String(r.id) === String(targetId));
      if (rec && rec.year) bumpYearSliderTo(rec.year);
      if (rec && !rec.year) {
        // optional: if it's undated, ensure undated are visible
        const includeUndated = document.getElementById('includeUndated');
        if (includeUndated) includeUndated.checked = true;
      }
    }

    renderMarkers();
  } catch (err) {
    console.error('Error fetching markers:', err);
  }
}

/* ------------------ Render Markers with Filtering ------------------ */
function renderMarkers() {
  // Clear existing markers
  markerLayer.clearLayers();

  const maxYear = parseInt(document.getElementById('yearRange').value, 10);
  const includeUndated = document.getElementById('includeUndated').checked;

  allSubmissions.forEach(submission => {
    const {
      id,
      caption,
      source,
      photographer,
      year,
      month,
      day,
      estimated,
      photo_url,
      lat,
      lng,
      location
    } = submission;

    const y = normalizeYear(year);

    // Apply year filter
    if (y !== null) {
      if (y > maxYear) return;   // ✅ year <= maxYear passes, so <=1830 includes everything earlier too
    } else {
      if (!includeUndated) return;
    }

    // Skip rendering markers if location is false
    if (location === false) {
      console.warn(`Skipping submission ${id} because location is false.`);
      return;
    }

    // Guard against missing coords
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      console.warn(`Skipping submission ${id} due to missing/invalid lat/lng`, { lat, lng });
      return;
    }

    // Determine icon based on year
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

    // Build formatted date
    let dateStr = '';
    if (y !== null) {
      dateStr = `${y}`;
      if (month) {
        const monthName = new Date(y, month - 1).toLocaleString('default', { month: 'long' });
        dateStr = `${monthName} ${y}`;
        if (day) dateStr = `${monthName} ${day}, ${y}`;
      }
    }
    const formattedDate = dateStr ? (estimated ? `c. ${dateStr}` : dateStr) : 'Date unknown';

    // Create popup HTML
    const safePhoto = photo_url ? String(photo_url) : '';
    const popupHTML = `
      <h3>${formattedDate}</h3>

      <div class="caption-container">
        <p class="caption">${escapeHtml(caption || 'No caption provided.')}</p>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <small class="source-toggle" style="cursor:pointer; color:#0078a8; user-select:none;">[source]</small>
          <small class="entry-id" style="font-size: 12px;">
            <a href="database.html?id=${id}" style="color:#888; text-decoration:none;">[${id}]</a>
          </small>
        </div>

        <div class="source-details" style="display:none;">
          <p>${sourceToLinkedHtml(source)}</p>
          ${photographer ? `<p><b>Photographer:</b> ${escapeHtml(photographer)}</p>` : ''}
        </div>
      </div>

      ${safePhoto ? `<img class="popup-photo" src="${safePhoto}" alt="" loading="lazy">` : ''}
    `;

    // Add marker to layer
    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(popupHTML, { maxWidth: 280 });
    markerLayer.addLayer(marker);

    // If matches query param, pan and open popup (ONLY ONCE)
    if (
      !autoFocusDone &&
      String(id) === String(targetId)   // (recommend id-only; coords can fail due to rounding)
    ) {
      autoFocusDone = true;

      map.setView([lat, lng], 17);
      marker.openPopup();

      // Remove query params so slider browsing doesn't keep snapping back
      const cleanUrl = `${window.location.pathname}`; // "map.html"
      history.replaceState({}, "", cleanUrl);
    }
  });
}

/* ------------------ Filter Event Listeners ------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const rangeInput = document.getElementById('yearRange');
  const rangeLabel = document.getElementById('rangeLabel');
  const includeUndated = document.getElementById('includeUndated');

  bumpYearSliderTo(targetYearRaw);

  // ✅ Prevent Leaflet from hijacking slider drag / clicks
  const filterPanel = document.querySelector('.filter-panel');
  if (filterPanel && window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(filterPanel);
    L.DomEvent.disableScrollPropagation(filterPanel);
    if (L.DomEvent.disableDragPropagation) {
      L.DomEvent.disableDragPropagation(filterPanel);
    }
  }

  function updateRangeLabel() {
    const val = parseInt(rangeInput.value, 10);
    const minVal = parseInt(rangeInput.min, 10);
    rangeLabel.textContent = (val === minVal) ? `Before ${minVal}` : `Up to ${val}`;
  }

  rangeInput.addEventListener('input', () => {
    updateRangeLabel();
    renderMarkers();
  });

  rangeInput.addEventListener('change', () => {
    updateRangeLabel();
    renderMarkers();
  });

  includeUndated.addEventListener('change', () => {
    renderMarkers();
  });

  updateRangeLabel();
  fetchSubmissions();
});

/* ------------------ Popup behavior ------------------ */
map.on('popupopen', e => {
  // Make popup image clickable to open modal
  const popupImg = e.popup._contentNode.querySelector('img.popup-photo');
  if (popupImg) {
    popupImg.style.cursor = 'zoom-in';

    // Prevent map drag/zoom when clicking the image
    popupImg.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openImageModal(popupImg.src);
    }, { once: true });
  }
  
  const container = e.popup._contentNode.querySelector('.caption-container');
  if (!container) return;

  const caption = container.querySelector('.caption');
  const sourceToggle = container.querySelector('.source-toggle');
  const sourceDetails = container.querySelector('.source-details');

  if (sourceToggle) sourceToggle.style.display = 'inline';
  if (sourceDetails) sourceDetails.style.display = 'none';

  if (sourceToggle && sourceDetails) {
    sourceToggle.onclick = ev => {
      ev.preventDefault();
      sourceDetails.style.display = sourceDetails.style.display === 'block' ? 'none' : 'block';
    };
  }

  if (!caption) return;

  const fullText = caption.innerHTML;
  const needsTruncation = caption.innerText.length > 100;

  let toggle = container.querySelector('.show-more-toggle');
  if (!toggle && needsTruncation) {
    toggle = document.createElement('a');
    toggle.href = '#';
    toggle.className = 'show-more-toggle';
    toggle.style.color = '#0078a8';
    toggle.style.cursor = 'pointer';
    toggle.style.userSelect = 'none';
    toggle.style.fontSize = '13px';
    toggle.innerText = 'Show more';
  }

  if (needsTruncation && toggle) {
    const shortText = fullText.slice(0, 100) + '...';

    caption.innerHTML = shortText;
    caption.appendChild(toggle);
    toggle.innerText = 'Show more';
    if (sourceDetails) sourceDetails.style.display = 'none';

    toggle.onclick = ev => {
      ev.preventDefault();
      const isShort = caption.innerHTML.startsWith(shortText);
      if (isShort) {
        caption.innerHTML = fullText;
        toggle.innerText = 'Show less';
      } else {
        caption.innerHTML = shortText;
        toggle.innerText = 'Show more';
        if (sourceDetails) sourceDetails.style.display = 'none';
      }
      caption.appendChild(toggle);
    };
  }
});