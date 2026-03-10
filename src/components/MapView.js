import L from 'leaflet';

const CATEGORY_COLOURS = {
    residential: '#a78bfa',
    commercial: '#f59e0b',
    landmark: '#f472b6',
    natural: '#34d399',
    infrastructure: '#60a5fa'
};

const CATEGORY_ICONS = {
    residential: '🏠',
    commercial: '🏪',
    landmark: '⭐',
    natural: '🌳',
    infrastructure: '🏗️'
};

const BASEMAPS = [
    {
        id: 'osm-detailed',
        label: 'Streets',
        hint: 'Best for finding homes and shops',
        tone: 'clear',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            maxZoom: 19,
            subdomains: 'abc',
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }
    },
    {
        id: 'carto-voyager',
        label: 'Clean',
        hint: 'Balanced readability for browsing',
        tone: 'dim',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        options: {
            maxZoom: 19,
            subdomains: 'abcd',
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>'
        }
    },
    {
        id: 'esri-satellite',
        label: 'Satellite',
        hint: 'Aerial imagery for roof-level context',
        tone: 'clear',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
            maxZoom: 19,
            attribution: 'Tiles © <a href="https://www.esri.com/">Esri</a>'
        }
    }
];

export default class MapView {
    constructor(containerId, { centre, zoom, onMapClick, onMarkerClick, onMarkerHover, onMarkerLeave }) {
        this.container = document.getElementById(containerId);
        this.onMapClick = onMapClick;
        this.onMarkerClick = onMarkerClick;
        this.onMarkerHover = onMarkerHover;
        this.onMarkerLeave = onMarkerLeave;
        this.markers = new Map(); // placeId -> L.Marker
        this.baseLayers = new Map(); // basemapId -> { config, layer }
        this.activeBaseMapId = null;
        this.satelliteDetailLayer = null; // roads + labels reference overlay
        this.satelliteDetailEnabled = false;
        this.addMode = false;

        // Initialise Leaflet
        this.map = L.map(this.container, {
            center: [centre.lat, centre.lng],
            zoom: zoom || 15,
            zoomControl: false,
            attributionControl: false
        });

        // Attribution in bottom-right
        this.attributionControl = L.control.attribution({ position: 'bottomright', prefix: false }).addTo(this.map);

        this.initBaseLayers();
        this.satelliteDetailLayer = this.createSatelliteDetailLayer();
        this.buildBaseMapUI();
        this.setBaseMap('osm-detailed');

        // Map clicks are only forwarded while an add/suggest flow is active.
        this.map.on('click', (e) => {
            if (!this.addMode) return;
            if (this.onMapClick) {
                this.onMapClick(e.latlng);
            }
        });

        // Fix tile rendering when container resizes
        setTimeout(() => this.map.invalidateSize(), 100);
    }

    setAddMode(enabled) {
        this.addMode = enabled;
        this.container.style.cursor = enabled ? 'crosshair' : '';
    }

    initBaseLayers() {
        BASEMAPS.forEach(config => {
            this.baseLayers.set(config.id, {
                config,
                layer: this.createBaseLayer(config)
            });
        });
    }

    createBaseLayer(config) {
        const baseLayer = L.tileLayer(config.url, config.options);
        if (!config.overlayUrl) return baseLayer;

        const labelLayer = L.tileLayer(config.overlayUrl, config.overlayOptions || {});
        return L.layerGroup([baseLayer, labelLayer]);
    }

