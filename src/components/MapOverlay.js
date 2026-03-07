import L from 'leaflet';

/**
 * Historic Map Overlay Manager
 *
 * Adds historic Ordnance Survey map layers from the National Library of Scotland
 * (NLS) tile servers. Supports opacity control and era switching.
 */

// Note: NLS has moved their free tile layers to MapTiler. 
// This requires a free MapTiler API key (https://www.maptiler.com/cloud/pricing/),
// which you can add to your .env file as VITE_MAPTILER_KEY.

const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY || '';

const HISTORIC_LAYERS = [
    {
        id: 'os-1890s',
        name: '1890s OS Map',
        label: '1890s',
        era: '1888–1913',
        url: `https://api.maptiler.com/tiles/uk-osgb10k1888/{z}/{x}/{y}.png?key=${mapTilerKey}`,
        attribution: '© <a href="https://maps.nls.uk">NLS</a>',
        minZoom: 12,
        maxZoom: 18,
        description: 'Ordnance Survey 6-inch, 1st edition'
    },
    {
        id: 'os-1930s',
        name: '1930s OS Map',
        label: '1930s',
        era: '1920–1947',
        url: `https://api.maptiler.com/tiles/uk-osgb25k1937/{z}/{x}/{y}.png?key=${mapTilerKey}`,
        attribution: '© <a href="https://maps.nls.uk">NLS</a>',
        minZoom: 10,
        maxZoom: 17,
        description: 'Ordnance Survey 1:25,000'
    },
    {
        id: 'os-1960s',
        name: '1960s OS Map',
        label: '1960s',
        era: '1955–1972',
        url: `https://api.maptiler.com/tiles/uk-osgb63k1955/{z}/{x}/{y}.png?key=${mapTilerKey}`,
        attribution: '© <a href="https://maps.nls.uk">NLS</a>',
        minZoom: 10,
        maxZoom: 18,
        description: 'Ordnance Survey 1-inch, 7th series'
    }
];

export default class MapOverlay {
    constructor(map, { onEraChange } = {}) {
        this.map = map;
        this.onEraChange = onEraChange;
        this.activeLayers = new Map();
        this.activeId = null;
        this.opacity = 0.65;
        this.splitMode = false;

        this.buildUI();
    }

    buildUI() {
        // Container panel
        const panel = document.createElement('div');
        panel.id = 'overlay-panel';
        panel.className = 'glass-panel';
        panel.innerHTML = `
      <div id="overlay-toggle" title="Historic Maps">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
        </svg>
      </div>
      <div id="overlay-controls" style="display:none;">
        <div style="font-size:var(--text-xs); font-weight:600; color:var(--accent); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:var(--space-sm);">
          Historic Maps
        </div>
        <div id="overlay-era-buttons" style="display:flex; gap:4px; margin-bottom:var(--space-sm);"></div>
        <div id="overlay-opacity-row" style="display:none;">
          <div style="display:flex; align-items:center; gap:var(--space-sm);">
            <span style="font-size:var(--text-xs); color:var(--text-muted); flex-shrink:0;">Opacity</span>
            <input type="range" id="overlay-opacity" min="0" max="100" value="65"
              style="flex:1; accent-color:var(--accent); height:4px;" />
            <span id="overlay-opacity-label" style="font-size:var(--text-xs); color:var(--text-muted); width:32px; text-align:right;">65%</span>
          </div>
          <button id="overlay-off-btn" style="
            margin-top:var(--space-xs); width:100%; padding:4px; border:none; border-radius:var(--radius-sm);
            background:rgba(248,113,113,0.15); color:#f87171; font-size:var(--text-xs); cursor:pointer;
          ">Hide overlay</button>
        </div>
        <div id="overlay-hint" style="font-size:10px; color:var(--text-muted); margin-top:var(--space-xs);">
          Zoom in for higher detail
        </div>
      </div>
    `;
        this.map.getContainer().parentElement.appendChild(panel);

        // Style the panel
        Object.assign(panel.style, {
            position: 'absolute',
            top: '16px',
            right: '16px',
            zIndex: '1000',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            transition: 'all 0.3s ease'
        });

        // Toggle button
        const toggleBtn = panel.querySelector('#overlay-toggle');
        Object.assign(toggleBtn.style, {
            padding: '10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            transition: 'color 0.2s'
        });

        const controls = panel.querySelector('#overlay-controls');
        const eraRow = panel.querySelector('#overlay-era-buttons');
        const opacityRow = panel.querySelector('#overlay-opacity-row');

        toggleBtn.addEventListener('click', () => {
            const open = controls.style.display === 'none';
            controls.style.display = open ? 'block' : 'none';
            if (open) {
                Object.assign(controls.style, { padding: '0 12px 12px 12px' });
            }
        });

        // Era buttons
        HISTORIC_LAYERS.forEach(layer => {
            const btn = document.createElement('button');
            btn.className = 'overlay-era-btn';
            btn.dataset.id = layer.id;
            btn.textContent = layer.label;
            btn.title = `${layer.name} (${layer.era})`;
            Object.assign(btn.style, {
                flex: '1',
                padding: '6px 4px',
                border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
            });
            btn.addEventListener('click', () => this.toggleEra(layer.id));
            eraRow.appendChild(btn);
        });

        // Opacity slider
        const opacitySlider = panel.querySelector('#overlay-opacity');
        const opacityLabel = panel.querySelector('#overlay-opacity-label');
        opacitySlider.addEventListener('input', (e) => {
            this.opacity = parseInt(e.target.value) / 100;
            opacityLabel.textContent = `${e.target.value}%`;
            this.updateOpacity();
        });

        // Off button
        panel.querySelector('#overlay-off-btn').addEventListener('click', () => {
            this.hideAll();
        });

        this.panel = panel;
        this.opacityRow = opacityRow;
    }

