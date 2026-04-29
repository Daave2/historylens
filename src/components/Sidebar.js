import { getPlacesByProject, getTimeEntriesForPlaces, getPrimaryPlaceImages, getMySubmissionSummary, getMyModerationSubmissions, getProfiles, getProjectInboxCounts, getProjectMapSnapshot } from '../data/store.js';
import { escapeHtml, escapeAttr } from '../utils/sanitize.js';
import { formatModerationStatusLabel, formatModerationSubmissionSummary, formatModerationSubmissionType } from '../utils/moderation.js';

export default class Sidebar {
    constructor({ onPlaceClick, onAddPlace, onImport, onExport, onGuide, onProjectChat, onProjectEdit, onProjectSettings, onRequestAccess, onFilterChange, onQueryChange, onLoadMore }) {
        this.el = document.getElementById('sidebar');
        this.listEl = document.getElementById('place-list');
        this.countEl = document.getElementById('place-count');
        this.searchInput = document.getElementById('place-search');
        this.categoryFilter = document.getElementById('category-filter');
        this.toggleBtn = document.getElementById('sidebar-toggle');
        this.projectNameEl = document.getElementById('project-name');
        this.projectDescEl = document.getElementById('project-desc');
        this.guideCardEl = document.getElementById('sidebar-guide-card');
        this.addBtn = document.getElementById('btn-add-place');
        this.guideBtn = document.getElementById('btn-guide');
        this.chatBtn = document.getElementById('btn-project-chat');
        this.importBtn = document.getElementById('btn-import');
        this.exportBtn = document.getElementById('btn-export');
        this.settingsBtn = document.getElementById('btn-project-settings');
        this.settingsInboxBadge = document.getElementById('settings-inbox-badge');
        this.collabRequestBtn = document.getElementById('btn-collab-request');
        this.collabStatusEl = document.getElementById('collab-status');
        this.collabActivityEl = document.getElementById('collab-activity');
        this.currentProjectId = null;
        this.currentUserRole = null;
        this.isSignedIn = false;
        this.inboxRequestToken = 0;
        this.pendingStatusToken = 0;

        this.onPlaceClick = onPlaceClick;
        this.onAddPlace = onAddPlace;
        this.onGuide = onGuide;
        this.onProjectChat = onProjectChat;
        this.onProjectEdit = onProjectEdit;
        this.onRequestAccess = onRequestAccess;
        this.onFilterChange = onFilterChange;
        this.onQueryChange = onQueryChange;
        this.onLoadMore = onLoadMore;
        this.places = [];
        this.entriesByPlaceId = {};
        this.placeSummariesById = {};
        this.markerStatesByPlaceId = {};
        this.primaryImagesByPlaceId = {};
        this.hasLoadedPlaces = false;
        this.usesBoundedSnapshots = false;
        this.snapshotHasMore = false;
        this.snapshotNextCursor = null;
        this.snapshotProjectHasPlaces = null;
        this.loadRequestToken = 0;
        this.activeId = null;
        this.renderGeneration = 0;

        // Events
        this.toggleBtn.addEventListener('click', () => this.toggle());
        this.addBtn.addEventListener('click', () => onAddPlace?.());
        if (this.guideBtn) this.guideBtn.addEventListener('click', () => onGuide?.());
        if (this.chatBtn) this.chatBtn.addEventListener('click', () => onProjectChat?.());
        this.importBtn.addEventListener('click', () => onImport?.());
        this.exportBtn.addEventListener('click', () => onExport?.());
        if (this.settingsBtn) this.settingsBtn.addEventListener('click', () => {
            onProjectSettings?.();
            this.refreshInboxBadge();
        });
        if (this.collabRequestBtn) this.collabRequestBtn.addEventListener('click', () => onRequestAccess?.());
        this.searchInput.addEventListener('input', () => this.handleQueryInput());
        if (this.categoryFilter) this.categoryFilter.addEventListener('change', () => this.handleQueryInput());

        // Editable project name
        this.projectNameEl.addEventListener('click', () => {
            if (!this.isReadOnly) this.editProjectName();
        });
        this.projectDescEl.addEventListener('click', () => {
            if (!this.isReadOnly) this.editProjectDesc();
        });
    }