    createSatelliteDetailLayer() {
        const roadsLayer = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Reference © <a href="https://www.esri.com/">Esri</a>'
        });
        const labelsLayer = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        });
        return L.layerGroup([roadsLayer, labelsLayer]);
    }

    buildBaseMapUI() {
        const panel = document.createElement('div');
        panel.id = 'basemap-panel';
        panel.className = 'glass-panel';
        panel.innerHTML = `
      <div id="basemap-toggle" title="Map Style">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/>
          <path d="M9 3v15M15 6v15"/>
        </svg>
      </div>
      <div id="basemap-controls" style="display:none;">
        <div style="font-size:var(--text-xs); font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:var(--space-sm);">
          Map Style
        </div>
        <div id="basemap-buttons" style="display:flex; gap:4px; margin-bottom:var(--space-sm);"></div>
        <div id="basemap-detail-row" style="display:flex; align-items:center; justify-content:space-between; gap:var(--space-sm); margin-bottom:var(--space-sm);">
          <span style="font-size:10px; color:var(--text-muted);">Satellite roads + labels</span>
          <button id="basemap-detail-btn" class="basemap-detail-btn" type="button">Off</button>
        </div>
        <div id="basemap-hint" style="font-size:10px; color:var(--text-muted);">
          Best for finding homes and shops
        </div>
      </div>
    `;
        this.map.getContainer().parentElement.appendChild(panel);

        const toggleBtn = panel.querySelector('#basemap-toggle');
        const controls = panel.querySelector('#basemap-controls');
        const buttonRow = panel.querySelector('#basemap-buttons');
        const detailBtn = panel.querySelector('#basemap-detail-btn');

        toggleBtn.addEventListener('click', () => {
            const open = controls.style.display === 'none';
            controls.style.display = open ? 'block' : 'none';
            if (open) {
                Object.assign(controls.style, { padding: '0 12px 12px 12px' });
            }
        });

        BASEMAPS.forEach(config => {
            const btn = document.createElement('button');
            btn.className = 'basemap-btn';
            btn.dataset.id = config.id;
            btn.textContent = config.label;
            btn.title = config.hint;
            btn.addEventListener('click', () => this.setBaseMap(config.id));
            buttonRow.appendChild(btn);
        });

        detailBtn.addEventListener('click', () => this.toggleSatelliteDetail());

        this.baseMapPanel = panel;
        this.updateBaseMapButtonStyles();
        this.updateSatelliteDetailControl();
    }

    setBaseMap(baseMapId) {
        const entry = this.baseLayers.get(baseMapId);
        if (!entry || this.activeBaseMapId === baseMapId) return;

        if (this.activeBaseMapId) {
            const previous = this.baseLayers.get(this.activeBaseMapId);
            if (previous) {
                this.map.removeLayer(previous.layer);
            }
        }

        if (this.satelliteDetailEnabled && this.activeBaseMapId === 'esri-satellite' && baseMapId !== 'esri-satellite') {
            this.map.removeLayer(this.satelliteDetailLayer);
            this.satelliteDetailEnabled = false;
        }

        entry.layer.addTo(this.map);
        this.activeBaseMapId = baseMapId;
        this.updateMapTone(entry.config.tone);
        this.updateBaseMapButtonStyles();
        this.updateSatelliteDetailControl();

        const hint = this.baseMapPanel?.querySelector('#basemap-hint');
        if (hint) {
            hint.textContent = entry.config.hint;
        }
    }

    toggleSatelliteDetail(forceState = null) {
        if (this.activeBaseMapId !== 'esri-satellite') return;

        const shouldEnable = forceState ?? !this.satelliteDetailEnabled;
        if (shouldEnable === this.satelliteDetailEnabled) return;

        if (shouldEnable) {
            this.satelliteDetailLayer.addTo(this.map);
        } else {
            this.map.removeLayer(this.satelliteDetailLayer);
        }

        this.satelliteDetailEnabled = shouldEnable;
        this.updateSatelliteDetailControl();
    }

    updateSatelliteDetailControl() {
        const detailBtn = this.baseMapPanel?.querySelector('#basemap-detail-btn');
        if (!detailBtn) return;

        const canToggle = this.activeBaseMapId === 'esri-satellite';
        const isActive = canToggle && this.satelliteDetailEnabled;

        detailBtn.disabled = !canToggle;
        detailBtn.textContent = isActive ? 'On' : 'Off';
        detailBtn.title = canToggle
            ? 'Toggle roads and labels on top of satellite imagery'
            : 'Switch to Satellite to use this layer';

        Object.assign(detailBtn.style, {
            minWidth: '44px',
            padding: '4px 8px',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-sm)',
            background: isActive ? 'var(--accent)' : 'transparent',
            color: isActive ? 'var(--bg-base)' : 'var(--text-secondary)',
            fontSize: 'var(--text-xs)',
            fontWeight: '600',
            cursor: canToggle ? 'pointer' : 'not-allowed',
            opacity: canToggle ? '1' : '0.45',
            transition: 'all 0.2s',
            borderColor: isActive ? 'var(--accent)' : 'var(--glass-border)'
        });
    }

    updateMapTone(tone) {
        this.container.classList.toggle('map-tone-dim', tone === 'dim');
        this.container.classList.toggle('map-tone-clear', tone !== 'dim');
    }

    updateBaseMapButtonStyles() {
        if (!this.baseMapPanel) return;

        this.baseMapPanel.querySelectorAll('.basemap-btn').forEach(btn => {
            const active = btn.dataset.id === this.activeBaseMapId;
            Object.assign(btn.style, {
                flex: '1',
                padding: '6px 4px',
                border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? 'var(--bg-base)' : 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
                borderColor: active ? 'var(--accent)' : 'var(--glass-border)'
            });
        });
    }

    createMarkerIcon(category) {
        const colour = CATEGORY_COLOURS[category] || CATEGORY_COLOURS.residential;
        const icon = CATEGORY_ICONS[category] || '📍';

        return L.divIcon({
            className: '',
            html: `<div class="custom-marker" style="background:${colour}">
               <span class="custom-marker-inner">${icon}</span>
             </div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, -32]
        });
    }

    addMarker(place) {
        if (this.markers.has(place.id)) return;

        const marker = L.marker([place.lat, place.lng], {
            icon: this.createMarkerIcon(place.category)
        }).addTo(this.map);

        marker.placeData = place;

        marker.on('click', () => {
            if (this.onMarkerClick) this.onMarkerClick(place);
        });

        marker.on('mouseover', (e) => {
            if (this.onMarkerHover) {
                const point = this.map.latLngToContainerPoint(marker.getLatLng());
                this.onMarkerHover(place, point);
            }
        });

        marker.on('mouseout', () => {
            if (this.onMarkerLeave) this.onMarkerLeave(place);
        });

        this.markers.set(place.id, marker);
    }

    removeMarker(placeId) {
        const marker = this.markers.get(placeId);
        if (marker) {
            marker.remove();
            this.markers.delete(placeId);
        }
    }

    updateMarker(place) {
        this.removeMarker(place.id);
        this.addMarker(place);
    }

    clearMarkers() {
        this.markers.forEach(m => m.remove());
        this.markers.clear();
    }

    setMarkerVisible(placeId, visible) {
        const marker = this.markers.get(placeId);
        if (!marker) return;
        if (visible && !this.map.hasLayer(marker)) {
            marker.addTo(this.map);
        } else if (!visible && this.map.hasLayer(marker)) {
            marker.remove();
        }
    }

    setMarkerOpacity(placeId, opacity) {
        const marker = this.markers.get(placeId);
        if (marker) marker.setOpacity(opacity);
    }

    panTo(lat, lng, zoom) {
        this.map.flyTo([lat, lng], zoom || this.map.getZoom(), { duration: 0.5 });
    }

    fitBounds(places) {
        if (places.length === 0) return;
        const bounds = L.latLngBounds(places.map(p => [p.lat, p.lng]));
        this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
    }

    invalidateSize() {
        this.map.invalidateSize();
    }
}
