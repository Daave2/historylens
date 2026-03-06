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

export default class MapView {
    constructor(containerId, { centre, zoom, onMapClick, onMarkerClick, onMarkerHover, onMarkerLeave }) {
        this.container = document.getElementById(containerId);
        this.onMapClick = onMapClick;
        this.onMarkerClick = onMarkerClick;
        this.onMarkerHover = onMarkerHover;
        this.onMarkerLeave = onMarkerLeave;
        this.markers = new Map(); // placeId -> L.Marker
        this.addMode = false;

        // Initialise Leaflet
        this.map = L.map(this.container, {
            center: [centre.lat, centre.lng],
            zoom: zoom || 15,
            zoomControl: false,
            attributionControl: false
        });

        // CARTO Voyager — clean, readable map tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(this.map);

        // Attribution in bottom-right
        L.control.attribution({ position: 'bottomright', prefix: false })
            .addAttribution('© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>')
            .addTo(this.map);

        // Map click handler — always available for adding places
        this.map.on('click', (e) => {
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
