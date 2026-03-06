import { getProjectYearRange } from '../data/store.js';

export default class TimeSlider {
    constructor({ onYearChange }) {
        this.slider = document.getElementById('time-slider');
        this.yearDisplay = document.getElementById('time-current-year');
        this.yearLabel = document.getElementById('time-current-label');
        this.labelsEl = document.getElementById('time-labels');
        this.ticksEl = document.getElementById('time-ticks');
        this.playBtn = document.getElementById('time-play');
        this.onYearChange = onYearChange;

        this.playing = false;
        this.playInterval = null;
        this.currentYear = parseInt(this.slider.value);

        // Events
        this.slider.addEventListener('input', () => {
            this.currentYear = parseInt(this.slider.value);
            this.updateDisplay();
            this.onYearChange?.(this.currentYear);
        });

        this.playBtn.addEventListener('click', () => this.togglePlay());
    }

    async setRange(projectId) {
        const range = await getProjectYearRange(projectId);
        this.slider.min = range.min;
        this.slider.max = range.max;

        // Don't change value if it's within range
        if (this.currentYear < range.min || this.currentYear > range.max) {
            this.currentYear = range.max;
            this.slider.value = this.currentYear;
        }

        this.renderLabels(range.min, range.max);
        this.renderTicks(range.min, range.max);
        this.updateDisplay();
    }

    renderLabels(min, max) {
        const step = Math.ceil((max - min) / 6);
        const labels = [];
        for (let y = min; y <= max; y += step) {
            labels.push(y);
        }
        if (labels[labels.length - 1] !== max) labels.push(max);

        this.labelsEl.innerHTML = labels
            .map(y => `<span>${y}</span>`)
            .join('');
    }

    renderTicks(min, max) {
        const range = max - min;
        const tickInterval = range > 100 ? 10 : range > 50 ? 5 : 1;
        const majorInterval = range > 100 ? 50 : range > 50 ? 25 : 10;

        let html = '';
        for (let y = min; y <= max; y += tickInterval) {
            const isMajor = (y % majorInterval === 0);
            html += `<div class="time-tick ${isMajor ? 'major' : ''}"></div>`;
        }
        this.ticksEl.innerHTML = html;
    }

    updateDisplay() {
        this.yearDisplay.textContent = this.currentYear;
        const thisYear = new Date().getFullYear();
        if (this.currentYear >= thisYear - 1) {
            this.yearLabel.textContent = 'Present Day';
        } else if (this.currentYear >= 2000) {
            this.yearLabel.textContent = `${thisYear - this.currentYear} years ago`;
        } else {
            const decade = Math.floor(this.currentYear / 10) * 10;
            this.yearLabel.textContent = `The ${decade}s`;
        }
    }

    togglePlay() {
        if (this.playing) {
            this.stopPlay();
        } else {
            this.startPlay();
        }
    }

    startPlay() {
        this.playing = true;
        this.playBtn.classList.add('playing');

        const min = parseInt(this.slider.min);
        const max = parseInt(this.slider.max);
        if (this.currentYear >= max) {
            this.currentYear = min;
        }

        this.playInterval = setInterval(() => {
            this.currentYear++;
            if (this.currentYear > max) {
                this.stopPlay();
                return;
            }
            this.slider.value = this.currentYear;
            this.updateDisplay();
            this.onYearChange?.(this.currentYear);
        }, 150);
    }

    stopPlay() {
        this.playing = false;
        this.playBtn.classList.remove('playing');
        clearInterval(this.playInterval);
    }

    getYear() {
        return this.currentYear;
    }
}