    setProject(project, permissionsOrReadOnly = false, currentUserRole = null) {
        const isSameProject = this.currentProjectId === project.id;
        const permissions = typeof permissionsOrReadOnly === 'object'
            ? permissionsOrReadOnly
            : {
                isReadOnly: !!permissionsOrReadOnly,
                canSubmit: !permissionsOrReadOnly,
                canEditPublished: !permissionsOrReadOnly
            };

        this.isReadOnly = !!permissions.isReadOnly;
        this.canSubmit = !!permissions.canSubmit;
        this.canEditPublished = !!permissions.canEditPublished;
        this.isSignedIn = !!permissions.isSignedIn;
        this.currentProjectId = project.id;
        this.currentUserRole = currentUserRole;
        if (!isSameProject) {
            this.hasLoadedPlaces = false;
            this.primaryImagesByPlaceId = {};
        }
        this.projectNameEl.textContent = project.name;
        this.projectDescEl.textContent = project.description || this.getProjectDescriptionPlaceholder();

        if (this.canEditPublished) {
            this.projectNameEl.classList.add('editable-title');
            this.projectDescEl.classList.add('editable-desc');
        } else {
            this.projectNameEl.classList.remove('editable-title');
            this.projectDescEl.classList.remove('editable-desc');
        }

        if (this.addBtn) {
            if (this.canEditPublished) {
                this.addBtn.style.display = '';
                this.addBtn.innerHTML = `
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add Place
                `;
            } else if (this.canSubmit && currentUserRole === 'pending') {
                this.addBtn.style.display = '';
                this.addBtn.innerHTML = `
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Suggest Place
                `;
            } else {
                this.addBtn.style.display = 'none';
            }
        }

        if (this.importBtn) {
            this.importBtn.parentElement.style.display = this.canEditPublished ? 'flex' : 'none';
        }

        if (this.chatBtn) {
            this.chatBtn.style.display = 'flex';
            const chatState = this.canSubmit && currentUserRole !== 'banned' ? 'active' : 'read';
            this.chatBtn.dataset.state = chatState;
            this.chatBtn.title = chatState === 'active'
                ? 'Open live project chat'
                : 'Open project chat';
        }

        // Collaboration Buttons
        if (this.settingsBtn && this.collabRequestBtn) {
            if (currentUserRole === 'owner' || currentUserRole === 'admin') {
                this.settingsBtn.style.display = 'flex';
                this.collabRequestBtn.style.display = 'none';
            } else if (currentUserRole === null) {
                this.settingsBtn.style.display = 'none';
                this.collabRequestBtn.style.display = 'flex';
                this.collabRequestBtn.textContent = this.isSignedIn ? 'Request Access' : 'Sign In to Request Access';
            } else {
                this.settingsBtn.style.display = 'none';
                this.collabRequestBtn.style.display = 'none';
            }
        }

        if (this.collabStatusEl) {
            if (currentUserRole === 'pending') {
                this.setCollabStatus('Your access request is in review. You can already suggest places, historic names, timeline entries, and join Talk while you wait.', 'pending');
                this.setCollabActivity();
                this.renderPendingSubmissionSummary(project.id);
            } else if (currentUserRole === 'banned') {
                this.setCollabStatus('This account currently has read-only access on this map.', 'banned');
                this.setCollabActivity();
            } else if (currentUserRole === null && this.isSignedIn) {
                this.setCollabStatus('You are viewing this map in read-only mode. Request access to suggest changes or post on Talk.', 'viewer');
                this.setCollabActivity();
            } else if (currentUserRole === null) {
                this.setCollabStatus('Browsing as a guest. Sign in to request access, suggest changes, or post on Talk.', 'guest');
                this.setCollabActivity();
            } else {
                this.setCollabStatus();
                this.setCollabActivity();
            }
        }

        this.refreshInboxBadge();
        this.renderGuideCard();
    }

    setCollabStatus(message = '', state = '') {
        if (!this.collabStatusEl) return;
        this.collabStatusEl.style.display = message ? 'block' : 'none';
        this.collabStatusEl.textContent = message;
        if (state) {
            this.collabStatusEl.dataset.state = state;
        } else {
            delete this.collabStatusEl.dataset.state;
        }
    }

    setCollabActivity(content = '', state = '') {
        if (!this.collabActivityEl) return;
        this.collabActivityEl.innerHTML = content;
        this.collabActivityEl.style.display = content ? 'grid' : 'none';
        if (state) {
            this.collabActivityEl.dataset.state = state;
        } else {
            delete this.collabActivityEl.dataset.state;
        }
    }

