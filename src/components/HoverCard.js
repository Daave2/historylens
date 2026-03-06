import { getBestEntryForYear, getBestImageForYear, getTimeEntriesForPlace } from '../data/store.js';

export default class HoverCard {
    constructor() {
        this.el = document.getElementById('hover-card');
        this.imageEl = document.getElementById('hover-card-image');
        this.titleEl = document.getElementById('hover-card-title');
        this.periodEl = document.getElementById('hover-card-period');
        this.summaryEl = document.getElementById('hover-card-summary');
        this.currentPlaceId = null;
        this.hideTimeout = null;
    }

    async show(place, point, year) {
        clearTimeout(this.hideTimeout);
        this.currentPlaceId = place.id;

        // Position the card near the marker
        const cardWidth = 260;
        const cardHeight = 280;
        const viewportWidth = window.innerWidth;

        let left = point.x + 20;
        let top = point.y - cardHeight / 2;

        // Keep within viewport
        if (left + cardWidth > viewportWidth - 20) {
            left = point.x - cardWidth - 20;
        }
        if (top < 10) top = 10;
        if (top + cardHeight > window.innerHeight - 100) {
            top = window.innerHeight - 100 - cardHeight;
        }

        this.el.style.left = left + 'px';
        this.el.style.top = top + 'px';

        // Get time-appropriate data
        const result = await getBestEntryForYear(place.id, year);
        const image = await getBestImageForYear(place.id, year);

        // If we navigated away while loading, don't show
        if (this.currentPlaceId !== place.id) return;

        this.titleEl.textContent = place.name;

        // Image
        let imgHtml = '';
        if (image && image.publicUrl) {
            imgHtml = `<img src="${image.publicUrl}" class="hover-card-img" />`;
            this.imageEl.classList.remove('no-image');
        } else {
            this.imageEl.classList.add('no-image');
        }
        this.imageEl.innerHTML = imgHtml;


        // Period and summary
        if (result.type === 'exact') {
            const e = result.entry;
            this.periodEl.textContent = e.yearEnd
                ? `${e.yearStart}–${e.yearEnd}`
                : `From ${e.yearStart}`;
            this.summaryEl.textContent = e.summary || e.title || 'No details yet.';
        } else if (result.type === 'last_known') {
            const e = result.entry;
            this.periodEl.textContent = `Last known: ${e.yearStart}`;
            this.summaryEl.textContent = `${e.title || e.summary || 'Previous record'}. No information found for ${year}.`;
        } else if (result.type === 'before_known') {
            const e = result.entry;
            this.periodEl.textContent = `Before ${e.yearStart}`;
            this.summaryEl.textContent = `This area was likely undeveloped before ${e.yearStart}. Earliest record: ${e.title || 'unknown'}.`;
        } else {
            // No entries at all
            const entries = await getTimeEntriesForPlace(place.id);
            if (entries.length === 0) {
                this.periodEl.textContent = 'No records';
                this.summaryEl.textContent = 'No historical information yet. Click to add research.';
            }
        }

        this.el.style.display = 'block';
        // Force reflow then add visible class for animation
        this.el.offsetHeight;
        this.el.classList.add('visible');
    }

    hide() {
        this.hideTimeout = setTimeout(() => {
            this.el.classList.remove('visible');
            setTimeout(() => {
                if (!this.el.classList.contains('visible')) {
                    this.el.style.display = 'none';
                }
            }, 300);
            this.currentPlaceId = null;
        }, 100);
    }
}
