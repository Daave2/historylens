import { getPlacesByProject, getTimeEntriesForPlace, getImagesForEntry } from '../data/store.js';

export default class Sidebar {
    constructor({ onPlaceClick, onAddPlace, onImport, onExport, onProjectEdit, onManageCollaborators, onRequestAccess, onSetCentre, onFilterChange }) {
        this.el = document.getElementById('sidebar');
        this.listEl = document.getElementById('place-list');
        this.countEl = document.getElementById('place-count');
        this.searchInput = document.getElementById('place-search');
        this.categoryFilter = document.getElementById('category-filter');
        this.toggleBtn = document.getElementById('sidebar-toggle');
        this.projectNameEl = document.getElementById('project-name');
        this.projectDescEl = document.getElementById('project-desc');
        this.visibilityCheck = document.getElementById('project-visibility');
        this.addBtn = document.getElementById('btn-add-place');
        this.importBtn = document.getElementById('btn-import');
        this.exportBtn = document.getElementById('btn-export');
        this.collabManageBtn = document.getElementById('btn-collab-manage');
        this.collabRequestBtn = document.getElementById('btn-collab-request');
        this.setCentreBtn = document.getElementById('btn-set-centre');

        this.onPlaceClick = onPlaceClick;
        this.onProjectEdit = onProjectEdit;
        this.onFilterChange = onFilterChange;
        this.places = [];
        this.activeId = null;

        // Events
        this.toggleBtn.addEventListener('click', () => this.toggle());
        this.addBtn.addEventListener('click', () => onAddPlace?.());
        this.importBtn.addEventListener('click', () => onImport?.());
        this.exportBtn.addEventListener('click', () => onExport?.());
        if (this.collabManageBtn) this.collabManageBtn.addEventListener('click', () => onManageCollaborators?.());
        if (this.collabRequestBtn) this.collabRequestBtn.addEventListener('click', () => onRequestAccess?.());
        if (this.setCentreBtn) this.setCentreBtn.addEventListener('click', () => onSetCentre?.());
        this.searchInput.addEventListener('input', () => this.filterPlaces());
        if (this.categoryFilter) this.categoryFilter.addEventListener('change', () => this.filterPlaces());

        // Editable project name
        this.projectNameEl.addEventListener('click', () => {
            if (!this.isReadOnly) this.editProjectName();
        });
        this.projectDescEl.addEventListener('click', () => {
            if (!this.isReadOnly) this.editProjectDesc();
        });

        // Visibility toggle
        if (this.visibilityCheck) {
            this.visibilityCheck.addEventListener('change', (e) => {
                this.onProjectEdit?.({ isPublic: e.target.checked });
            });
        }
    }

    setProject(project, isReadOnly = false, currentUserRole = null) {
        this.isReadOnly = isReadOnly;
        this.projectNameEl.textContent = project.name;
        this.projectDescEl.textContent = project.description || 'Click to add a description…';
        if (this.visibilityCheck) {
            this.visibilityCheck.checked = project.isPublic !== false;
        }

        if (this.isReadOnly) {
            this.projectNameEl.classList.remove('editable-title');
            this.projectDescEl.classList.remove('editable-desc');
            if (this.addBtn) this.addBtn.style.display = 'none';
            if (this.importBtn) this.importBtn.parentElement.style.display = 'none'; // btn-group
            if (this.visibilityCheck) this.visibilityCheck.parentElement.style.display = 'none';
        } else {
            this.projectNameEl.classList.add('editable-title');
            this.projectDescEl.classList.add('editable-desc');
            if (this.addBtn) this.addBtn.style.display = '';
            if (this.importBtn) this.importBtn.parentElement.style.display = 'flex';
            if (this.visibilityCheck) this.visibilityCheck.parentElement.style.display = 'flex';
        }

        // Collaboration Buttons
        if (this.collabManageBtn && this.collabRequestBtn) {
            if (currentUserRole === 'owner' || currentUserRole === 'admin') {
                this.collabManageBtn.style.display = 'flex';
                this.collabRequestBtn.style.display = 'none';
                if (this.setCentreBtn) this.setCentreBtn.style.display = 'flex';
            } else if (currentUserRole === null) {
                this.collabManageBtn.style.display = 'none';
                this.collabRequestBtn.style.display = 'flex';
                if (this.setCentreBtn) this.setCentreBtn.style.display = 'none';
            } else {
                this.collabManageBtn.style.display = 'none';
                if (this.setCentreBtn) this.setCentreBtn.style.display = 'none';
                this.collabRequestBtn.style.display = 'none';
            }
        }
    }

    async loadPlaces(projectId) {
        this.places = await getPlacesByProject(projectId);
        this.countEl.textContent = this.places.length;
        this.renderPlaces(this.places);
    }