    async renderPendingSubmissionSummary(projectId) {
        const token = ++this.pendingStatusToken;
        try {
            const [summary, submissions] = await Promise.all([
                getMySubmissionSummary(projectId),
                getMyModerationSubmissions(projectId, { limit: 12 })
            ]);
            if (!this.collabStatusEl || token !== this.pendingStatusToken || this.currentProjectId !== projectId || this.currentUserRole !== 'pending') return;

            const summaryParts = [];
            if (summary.pending > 0) summaryParts.push(`${summary.pending} pending`);
            if (summary.approved > 0) summaryParts.push(`${summary.approved} approved`);
            if (summary.rejected > 0) summaryParts.push(`${summary.rejected} declined`);

            const baseMessage = 'Your access request is in review. You can already suggest places, historic names, timeline entries, and join Talk while you wait.';
            this.collabStatusEl.textContent = summaryParts.length > 0
                ? `${baseMessage} Suggestions so far: ${summaryParts.join(', ')}.`
                : baseMessage;

            if (!submissions.length) {
                this.setCollabActivity();
                return;
            }

            const reviewerIds = [...new Set(submissions.map((submission) => submission.reviewedBy).filter(Boolean))];
            const reviewerMap = reviewerIds.length > 0 ? await getProfiles(reviewerIds) : {};
            if (token !== this.pendingStatusToken || this.currentProjectId !== projectId || this.currentUserRole !== 'pending') return;

            this.renderContributorActivity(submissions, reviewerMap);
        } catch (err) {
            console.warn('Could not load moderation summary:', err);
            if (token === this.pendingStatusToken) {
                this.setCollabActivity();
            }
        }
    }

    renderContributorActivity(submissions, reviewerMap = {}) {
        if (!this.collabActivityEl) return;

        const pending = submissions
            .filter((submission) => submission.status === 'pending')
            .slice(0, 3);
        const reviewed = submissions
            .filter((submission) => submission.status !== 'pending')
            .sort((a, b) => {
                const aTime = a.reviewedAt?.getTime?.() || a.createdAt?.getTime?.() || 0;
                const bTime = b.reviewedAt?.getTime?.() || b.createdAt?.getTime?.() || 0;
                return bTime - aTime;
            })
            .slice(0, 4);

        if (pending.length === 0 && reviewed.length === 0) {
            this.setCollabActivity();
            return;
        }

        const formatPerson = (userId) => {
            const profile = reviewerMap[userId];
            if (!profile) return 'a reviewer';
            return profile.display_name || (profile.email ? profile.email.split('@')[0] : 'a reviewer');
        };

        const formatDate = (value) => {
            if (!(value instanceof Date) || Number.isNaN(value.getTime())) return 'recently';
            return value.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        };

        const renderSubmissionCard = (submission) => {
            const statusLabel = formatModerationStatusLabel(submission.status);
            const meta = submission.status === 'pending'
                ? `Sent ${formatDate(submission.createdAt)}`
                : `${statusLabel} ${formatDate(submission.reviewedAt || submission.createdAt)}${submission.reviewedBy ? ` by ${formatPerson(submission.reviewedBy)}` : ''}`;
            const reviewerNote = submission.reviewerNote
                ? `
                  <div class="collab-activity-note">
                    <span>Reviewer note</span>
                    <p>${escapeHtml(submission.reviewerNote)}</p>
                  </div>
                `
                : '';

            return `
              <article class="collab-activity-item" data-status="${escapeAttr(submission.status)}">
                <div class="collab-activity-item-row">
                  <div class="collab-activity-type">${escapeHtml(formatModerationSubmissionType(submission.submissionType))}</div>
                  <span class="collab-activity-badge" data-status="${escapeAttr(submission.status)}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="collab-activity-summary">${escapeHtml(formatModerationSubmissionSummary(submission))}</div>
                <div class="collab-activity-meta">${escapeHtml(meta)}</div>
                ${reviewerNote}
              </article>
            `;
        };

        const sections = [];
        if (reviewed.length > 0) {
            sections.push(`
              <section class="collab-activity-section">
                <div class="collab-activity-section-title">Recent decisions</div>
                <div class="collab-activity-list">
                  ${reviewed.map((submission) => renderSubmissionCard(submission)).join('')}
                </div>
              </section>
            `);
        }
        if (pending.length > 0) {
            sections.push(`
              <section class="collab-activity-section">
                <div class="collab-activity-section-title">Still in review</div>
                <div class="collab-activity-list">
                  ${pending.map((submission) => renderSubmissionCard(submission)).join('')}
                </div>
              </section>
            `);
        }

        this.setCollabActivity(`
          <div class="collab-activity-header">
            <div class="collab-activity-kicker">Contributor Activity</div>
            <h4>Your suggestions</h4>
            <p>Recent decisions and reviewer notes show up here while access is still pending.</p>
          </div>
          ${sections.join('')}
        `, 'pending');
    }