    toggleEra(layerId) {
        if (this.activeId === layerId) {
            this.hideAll();
            return;
        }

        // Remove previous
        this.hideAll(false);

        // Add new
        const config = HISTORIC_LAYERS.find(l => l.id === layerId);
        if (!config) return;

        // If no API key is provided, show a helpful message and abort
        if (!mapTilerKey) {
            const hint = this.panel.querySelector('#overlay-hint');
            hint.innerHTML = '<span style="color:var(--status-danger);">⚠️ Missing MapTiler API Key in .env</span><br/>NLS maps now require a free <a href="https://www.maptiler.com/cloud/pricing/" target="_blank" style="color:var(--accent);">MapTiler account</a>.';
            this.updateButtonStyles();
            return;
        }

        const tileLayer = L.tileLayer(config.url, {
            attribution: config.attribution,
            maxZoom: config.maxZoom,
            minZoom: config.minZoom,
            opacity: this.opacity,
            errorTileUrl: '' // Don't show broken tiles
        });

        tileLayer.addTo(this.map);
        this.activeLayers.set(layerId, tileLayer);
        this.activeId = layerId;

        // Update UI
        this.updateButtonStyles();
        this.opacityRow.style.display = 'block';

        // Update hint with era info
        const hint = this.panel.querySelector('#overlay-hint');
        hint.textContent = `${config.name} · ${config.era}`;

        // Notify
        this.onEraChange?.(config);
    }

    hideAll(updateUI = true) {
        for (const [id, layer] of this.activeLayers) {
            this.map.removeLayer(layer);
        }
        this.activeLayers.clear();
        this.activeId = null;

        if (updateUI) {
            this.updateButtonStyles();
            this.opacityRow.style.display = 'none';
            const hint = this.panel.querySelector('#overlay-hint');
            hint.textContent = 'Zoom in for higher detail';
            this.onEraChange?.(null);
        }
    }

    updateOpacity() {
        for (const [id, layer] of this.activeLayers) {
            layer.setOpacity(this.opacity);
        }
    }

    updateButtonStyles() {
        this.panel.querySelectorAll('.overlay-era-btn').forEach(btn => {
            const active = btn.dataset.id === this.activeId;
            Object.assign(btn.style, {
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? 'var(--bg-base)' : 'var(--text-secondary)',
                borderColor: active ? 'var(--accent)' : 'var(--glass-border)'
            });
        });
    }

    /**
     * Set the overlay era to match a year (for time slider integration).
     * Returns the era that best matches, or null to hide.
     */
    setYearAuto(year) {
        // Pick the best era for this year
        if (year <= 1913) {
            this.toggleEra('os-1890s');
        } else if (year <= 1947) {
            this.toggleEra('os-1930s');
        } else if (year <= 1972) {
            this.toggleEra('os-1960s');
        } else {
            this.hideAll();
        }
    }

    getActiveEra() {
        return this.activeId ? HISTORIC_LAYERS.find(l => l.id === this.activeId) : null;
    }

    destroy() {
        this.hideAll();
        this.panel?.remove();
    }
}

export { HISTORIC_LAYERS };