    filterPlaces() {
        const query = this.searchInput.value.toLowerCase().trim();
        const cat = this.categoryFilter ? this.categoryFilter.value : '';

        const filtered = this.places.filter(p => {
            const pName = p.name || '';
            const pCatOriginal = p.category || '';
            const matchesQuery = !query || pName.toLowerCase().includes(query) || pCatOriginal.toLowerCase().includes(query);

            // Allow matching "other" categories by checking if it's not one of our standard ones
            let pCat = pCatOriginal.toLowerCase();
            const standardCats = ['residential', 'commercial', 'landmark', 'natural', 'infrastructure'];
            if (cat === 'other') {
                pCat = standardCats.includes(pCat) ? 'standard' : 'other';
            }

            const matchesCat = !cat || pCat === cat;
            return matchesQuery && matchesCat;
        });

        this.renderPlaces(filtered);
        this.onFilterChange?.(filtered.map(p => p.id));
    }

    async renderPlaces(places) {
        if (places.length === 0) {
            this.listEl.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <h4>No places yet</h4>
          <p>Click "Add Place" then click on the map to mark a point of interest.</p>
        </div>
      `;
            return;
        }

        this.listEl.innerHTML = '';
        for (const place of places) {
            const item = document.createElement('div');
            item.className = 'place-item' + (place.id === this.activeId ? ' active' : '');
            item.dataset.placeId = place.id;

            // Get first image for thumbnail
            const entries = await getTimeEntriesForPlace(place.id);
            let thumbHtml = '';
            if (entries.length > 0) {
                const images = await getImagesForEntry(entries[0].id);
                if (images.length > 0 && images[0].publicUrl) {
                    thumbHtml = `<img src="${images[0].publicUrl}" class="sidebar-place-img" />`;
                }
            }

            const catColour = {
                residential: '#a78bfa', commercial: '#f59e0b', landmark: '#f472b6',
                natural: '#34d399', infrastructure: '#60a5fa'
            }[place.category] || '#a78bfa';

            const catIcon = {
                residential: '🏠', commercial: '🏪', landmark: '⭐',
                natural: '🌳', infrastructure: '🏗️'
            }[place.category] || '📍';

            const meta = entries.length > 0
                ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} · ${entries[0].yearStart}–${entries[entries.length - 1].yearEnd || 'present'}`
                : 'No entries yet';

            item.innerHTML = `
        <div class="place-item-icon" style="background:${catColour}22; color:${catColour}">${catIcon}</div>
        <div class="place-item-info">
          <div class="place-item-name">${place.name}</div>
          <div class="place-item-meta">${meta}</div>
        </div>
        ${thumbHtml}
      `;

            item.addEventListener('click', () => {
                this.setActive(place.id);
                this.onPlaceClick?.(place);
            });

            this.listEl.appendChild(item);
        }
    }

    setActive(placeId) {
        this.activeId = placeId;
        this.listEl.querySelectorAll('.place-item').forEach(el => {
            el.classList.toggle('active', el.dataset.placeId === placeId);
        });
    }

    toggle() {
        this.el.classList.toggle('collapsed');
    }

    editProjectName() {
        const current = this.projectNameEl.textContent;
        const input = document.createElement('input');
        input.className = 'form-input';
        input.value = current;
        input.style.fontFamily = 'var(--font-heading)';
        input.style.fontSize = 'var(--text-lg)';
        input.style.fontWeight = '600';

        this.projectNameEl.replaceWith(input);
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim() || current;
            const el = document.createElement('h2');
            el.id = 'project-name';
            el.className = 'editable-title';
            el.textContent = newName;
            el.addEventListener('click', () => this.editProjectName());
            input.replaceWith(el);
            this.projectNameEl = el;
            if (newName !== current) this.onProjectEdit?.({ name: newName });
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
                input.value = current;
                commit();
            }
        });
    }

    editProjectDesc() {
        const current = this.projectDescEl.textContent;
        const isPlaceholder = current === 'Click to add a description…';
        const input = document.createElement('input');
        input.className = 'form-input';
        input.value = isPlaceholder ? '' : current;
        input.placeholder = 'Add a project description…';
        input.style.fontSize = 'var(--text-sm)';

        this.projectDescEl.replaceWith(input);
        input.focus();

        const commit = () => {
            const newDesc = input.value.trim();
            const el = document.createElement('p');
            el.id = 'project-desc';
            el.className = 'editable-desc';
            el.textContent = newDesc || 'Click to add a description…';
            el.addEventListener('click', () => this.editProjectDesc());
            input.replaceWith(el);
            this.projectDescEl = el;
            if (newDesc !== current && !isPlaceholder) this.onProjectEdit?.({ description: newDesc });
            else if (newDesc && isPlaceholder) this.onProjectEdit?.({ description: newDesc });
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
                input.value = isPlaceholder ? '' : current;
                commit();
            }
        });
    }
}