    async refreshInboxBadge() {
        const canModerate = this.currentUserRole === 'owner' || this.currentUserRole === 'admin';
        if (!canModerate || !this.currentProjectId) {
            this.updateInboxBadge(0);
            return;
        }

        const token = ++this.inboxRequestToken;
        try {
            const counts = await getProjectInboxCounts(this.currentProjectId);
            if (token !== this.inboxRequestToken) return;
            this.updateInboxBadge(counts.total, counts);
        } catch (err) {
            console.warn('Could not load inbox counters:', err);
            if (token === this.inboxRequestToken) {
                this.updateInboxBadge(0);
            }
        }
    }

    updateInboxBadge(total, counts = {}) {
        if (!this.settingsBtn || !this.settingsInboxBadge) return;

        const safeTotal = Number.isFinite(total) ? total : 0;
        if (safeTotal <= 0) {
            this.settingsInboxBadge.style.display = 'none';
            this.settingsInboxBadge.textContent = '0';
            this.settingsBtn.classList.remove('has-inbox');
            this.settingsBtn.title = 'Project Settings';
            return;
        }

        const pendingAccess = Number.isFinite(counts.pendingAccess) ? counts.pendingAccess : 0;
        const pendingSubmissions = Number.isFinite(counts.pendingSubmissions) ? counts.pendingSubmissions : 0;
        const accessLabel = `${pendingAccess} access request${pendingAccess === 1 ? '' : 's'}`;
        const submissionLabel = `${pendingSubmissions} submission${pendingSubmissions === 1 ? '' : 's'}`;

        this.settingsInboxBadge.style.display = 'inline-flex';
        this.settingsInboxBadge.textContent = safeTotal > 99 ? '99+' : String(safeTotal);
        this.settingsBtn.classList.add('has-inbox');
        this.settingsBtn.title = `Project Settings · ${accessLabel}, ${submissionLabel} pending`;
    }

