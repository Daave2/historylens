import { lookupPlaceInfo, searchAddress } from '../data/geocode.js';

export default class PlaceForm {
  constructor({ onSave, onCancel, onPickLocation, mapView }) {
    this.modal = document.getElementById('place-form-modal');
    this.content = document.getElementById('place-form-content');
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.onPickLocation = onPickLocation;
    this.mapView = mapView;
    this.pendingLatLng = null;
    this.lookupResult = null;
    this._searchTimer = null;

    this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  async show(latLng) {
    this.pendingLatLng = latLng;
    this.lookupResult = null;

    this.content.innerHTML = `
      <h2 style="font-family: var(--font-heading); margin-bottom: var(--space-lg);">Add New Place</h2>

      <!-- Address Search Bar -->
      <div class="form-group" style="position: relative;">
        <label class="form-label">🔍 Search Address</label>
        <input class="form-input" id="pf-search" type="text"
               placeholder="Type an address, e.g. 4 Gordon Street, Blackpool"
               autocomplete="off"
               style="font-size: var(--text-md); padding: var(--space-sm) var(--space-md);" />
        <div id="pf-search-results" style="
          display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 1000;
          background: var(--bg-surface); border: 1px solid var(--glass-border);
          border-radius: 0 0 var(--radius-md) var(--radius-md);
          max-height: 260px; overflow-y: auto; box-shadow: var(--shadow-lg);
        "></div>
      </div>

      <div style="display:flex; align-items:center; gap: var(--space-sm); margin: var(--space-sm) 0 var(--space-md);">
        <div style="flex:1; height:1px; background: var(--glass-border);"></div>
        <span style="font-size: var(--text-xs); color: var(--text-muted);">or click the map</span>
        <div style="flex:1; height:1px; background: var(--glass-border);"></div>
      </div>

      <div class="form-group">
        <label class="form-label">Place Name</label>
        <input class="form-input" id="pf-name" type="text" placeholder="Will auto-fill from search or map click" />
        <span class="form-hint" id="pf-address-hint" style="color: var(--accent);"></span>
      </div>

      <div class="form-group">
        <label class="form-label">Category</label>
        <select class="form-select" id="pf-category">
          <option value="residential">🏠 Residential</option>
          <option value="commercial">🏪 Commercial</option>
          <option value="landmark">⭐ Landmark</option>
          <option value="natural">🌳 Natural Feature</option>
          <option value="infrastructure">🏗️ Infrastructure</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Location</label>
        <div class="form-row">
          <input class="form-input" id="pf-lat" type="number" step="any" placeholder="Latitude" value="${latLng?.lat?.toFixed(6) || ''}" />
          <input class="form-input" id="pf-lng" type="number" step="any" placeholder="Longitude" value="${latLng?.lng?.toFixed(6) || ''}" />
        </div>
      </div>

      <!-- Discovered info panel -->
      <div id="pf-discovered" style="display:none;"></div>

      <div style="display: flex; gap: var(--space-sm); justify-content: flex-end; margin-top: var(--space-xl);">
        <button class="btn btn-ghost" id="pf-cancel">Cancel</button>
        <button class="btn btn-primary" id="pf-save">Add Place</button>
      </div>
    `;

    // Wire events
    this.content.querySelector('#pf-cancel').addEventListener('click', () => this.close());
    this.content.querySelector('#pf-save').addEventListener('click', () => this.save());
    this.content.querySelector('#pf-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.save();
    });

    // Address search with debounce
    const searchInput = this.content.querySelector('#pf-search');
    searchInput.addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.doSearch(searchInput.value), 350);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.content.querySelector('#pf-search-results').style.display = 'none';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = this.content.querySelector('#pf-search-results');
      if (dropdown && !dropdown.contains(e.target) && e.target.id !== 'pf-search') {
        dropdown.style.display = 'none';
      }
    }, { once: false });

    this.modal.style.display = 'flex';

    // If opened from a map click, pre-fill and lookup
    if (latLng) {
      searchInput.focus();
      this.runLookup(latLng.lat, latLng.lng);
    } else {
      searchInput.focus();
    }
  }

  async doSearch(query) {
    const resultsEl = this.content.querySelector('#pf-search-results');
    if (!query || query.length < 3) {
      resultsEl.style.display = 'none';
      return;
    }

    resultsEl.innerHTML = `<div style="padding: var(--space-md); color: var(--text-muted); font-size: var(--text-sm);">Searching…</div>`;
    resultsEl.style.display = 'block';

    // Get the current map view bounds to bias results
    let viewbox = '';
    if (this.mapView?.map) {
      const b = this.mapView.map.getBounds();
      viewbox = `${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
    }

    const results = await searchAddress(query, { limit: 8, bounded: false, viewbox });

    if (results.length === 0) {
      resultsEl.innerHTML = `<div style="padding: var(--space-md); color: var(--text-muted); font-size: var(--text-sm);">No results found. Try adding a town name.</div>`;
      return;
    }

    resultsEl.innerHTML = results.map((r, i) => {
      const primary = r.displayName || r.fullAddress.split(',')[0];
      const secondary = r.fullAddress.split(',').slice(1, 4).join(',').trim();
      const icon = this.getCategoryIcon(r);

      return `
        <div class="search-result-item" data-index="${i}" style="
          padding: var(--space-sm) var(--space-md); cursor: pointer;
          border-bottom: 1px solid var(--glass-border);
          transition: background 0.15s;
        " onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
          <div style="display:flex; align-items:center; gap: var(--space-sm);">
            <span style="font-size: 16px; flex-shrink:0;">${icon}</span>
            <div style="min-width:0;">
              <div style="font-size: var(--text-sm); font-weight: 500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${primary}
              </div>
              <div style="font-size: var(--text-xs); color: var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${secondary}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Wire click handlers
    resultsEl.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        const result = results[idx];
        this.selectSearchResult(result);
        resultsEl.style.display = 'none';
      });
    });
  }

  getCategoryIcon(result) {
    const t = `${result.type} ${result.category}`.toLowerCase();
    if (/house|residential|apartments/.test(t)) return '🏠';
    if (/shop|commercial|retail|restaurant|cafe|pub|hotel/.test(t)) return '🏪';
    if (/church|monument|historic|museum|castle/.test(t)) return '🏛️';
    if (/park|garden|wood|water|natural/.test(t)) return '🌳';
    if (/school|hospital|station|railway/.test(t)) return '🏗️';
    if (/road|street|highway/.test(t)) return '📍';
    return '📌';
  }

  async selectSearchResult(result) {
    this.pendingLatLng = { lat: result.lat, lng: result.lng };

    // Update form fields
    const nameInput = this.content.querySelector('#pf-name');
    nameInput.value = result.displayName;
    this.content.querySelector('#pf-lat').value = result.lat.toFixed(6);
    this.content.querySelector('#pf-lng').value = result.lng.toFixed(6);

    // Update search input to show what was selected
    const searchInput = this.content.querySelector('#pf-search');
    searchInput.value = result.fullAddress.split(',').slice(0, 3).join(',').trim();

    // Pan map to result
    if (this.mapView?.map) {
      this.mapView.map.setView([result.lat, result.lng], 18);
    }

    // Run full lookup
    await this.runLookup(result.lat, result.lng);
  }

  async runLookup(lat, lng) {
    const hintEl = this.content.querySelector('#pf-address-hint');
    const discoveredEl = this.content.querySelector('#pf-discovered');
    const nameInput = this.content.querySelector('#pf-name');
    const catSelect = this.content.querySelector('#pf-category');

    hintEl.textContent = '📍 Looking up details…';
    discoveredEl.style.display = 'none';

    const info = await lookupPlaceInfo(lat, lng);
    this.lookupResult = info;

    if (info.address) {
      // Pre-fill name only if empty
      if (!nameInput.value && info.suggestedName) {
        nameInput.value = info.suggestedName;
      }
      nameInput.placeholder = 'e.g. 4 Gordon Street';

      // Address hint
      const addr = info.address;
      const fullParts = [addr.houseNumber, addr.road, addr.suburb, addr.city, addr.postcode].filter(Boolean);
      hintEl.textContent = `📍 ${fullParts.join(', ') || addr.fullAddress}`;
      hintEl.title = addr.fullAddress;

      // Category
      catSelect.value = info.suggestedCategory;
    } else {
      hintEl.textContent = '';
      nameInput.placeholder = 'e.g. 4 Gordon Street';
    }

    // Show discovered info
    if (info.autoEntries.length > 0 || info.wikiSummary) {
      discoveredEl.style.display = 'block';
      discoveredEl.innerHTML = this.renderDiscoveredInfo(info);
    }
  }

  renderDiscoveredInfo(info) {
    let html = `
      <div style="border-top: 1px solid var(--glass-border); padding-top: var(--space-lg); margin-top: var(--space-md);">
        <div style="display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-md);">
          <span style="font-size: var(--text-sm); font-weight: 600; color: var(--accent);">✨ Discovered Info</span>
          <span style="font-size: var(--text-xs); color: var(--text-muted);">— tick items to add as timeline entries</span>
        </div>
    `;

    // Group entries by type
    const wikiEntries = info.autoEntries.filter(e => e.source === 'Wikipedia' || (e.sourceType === 'archive' && e.source !== 'OpenStreetMap' && e.source !== 'HistoryLens — building age estimation' && e.source !== 'HistoryLens — area context'));
    const osmEntries = info.autoEntries.filter(e => e.source === 'OpenStreetMap');
    const buildingEntries = info.autoEntries.filter(e => e.source === 'HistoryLens — building age estimation');
    const areaEntries = info.autoEntries.filter(e => e.source === 'HistoryLens — area context');

    if (wikiEntries.length > 0) html += this.renderGroup('📖 Wikipedia & Research', wikiEntries, info, '#60a5fa');
    if (osmEntries.length > 0) html += this.renderGroup('📍 Nearby Features (OpenStreetMap)', osmEntries, info, '#f59e0b');
    if (buildingEntries.length > 0) html += this.renderGroup('🏠 Building Age Estimate', buildingEntries, info, '#a78bfa');
    if (areaEntries.length > 0) html += this.renderGroup('🗺️ Area Context', areaEntries, info, '#34d399');

    if (info.autoEntries.length === 0) {
      html += `
        <div style="font-size: var(--text-xs); color: var(--text-muted); padding: var(--space-sm);">
          No additional info found. You can add details manually after creating the place.
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  renderGroup(label, entries, info, colour) {
    let html = `
      <div style="margin-bottom: var(--space-md);">
        <div style="font-size: var(--text-xs); font-weight: 600; color: ${colour}; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: var(--space-xs);">${label}</div>
    `;

    for (const entry of entries) {
      const idx = info.autoEntries.indexOf(entry);
      const yearText = entry.yearStart
        ? (entry.yearEnd ? `${entry.yearStart}–${entry.yearEnd}` : `From ${entry.yearStart}`)
        : '';

      const confBadge = entry.confidence === 'speculative'
        ? '<span style="background:rgba(94,93,88,0.2);color:var(--text-muted);padding:1px 6px;border-radius:99px;font-size:10px;">speculative</span>'
        : entry.confidence === 'verified'
          ? '<span style="background:rgba(74,222,128,0.15);color:var(--success);padding:1px 6px;border-radius:99px;font-size:10px;">verified</span>'
          : '<span style="background:rgba(251,191,36,0.15);color:var(--warning);padding:1px 6px;border-radius:99px;font-size:10px;">likely</span>';

      html += `
        <div style="background:var(--bg-surface);border:1px solid var(--glass-border);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-xs);">
          <label style="display:flex;gap:var(--space-sm);cursor:pointer;align-items:flex-start;">
            <input type="checkbox" class="auto-entry-check" data-index="${idx}" checked style="margin-top:3px;accent-color:${colour};" />
            <div style="flex:1;min-width:0;">
              ${yearText ? `<div style="font-size:var(--text-xs);color:${colour};font-weight:500;">${yearText}</div>` : ''}
              <div style="font-size:var(--text-sm);font-weight:500;">${entry.title}</div>
              <div style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:4px;line-height:1.5;">
                ${truncate(entry.summary, 220)}
              </div>
              <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;display:flex;align-items:center;gap:var(--space-sm);">
                ${confBadge}
                ${entry.sourceUrl ? `<a href="${entry.sourceUrl}" target="_blank" style="color:var(--accent);">Read more ↗</a>` : ''}
              </div>
            </div>
          </label>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  setLatLng(latLng) {
    this.pendingLatLng = latLng;
    const latInput = this.content.querySelector('#pf-lat');
    const lngInput = this.content.querySelector('#pf-lng');
    if (latInput) latInput.value = latLng.lat.toFixed(6);
    if (lngInput) lngInput.value = latLng.lng.toFixed(6);
  }

  save() {
    const name = this.content.querySelector('#pf-name').value.trim();
    const category = this.content.querySelector('#pf-category').value;
    const lat = parseFloat(this.content.querySelector('#pf-lat').value);
    const lng = parseFloat(this.content.querySelector('#pf-lng').value);

    if (!name) {
      this.content.querySelector('#pf-name').style.borderColor = 'var(--danger)';
      return;
    }
    if (isNaN(lat) || isNaN(lng)) {
      alert('Please search for an address or click the map to set a location.');
      return;
    }

    // Collect checked auto entries
    const selectedEntries = [];
    if (this.lookupResult) {
      const checkboxes = this.content.querySelectorAll('.auto-entry-check:checked');
      checkboxes.forEach(cb => {
        const idx = parseInt(cb.dataset.index);
        const entry = this.lookupResult.autoEntries[idx];
        if (entry) selectedEntries.push(entry);
      });
    }

    this.onSave?.({ name, category, lat, lng, autoEntries: selectedEntries });
    this.close();
  }

  close() {
    this.modal.style.display = 'none';
    this.lookupResult = null;
    clearTimeout(this._searchTimer);
    this.onCancel?.();
  }
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  return text.substring(0, max).replace(/\s+\S*$/, '') + '…';
}