    async loadPlaces(projectId, { bounds = null, year = null, useSnapshot = false, append = false, limit = 250 } = {}) {
        const token = ++this.loadRequestToken;
        this.usesBoundedSnapshots = useSnapshot;

        if (useSnapshot) {
            if (append && !this.snapshotNextCursor) return;

            const search = this.searchInput?.value || '';
            const category = this.categoryFilter?.value || '';
            const snapshot = await getProjectMapSnapshot(projectId, {
                bounds,
                year,
                category,
                search,
                cursor: append ? this.snapshotNextCursor : null,
                limit
            });
            if (token !== this.loadRequestToken) return;

            let snapshotProjectHasPlaces = snapshot.items.length > 0 ? true : null;
            if (!append && !snapshotProjectHasPlaces && bounds && !search.trim() && !category) {
                const presenceSnapshot = await getProjectMapSnapshot(projectId, { year, limit: 1 });
                if (token !== this.loadRequestToken) return;
                snapshotProjectHasPlaces = presenceSnapshot.items.length > 0;
            }

            const existingPlaceIds = new Set(this.places.map((place) => place.id));
            const incomingItems = append
                ? snapshot.items.filter((item) => !existingPlaceIds.has(item.place.id))
                : snapshot.items;
            const incomingPlaces = incomingItems.map((item) => item.place);

            this.places = append ? [...this.places, ...incomingPlaces] : incomingPlaces;
            this.entriesByPlaceId = append ? this.entriesByPlaceId : {};
            this.placeSummariesById = {
                ...(append ? this.placeSummariesById : {}),
                ...Object.fromEntries(incomingItems.map((item) => [item.place.id, {
                    entryCount: item.entryCount,
                    firstYear: item.firstYear,
                    lastYear: item.lastYear
                }]))
            };
            this.markerStatesByPlaceId = {
                ...(append ? this.markerStatesByPlaceId : {}),
                ...Object.fromEntries(incomingItems.map((item) => [item.place.id, item.markerState]))
            };
            this.snapshotHasMore = !!snapshot.nextCursor;
            this.snapshotNextCursor = snapshot.nextCursor || null;
            this.snapshotProjectHasPlaces = append
                ? (this.snapshotProjectHasPlaces ?? (this.places.length > 0))
                : snapshotProjectHasPlaces;

            const nextPrimaryImages = await getPrimaryPlaceImages(append ? incomingPlaces : this.places);
            if (token !== this.loadRequestToken) return;
            this.primaryImagesByPlaceId = append
                ? { ...this.primaryImagesByPlaceId, ...nextPrimaryImages }
                : nextPrimaryImages;
            this.hasLoadedPlaces = true;
            this.countEl.textContent = `${this.places.length}${this.snapshotHasMore ? '+' : ''}`;
            await this.renderPlaces(this.places);
            this.onFilterChange?.(this.places.map(p => p.id));
            this.renderGuideCard();
            return;
        }

        this.places = await getPlacesByProject(projectId);
        if (token !== this.loadRequestToken) return;
        this.entriesByPlaceId = await getTimeEntriesForPlaces(this.places.map(place => place.id));
        if (token !== this.loadRequestToken) return;
        this.placeSummariesById = {};
        this.markerStatesByPlaceId = {};
        this.snapshotHasMore = false;
        this.snapshotNextCursor = null;
        this.snapshotProjectHasPlaces = null;
        this.primaryImagesByPlaceId = await getPrimaryPlaceImages(this.places, { entriesByPlaceId: this.entriesByPlaceId });
        if (token !== this.loadRequestToken) return;
        this.hasLoadedPlaces = true;
        this.filterPlaces();
        this.renderGuideCard();
    }

    handleQueryInput() {
        if (this.usesBoundedSnapshots) {
            this.onQueryChange?.();
            return;
        }
        this.filterPlaces();
    }

    filterPlaces() {
        const query = this.searchInput.value.toLowerCase().trim();
        const cat = this.categoryFilter ? this.categoryFilter.value : '';

        const filtered = this.places.filter(p => {
            const pName = p.name || '';
            const pCatOriginal = p.category || '';
            const aliasText = (p.aliases || []).map(a => a.alias).join(' ').toLowerCase();
            const entryText = (this.entriesByPlaceId[p.id] || []).map(entry => [
                entry.title,
                entry.summary,
                entry.source,
                entry.yearStart,
                entry.yearEnd
            ].filter(value => value !== null && value !== undefined && value !== '').join(' ')).join(' ').toLowerCase();
            const matchesQuery = !query
                || pName.toLowerCase().includes(query)
                || pCatOriginal.toLowerCase().includes(query)
                || aliasText.includes(query)
                || entryText.includes(query);

            // Allow matching "other" categories by checking if it's not one of our standard ones
            let pCat = pCatOriginal.toLowerCase();
            const standardCats = ['residential', 'commercial', 'landmark', 'natural', 'infrastructure'];
            if (cat === 'other') {
                pCat = standardCats.includes(pCat) ? 'standard' : 'other';
            }

            const matchesCat = !cat || pCat === cat;
            return matchesQuery && matchesCat;
        });

        this.countEl.textContent = filtered.length;
        this.renderPlaces(filtered);
        this.onFilterChange?.(filtered.map(p => p.id));
        this.renderGuideCard();
    }

    async renderPlaces(places) {
        const currentGen = ++this.renderGeneration;
        const hasFilters = Boolean(this.searchInput.value.trim() || (this.categoryFilter && this.categoryFilter.value));
        const isViewportLimited = this.usesBoundedSnapshots;
        const hasPlacesOutsideView = isViewportLimited && this.snapshotProjectHasPlaces === true;

        if (places.length === 0) {
            const emptyTitle = hasFilters
                ? 'No matching places'
                : (hasPlacesOutsideView ? 'No places in this view' : 'No places yet');
            const emptyDescription = hasFilters || hasPlacesOutsideView
                ? 'Move the map, zoom out, or try a different search.'
                : this.getEmptyStateDescription();
            this.listEl.classList.add('is-empty');
            this.listEl.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <h4>${escapeHtml(emptyTitle)}</h4>
          <p>${escapeHtml(emptyDescription)}</p>
        </div>
      `;
            return;
        }

        this.listEl.classList.remove('is-empty');
        this.listEl.innerHTML = '';

        // Prepare HTML for all items first to strictly control DOM order and prevent reflow issues
        const fragment = document.createDocumentFragment();

        for (const place of places) {
            if (this.renderGeneration !== currentGen) return; // Abort if a new render started

            const item = document.createElement('div');
            item.className = 'place-item' + (place.id === this.activeId ? ' active' : '');
            item.dataset.placeId = place.id;

            const entries = this.entriesByPlaceId[place.id] || [];
            const summary = this.placeSummariesById[place.id] || null;
            let thumbHtml = '';
            const primaryImage = this.primaryImagesByPlaceId[place.id];
            if (primaryImage?.publicUrl) {
                thumbHtml = `<img src="${escapeAttr(primaryImage.publicUrl)}" class="sidebar-place-img" />`;
            }

            const catColour = {
                residential: '#a78bfa', commercial: '#f59e0b', landmark: '#f472b6',
                natural: '#34d399', infrastructure: '#60a5fa'
            }[place.category] || '#a78bfa';

            const catIcon = {
                residential: '🏠', commercial: '🏪', landmark: '⭐',
                natural: '🌳', infrastructure: '🏗️'
            }[place.category] || '📍';

            const timelineYears = entries.flatMap((entry) => {
                const years = [];
                if (Number.isFinite(entry.yearStart)) years.push(entry.yearStart);
                if (Number.isFinite(entry.yearEnd)) years.push(entry.yearEnd);
                return years;
            });
            const entryCount = summary?.entryCount ?? entries.length;
            const firstYear = summary?.firstYear ?? (timelineYears.length > 0 ? Math.min(...timelineYears) : null);
            const lastYear = summary?.lastYear ?? (timelineYears.length > 0 ? Math.max(...timelineYears) : null);
            const meta = entryCount > 0
                ? `${entryCount} dated entr${entryCount === 1 ? 'y' : 'ies'}${firstYear !== null ? ` · ${firstYear}${lastYear !== null && lastYear !== firstYear ? `–${lastYear}` : ''}` : ''}`
                : (this.canEditPublished ? 'Needs first dated entry' : 'No dated entries yet');
            const formerNames = (place.aliases || [])
                .filter(a => a.endYear !== null && a.endYear !== undefined)
                .slice(-2)
                .map(a => a.alias);
            const formerNameHtml = formerNames.length > 0
                ? `<div class="place-item-meta" style="font-size:11px; opacity:0.8;">Also known as ${escapeHtml(formerNames.join(', '))}</div>`
                : '';

            item.innerHTML = `
        <div class="place-item-icon" style="background:${catColour}22; color:${catColour}">${catIcon}</div>
        <div class="place-item-info">
          <div class="place-item-name">${escapeHtml(place.name)}</div>
          <div class="place-item-meta">${escapeHtml(meta)}</div>
          ${formerNameHtml}
        </div>
        ${thumbHtml}
      `;

            item.addEventListener('click', () => {
                this.setActive(place.id);
                this.onPlaceClick?.(place);
            });

            fragment.appendChild(item);
        }

        // Final sanity check before DOM flush
        if (this.renderGeneration === currentGen) {
            this.listEl.innerHTML = ''; // clear again just in case another sync operation dirtied it
            this.listEl.appendChild(fragment);
            this.renderSnapshotLoadMore();
        }
    }

    renderSnapshotLoadMore() {
        this.listEl.querySelector('.place-list-more-wrap')?.remove();
        if (!this.usesBoundedSnapshots || !this.snapshotHasMore) return;

        const wrap = document.createElement('div');
        wrap.className = 'place-list-more-wrap';
        wrap.innerHTML = `
          <button class="place-list-more" type="button">
            <span>Load more places</span>
            <small>${escapeHtml(String(this.places.length))} shown</small>
          </button>
        `;

        const button = wrap.querySelector('.place-list-more');
        button.addEventListener('click', async () => {
            button.disabled = true;
            button.querySelector('span').textContent = 'Loading...';
            try {
                await this.onLoadMore?.();
            } catch (err) {
                console.warn('Could not load more places:', err);
                button.disabled = false;
                button.querySelector('span').textContent = 'Load more places';
            }
        });

        this.listEl.appendChild(wrap);
    }

    getProjectDescriptionPlaceholder() {
        return this.canEditPublished
            ? 'Add a short summary for this map.'
            : 'No project summary yet.';
    }

    getEmptyStateDescription() {
        if (this.canEditPublished) {
            return 'Add the first place to start building this map.';
        }
        if (this.canSubmit) {
            return 'Suggest the first place and it will go to review before it appears on the map.';
        }
        return 'This map does not have any places yet.';
    }

    renderGuideCard() {
        if (!this.guideCardEl) return;

        const hasFilters = Boolean(this.searchInput.value.trim() || (this.categoryFilter && this.categoryFilter.value));
        const shouldHideForSnapshot = this.usesBoundedSnapshots && this.snapshotProjectHasPlaces !== false;
        if (!this.currentProjectId || !this.hasLoadedPlaces || this.places.length > 0 || hasFilters || shouldHideForSnapshot) {
            this.guideCardEl.style.display = 'none';
            this.guideCardEl.innerHTML = '';
            return;
        }

        let title = 'Start with one place';
        let description = 'This map is empty right now. One place, one dated fact, and one source is enough to get it started.';
        let steps = [
            'Click Add Place.',
            'Click the map to drop the marker.',
            'Save the place, then add the first dated entry.'
        ];
        let primaryAction = { id: 'add', label: 'Add First Place' };

        if (this.canSubmit && !this.canEditPublished) {
            title = 'Make the first suggestion';
            description = 'You can suggest the first place now, even while your edit access is still being reviewed.';
            steps = [
                'Click Suggest Place.',
                'Click the map to mark the location.',
                'Save it, then add a dated note so reviewers know why it matters.'
            ];
            primaryAction = { id: 'add', label: 'Suggest First Place' };
        } else if (!this.canSubmit) {
            title = this.currentUserRole === 'banned'
                ? 'This map is read-only for this account'
                : 'This map is waiting for its first place';
            if (this.currentUserRole === 'banned') {
                description = 'You can still browse published places and sources, but contributions are turned off for this account.';
                steps = [
                    'Check back after editors add the first place.',
                    'Open published places to read the summary and timeline.',
                    'Open the guide for the fastest walkthrough of the project.'
                ];
                primaryAction = { id: 'guide', label: 'Open Guide' };
            } else if (this.isSignedIn) {
                description = 'No places are published yet. Request access if you should help build this map.';
                steps = [
                    'Use Request Access in the sidebar.',
                    'Once approved, add the first place.',
                    'Add one dated fact and a source to get the map started.'
                ];
                primaryAction = { id: 'request', label: 'Request Access' };
            } else {
                description = 'No places are published yet. Sign in if you should help build this map.';
                steps = [
                    'Sign in from the sidebar.',
                    'Request access to help build the map.',
                    'Add the first place and its first dated fact.'
                ];
                primaryAction = { id: 'request', label: 'Sign In to Request Access' };
            }
        }

        this.guideCardEl.innerHTML = `
          <div class="sidebar-guide-kicker">Start Here</div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(description)}</p>
          <ol class="sidebar-guide-steps">
            ${steps.map((step, index) => `
              <li>
                <span>${index + 1}</span>
                <div>${escapeHtml(step)}</div>
              </li>
            `).join('')}
          </ol>
          <div class="sidebar-guide-actions">
            <button class="btn btn-primary" data-sidebar-guide-action="${escapeAttr(primaryAction.id)}">${escapeHtml(primaryAction.label)}</button>
            ${primaryAction.id !== 'guide' ? '<button class="btn btn-ghost" data-sidebar-guide-action="guide">Open Guide</button>' : ''}
          </div>
        `;
        this.guideCardEl.style.display = 'block';

        this.guideCardEl.querySelectorAll('[data-sidebar-guide-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.sidebarGuideAction;
                if (action === 'add') {
                    this.onAddPlace?.();
                } else if (action === 'request') {
                    this.onRequestAccess?.();
                } else if (action === 'guide') {
                    this.onGuide?.();
                }
            });
        });
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
        const placeholder = this.getProjectDescriptionPlaceholder();
        const isPlaceholder = current === placeholder;
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
            el.textContent = newDesc || placeholder;
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
