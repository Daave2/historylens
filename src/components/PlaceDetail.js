import {
  getTimeEntriesForPlace,
  getImagesForEntry,
  deleteTimeEntry,
  deletePlace,
  createTimeEntry,
  getProfiles,
  getComments,
  addComment,
  updatePlace,
  getPlace,
  getOverviewHistory,
  restoreOverviewRevision,
  createOverviewRevision,
  getPrimaryPlaceImage,
  getImageVoteSummary,
  voteImage,
  setPlacePinnedImage,
  getPlaceLocationHistory
} from '../data/store.js';
import { hasAiAccess, generateSpeculativeContext } from '../ai/ai.js';
import { safeUrl } from '../utils/sanitize.js';

export default class PlaceDetail {
  constructor({ onAddEntry, onEditEntry, onDeletePlace, onRegenerateOverview, onSuggestMove, onSuggestAlias, onPickLocationFromMap, onClose }) {
    this.modal = document.getElementById('place-detail-modal');
    this.content = document.getElementById('place-detail-content');
    this.onAddEntry = onAddEntry;
    this.onEditEntry = onEditEntry;
    this.onDeletePlace = onDeletePlace;
    this.onRegenerateOverview = onRegenerateOverview;
    this.onSuggestMove = onSuggestMove;
    this.onSuggestAlias = onSuggestAlias;
    this.onPickLocationFromMap = onPickLocationFromMap;
    this.onClose = onClose;
    this.place = null;
    this.activeTab = 'overview';

    // Close button
    this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  async show(place, isReadOnly = false, currentUser = null, currentUserRole = null, canSuggest = false) {
    this.place = place;
    const canSuggestOnly = canSuggest && isReadOnly;
    const canAddEntry = canSuggest || !isReadOnly;
    const canVoteImages = !!currentUser;
    const canPinMainImage = currentUserRole === 'owner' || currentUserRole === 'admin';
    const canProposeCorrections = !!currentUser && canAddEntry;

    const [entries, comments, overviewHistory, primaryImage, locationHistory] = await Promise.all([
      getTimeEntriesForPlace(place.id),
      getComments(place.id),
      getOverviewHistory(place.id),
      getPrimaryPlaceImage(place.id),
      getPlaceLocationHistory(place.id, 5)
    ]);

    const entriesWithImages = [];
    const allImageIds = [];
    for (const entry of entries) {
      const images = await getImagesForEntry(entry.id);
      entriesWithImages.push({ entry, images });
      for (const img of images) {
        allImageIds.push(img.id);
      }
    }
    const voteSummary = allImageIds.length > 0 ? await getImageVoteSummary(allImageIds) : {};

    // Fetch user profiles for attribution
    const userIds = [place.createdBy, ...entries.map(e => e.createdBy), ...comments.map(c => c.user_id), ...overviewHistory.map(r => r.createdBy)];
    const profiles = await getProfiles(userIds);

    const catColour = {
      residential: '#a78bfa', commercial: '#f59e0b', landmark: '#f472b6',
      natural: '#34d399', infrastructure: '#60a5fa'
    }[place.category] || '#a78bfa';

    const catLabel = place.category.charAt(0).toUpperCase() + place.category.slice(1);
    const overviewText = (place.description || '').trim();
    const canManageOverview = !isReadOnly && (
      currentUserRole === 'owner' ||
      currentUserRole === 'admin' ||
      (currentUserRole === 'editor' && currentUser && place.createdBy === currentUser.id)
    );
    const historyHtml = overviewHistory.length === 0
      ? `<div style="font-size: var(--text-xs); color: var(--text-muted);">No overview revisions yet.</div>`
      : overviewHistory.map(rev => {
        const profile = profiles[rev.createdBy];
        const author = profile?.display_name || (profile?.email ? profile.email.split('@')[0] : 'Unknown');
        const reasonLabel = {
          regenerate: 'Updated from timeline',
          restore: 'Restored previous version',
          manual_edit: 'Manual edit'
        }[rev.reason] || rev.reason || 'Updated';

        return `
          <div style="display:flex; justify-content:space-between; align-items:center; gap: var(--space-sm); padding: var(--space-xs) 0; border-bottom: 1px solid var(--glass-border);">
            <div style="min-width:0;">
              <div style="font-size: var(--text-xs); color: var(--text-primary);">${escapeHtml(reasonLabel)}</div>
              <div style="font-size: 11px; color: var(--text-muted);">${new Date(rev.createdAt).toLocaleString()} · ${escapeHtml(author)}</div>
            </div>
            ${canManageOverview ? `<button class="btn btn-ghost restore-overview-btn" data-revision-id="${escapeAttr(rev.id)}" style="padding: 4px 8px; font-size: 11px;">Restore</button>` : ''}
          </div>
        `;
      }).join('');

    const overviewHtml = `
      <div class="place-overview-panel" style="line-height: 1.7; color: var(--text-secondary);">
        ${overviewText
          ? `<div id="place-overview-text" style="white-space: pre-wrap;">${escapeHtml(overviewText)}</div>`
          : `<div id="place-overview-empty" style="color: var(--text-muted);">No overview yet. Add timeline entries to auto-generate one.</div>`
        }
        ${canManageOverview ? `
          <div style="margin-top: var(--space-md); display: flex; gap: var(--space-sm); flex-wrap: wrap;">
            <button class="btn btn-ghost" id="detail-edit-overview">Edit overview</button>
            <button class="btn btn-ghost" id="detail-refresh-overview">Update from timeline</button>
          </div>
        ` : ''}
        <div style="margin-top: var(--space-lg); border-top: 1px solid var(--glass-border); padding-top: var(--space-md);">
          <div style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: var(--space-sm); text-transform: uppercase; letter-spacing: 0.08em;">Overview History</div>
          <div style="display:flex; flex-direction:column; gap: var(--space-xs);">${historyHtml}</div>
        </div>
      </div>
    `;

    let timelineHtml = '';
    if (entriesWithImages.length === 0) {
      timelineHtml = `
        <div class="empty-state">
          <h4>No historical entries yet</h4>
          <p style="margin-bottom: var(--space-md);">${canSuggestOnly ? 'Submit the first historical suggestion for moderator approval.' : 'Add the first piece of history for this place — a photo, a story, or a reference.'}</p>
          ${(hasAiAccess() && !isReadOnly) ? `
            <button class="btn btn-ghost" id="detail-ai-context">
              ✨ AI: What was here before?
            </button>
            <div id="ai-loading" style="display:none; font-size:var(--text-xs); color:var(--text-secondary); margin-top:var(--space-sm);">
              Consulting historical context...
            </div>
          ` : ''}
        </div>
      `;
    } else {
      timelineHtml = '<div class="timeline">';
      for (const { entry, images } of entriesWithImages) {
        const imagesHtml = images.length > 0
          ? `<div class="timeline-images">${images.map(img => {
            const imageUrl = safeUrl(img.publicUrl);
            if (!imageUrl) return '';
            const vote = voteSummary[img.id] || { score: 0, totalVotes: 0, userVote: 0 };
            const userVote = vote.userVote || 0;
            const scoreText = `${vote.score || 0} vote${Math.abs(vote.score || 0) === 1 ? '' : 's'}`;
            const isPinned = place.pinnedImageId && place.pinnedImageId === img.id;

            return `
              <div class="timeline-image-card" style="display:flex; flex-direction:column; gap:6px; background:var(--bg-surface); border:1px solid var(--glass-border); border-radius:var(--radius-sm); padding:6px;">
                <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(img.caption || '')}" title="${escapeAttr(img.caption || '')}" data-lightbox />
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                  <span style="font-size:11px; color:var(--text-muted);">${escapeHtml(scoreText)}</span>
                  <div style="display:flex; gap:4px; align-items:center;">
                    ${canVoteImages ? `
                      <button class="icon-btn image-vote-btn" data-image-id="${escapeAttr(img.id)}" data-vote="1" data-current-vote="${userVote}" title="Upvote" style="width:24px; height:24px; color:${userVote === 1 ? 'var(--accent)' : 'var(--text-muted)'};">▲</button>
                      <button class="icon-btn image-vote-btn" data-image-id="${escapeAttr(img.id)}" data-vote="-1" data-current-vote="${userVote}" title="Downvote" style="width:24px; height:24px; color:${userVote === -1 ? 'var(--danger)' : 'var(--text-muted)'};">▼</button>
                    ` : ''}
                    ${canPinMainImage ? `
                      <button class="btn btn-ghost image-pin-btn" data-image-id="${escapeAttr(img.id)}" style="padding:2px 8px; font-size:11px;">${isPinned ? 'Pinned' : 'Set Main'}</button>
                    ` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('')}</div>`
          : '';

        const yearRange = entry.yearEnd
          ? `${entry.yearStart} – ${entry.yearEnd}`
          : `${entry.yearStart} – present`;

        const confClass = ['verified', 'likely', 'speculative'].includes(entry.confidence)
          ? entry.confidence
          : 'likely';

        // Attribution logic
        const profile = profiles[entry.createdBy];
        let authorDisplay = 'Unknown User';
        if (profile) {
          authorDisplay = profile.display_name || (profile.email ? profile.email.split('@')[0] : 'Unknown');
        }

        timelineHtml += `
          <div class="timeline-entry" data-entry-id="${escapeAttr(entry.id)}">
            <div class="timeline-dot ${confClass}"></div>
            <div class="timeline-year">${yearRange}</div>
            <div class="timeline-title">${escapeHtml(entry.title || 'Untitled entry')}</div>
            <div class="timeline-summary">${escapeHtml(entry.summary || '')}</div>
            ${imagesHtml}
            <div class="timeline-source">
              <span class="confidence-badge ${confClass}">${confClass}</span>
              ${entry.source ? `<span>· ${escapeHtml(entry.source)}</span>` : ''}
              <span>· Added by ${escapeHtml(authorDisplay)}</span>
              ${(!isReadOnly && (currentUserRole === 'owner' || currentUserRole === 'admin' || (currentUser && entry.createdBy === currentUser.id))) ? `
              <button class="icon-btn edit-entry-btn" data-entry-id="${escapeAttr(entry.id)}" title="Edit entry">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn delete-entry-btn" data-entry-id="${escapeAttr(entry.id)}" title="Delete entry">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
              ` : ''}
            </div>
          </div>
        `;
      }
      timelineHtml += '</div>';
    }

    // ── Comments HTML ──
    let commentsHtml = '<div class="comments-list">';
    if (comments.length === 0) {
      commentsHtml += `
        <div class="empty-state" style="padding: var(--space-xl); margin-top: var(--space-md);">
          <h4>No comments yet</h4>
          <p>Start a discussion with collaborators about this place.</p>
        </div>
      `;
    } else {
      for (const comment of comments) {
        const cProfile = profiles[comment.user_id];
        let authorDisplay = 'Unknown User';
        let initial = '?';
        if (cProfile) {
          authorDisplay = cProfile.display_name || (cProfile.email ? cProfile.email.split('@')[0] : 'Unknown');
          initial = authorDisplay.charAt(0).toUpperCase();
        }

        commentsHtml += `
          <div class="comment-item" style="display: flex; gap: var(--space-md); margin-bottom: var(--space-lg);">
            <div class="comment-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: var(--glass-overlay); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: var(--text-sm); flex-shrink: 0; border: 1px solid var(--glass-border);">
              ${initial}
            </div>
            <div class="comment-content" style="flex: 1;">
              <div style="font-size: var(--text-sm); display: flex; justify-content: space-between; margin-bottom: 4px;">
                <strong>${escapeHtml(authorDisplay)}</strong>
                <span style="color: var(--text-muted); font-size: var(--text-xs);">${new Date(comment.created_at).toLocaleDateString()}</span>
              </div>
              <div style="font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(comment.content || '')}</div>
            </div>
          </div>
        `;
      }
    }
    commentsHtml += '</div>';

    // Add comment form
    if (currentUser && canAddEntry) {
      commentsHtml += `
        <div class="comment-form-container" style="margin-top: var(--space-xl); padding-top: var(--space-lg); border-top: 1px solid var(--glass-border);">
          <textarea id="new-comment-text" class="form-textarea" placeholder="Write a comment..." style="width: 100%; min-height: 80px; margin-bottom: var(--space-sm);"></textarea>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <p style="font-size: var(--text-xs); color: var(--text-muted);">Format: text only</p>
            <button id="btn-submit-comment" class="btn btn-primary" style="padding: 6px 16px; font-size: var(--text-sm);">Post Comment</button>
          </div>
        </div>
      `;
    } else if (!currentUser) {
      commentsHtml += `
        <div style="margin-top: var(--space-xl); text-align: center; font-size: var(--text-sm); color: var(--text-muted);">
          <p>Sign in to join the discussion.</p>
        </div>
      `;
    }

    const pProfile = profiles[place.createdBy];
    let placeAuthor = 'Unknown User';
    if (pProfile) {
      placeAuthor = pProfile.display_name || (pProfile.email ? pProfile.email.split('@')[0] : 'Unknown');
    }
    const historicalNames = (place.aliases || []).slice().sort((a, b) => {
      const aEnd = a.endYear ?? Infinity;
      const bEnd = b.endYear ?? Infinity;
      return aEnd - bEnd;
    });
    const formerNames = historicalNames
      .map(a => {
        if (a.startYear && a.endYear) return `${a.alias} (${a.startYear}-${a.endYear})`;
        if (a.endYear) return `${a.alias} (until ${a.endYear})`;
        if (a.startYear) return `${a.alias} (from ${a.startYear})`;
        return a.alias;
      })
      .join(', ');
    const primaryImageUrl = safeUrl(primaryImage?.publicUrl);
    const lastMove = (locationHistory || [])[0];
    const locationHistoryLabel = lastMove
      ? `Last location update: ${Number(lastMove.previous_lat).toFixed(5)}, ${Number(lastMove.previous_lng).toFixed(5)} → ${Number(lastMove.new_lat).toFixed(5)}, ${Number(lastMove.new_lng).toFixed(5)}`
      : '';

    this.content.innerHTML = `
      <div class="place-detail-header">
        <div style="display:flex; justify-content:space-between; gap: var(--space-lg); align-items:flex-start; flex-wrap:wrap;">
          <div style="min-width:260px; flex:1;">
            <h2>${escapeHtml(place.name)}</h2>
            <span class="place-category-badge" style="background:${catColour}22; color:${catColour}">
              ${escapeHtml(catLabel)}
            </span>
            <span style="font-size: var(--text-xs); color: var(--text-muted); margin-left: var(--space-sm);">
              ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}
            </span>
            <div style="font-size: var(--text-xs); color: var(--text-secondary); margin-top: var(--space-xs);">
              Added by ${escapeHtml(placeAuthor)} on ${place.createdAt.toLocaleDateString()}
            </div>
            ${formerNames ? `
              <div style="font-size: var(--text-xs); color: var(--text-secondary); margin-top: 4px;">
                Historical names: ${escapeHtml(formerNames)}
              </div>
            ` : ''}
            ${locationHistoryLabel ? `
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                ${escapeHtml(locationHistoryLabel)}
              </div>
            ` : ''}
          </div>
          ${primaryImageUrl ? `
            <div style="width: 180px; flex-shrink:0;">
              <img src="${escapeAttr(primaryImageUrl)}" alt="Main image for ${escapeAttr(place.name)}" style="width:100%; height:120px; object-fit:cover; border-radius: var(--radius-sm); border:1px solid var(--glass-border);" />
              <div style="font-size:11px; color:var(--text-muted); margin-top:4px; text-align:right;">
                ${primaryImage?.isPinned ? 'Pinned main image' : 'Community-ranked main image'}
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      ${canAddEntry ? `
      <div class="place-detail-actions">
        <button class="btn btn-primary" id="detail-add-entry">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          ${canSuggestOnly ? 'Suggest Entry' : 'Add Entry'}
        </button>
        ${canProposeCorrections ? `
        <button class="btn btn-ghost" id="detail-suggest-alias">
          ${canSuggestOnly ? 'Suggest Historic Name' : 'Add Historic Name'}
        </button>
        <button class="btn btn-ghost" id="detail-suggest-move">
          Report Wrong Location
        </button>
        ` : ''}
        ${(currentUserRole === 'owner' || currentUserRole === 'admin' || (currentUser && place.createdBy === currentUser.id)) ? `
        <button class="btn btn-danger" id="detail-delete-place">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Delete Place
        </button>
        ` : ''}
      </div>
      ` : ''}

      <div class="detail-tabs" style="display: flex; gap: var(--space-md); border-bottom: 1px solid var(--glass-border); margin: var(--space-lg) 0;">
        <button class="tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview" style="background: none; border: none; padding: var(--space-sm) 0; color: ${this.activeTab === 'overview' ? 'var(--text-primary)' : 'var(--text-muted)'}; font-weight: ${this.activeTab === 'overview' ? '600' : '500'}; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'overview' ? 'var(--accent)' : 'transparent'};">Overview</button>
        <button class="tab-btn ${this.activeTab === 'timeline' ? 'active' : ''}" data-tab="timeline" style="background: none; border: none; padding: var(--space-sm) 0; color: ${this.activeTab === 'timeline' ? 'var(--text-primary)' : 'var(--text-muted)'}; font-weight: ${this.activeTab === 'timeline' ? '600' : '500'}; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'timeline' ? 'var(--accent)' : 'transparent'};">Timeline</button>
        <button class="tab-btn ${this.activeTab === 'discussion' ? 'active' : ''}" data-tab="discussion" style="background: none; border: none; padding: var(--space-sm) 0; color: ${this.activeTab === 'discussion' ? 'var(--text-primary)' : 'var(--text-muted)'}; font-weight: ${this.activeTab === 'discussion' ? '600' : '500'}; cursor: pointer; border-bottom: 2px solid ${this.activeTab === 'discussion' ? 'var(--accent)' : 'transparent'};">Discussion <span class="badge" style="margin-left:4px; padding:2px 6px; font-size:10px;">${comments.length}</span></button>
      </div>

      <div id="tab-overview" class="tab-content" style="display: ${this.activeTab === 'overview' ? 'block' : 'none'};">
        ${overviewHtml}
      </div>
      <div id="tab-timeline" class="tab-content" style="display: ${this.activeTab === 'timeline' ? 'block' : 'none'};">
        ${timelineHtml}
      </div>
      <div id="tab-discussion" class="tab-content" style="display: ${this.activeTab === 'discussion' ? 'block' : 'none'};">
        ${commentsHtml}
      </div>
    `;

    // Tab logic
    const tabs = this.content.querySelectorAll('.tab-btn');
    const tabContents = this.content.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => {
          t.classList.remove('active');
          t.style.fontWeight = '500';
          t.style.color = 'var(--text-muted)';
          t.style.borderBottomColor = 'transparent';
        });
        tabContents.forEach(c => c.style.display = 'none');

        tab.classList.add('active');
        tab.style.fontWeight = '600';
        tab.style.color = 'var(--text-primary)';
        tab.style.borderBottomColor = 'var(--accent)';
        this.activeTab = tab.dataset.tab;
        this.content.querySelector(`#tab-${tab.dataset.tab}`).style.display = 'block';
      });
    });

    const editOverviewBtn = this.content.querySelector('#detail-edit-overview');
    if (editOverviewBtn) {
      editOverviewBtn.addEventListener('click', () => {
        const currentText = (place.description || '').trim();
        const panel = this.content.querySelector('#tab-overview');
        if (!panel) return;

        panel.innerHTML = `
          <div class="form-group">
            <label class="form-label">Overview</label>
            <textarea id="detail-overview-input" class="form-textarea" style="min-height: 180px;">${escapeHtml(currentText)}</textarea>
          </div>
          <div style="display:flex; gap: var(--space-sm); justify-content:flex-end;">
            <button class="btn btn-ghost" id="detail-overview-cancel">Cancel</button>
            <button class="btn btn-primary" id="detail-overview-save">Save Overview</button>
          </div>
        `;

        panel.querySelector('#detail-overview-cancel')?.addEventListener('click', async () => {
          const refreshed = await getPlace(place.id);
          await this.show(refreshed || place, isReadOnly, currentUser, currentUserRole, canSuggest);
          const overviewTab = this.content.querySelector('.tab-btn[data-tab="overview"]');
          overviewTab?.click();
        });

        panel.querySelector('#detail-overview-save')?.addEventListener('click', async () => {
          const input = panel.querySelector('#detail-overview-input');
          const nextText = input?.value?.trim() || '';
          try {
            const previousText = place.description || '';
            await updatePlace(place.id, { description: nextText });
            if (nextText !== previousText) {
              // Best-effort audit trail; don't block save on history logging issues.
              try {
                await createOverviewRevision({
                  placeId: place.id,
                  previousDescription: previousText,
                  newDescription: nextText,
                  reason: 'manual_edit'
                });
              } catch (historyErr) {
                console.warn('Could not log overview revision:', historyErr);
              }
            }
            const updated = await getPlace(place.id);
            await this.show(updated || place, isReadOnly, currentUser, currentUserRole, canSuggest);
            const overviewTab = this.content.querySelector('.tab-btn[data-tab="overview"]');
            overviewTab?.click();
          } catch (err) {
            console.error(err);
            await this.showNotice('Failed to save overview.', 'Save Failed');
          }
        });
      });
    }

    const refreshOverviewBtn = this.content.querySelector('#detail-refresh-overview');
    if (refreshOverviewBtn) {
      refreshOverviewBtn.addEventListener('click', async () => {
        const confirmed = await this.confirmAction(
          'Regenerate overview from timeline? This may overwrite manual edits. You can undo once after updating.',
          'Update Overview'
        );
        if (!confirmed) return;

        try {
          refreshOverviewBtn.disabled = true;
          refreshOverviewBtn.textContent = 'Updating...';
          const result = await this.onRegenerateOverview?.(place.id);
          if (result?.updated) {
            await this.show(result.place || place, isReadOnly, currentUser, currentUserRole, canSuggest);
            this.content.querySelector('.tab-btn[data-tab="overview"]')?.click();
            await this.showNotice('Overview updated from timeline entries.', 'Overview Updated');
          } else {
            await this.showNotice('Overview is already up to date.', 'No Changes');
          }
        } catch (err) {
          console.error(err);
          await this.showNotice('Failed to update overview.', 'Update Failed');
        } finally {
          refreshOverviewBtn.disabled = false;
          refreshOverviewBtn.textContent = 'Update from timeline';
        }
      });
    }

    this.content.querySelectorAll('.restore-overview-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const revisionId = btn.dataset.revisionId;
        if (!revisionId) return;
        const confirmed = await this.confirmAction(
          'Restore this overview version? This will replace the current overview text.',
          'Restore Version'
        );
        if (!confirmed) return;
        try {
          const restoredPlace = await restoreOverviewRevision(revisionId);
          await this.show(restoredPlace || place, isReadOnly, currentUser, currentUserRole, canSuggest);
          this.content.querySelector('.tab-btn[data-tab="overview"]')?.click();
        } catch (err) {
          console.error(err);
          await this.showNotice('Failed to restore overview version.', 'Restore Failed');
        }
      });
    });

    // Wire event listeners
    if (canAddEntry) {
      this.content.querySelector('#detail-add-entry')?.addEventListener('click', () => {
        this.onAddEntry?.(place);
      });

      this.content.querySelector('#detail-suggest-alias')?.addEventListener('click', async () => {
        const result = await this.promptHistoricName();
        if (!result) return;
        try {
          await this.onSuggestAlias?.(place, result);
          if (canSuggestOnly) {
            await this.showNotice('Name suggestion submitted for moderation.', 'Submitted');
          }
        } catch (err) {
          console.error(err);
          await this.showNotice('Could not submit historical name.', 'Submission Failed');
        }
      });

      this.content.querySelector('#detail-suggest-move')?.addEventListener('click', async () => {
        const result = await this.promptMoveLocation(place);
        if (!result) return;
        try {
          await this.onSuggestMove?.(place, result);
          await this.showNotice('Location correction submitted for review.', 'Submitted');
        } catch (err) {
          console.error(err);
          await this.showNotice('Could not submit location correction.', 'Submission Failed');
        }
      });
    }

    this.content.querySelector('#detail-delete-place')?.addEventListener('click', async () => {
      const confirmed = await this.confirmAction(`Delete "${place.name}" and all its entries?`, 'Delete Place');
      if (confirmed) {
        await deletePlace(place.id);
        this.onDeletePlace?.(place);
        this.close();
      }
    });

    // Comment sumbit
    const commentBtn = this.content.querySelector('#btn-submit-comment');
    if (commentBtn) {
      commentBtn.addEventListener('click', async () => {
        const textInput = this.content.querySelector('#new-comment-text');
        const text = textInput.value;
        if (!text.trim()) return;

        try {
          commentBtn.disabled = true;
          commentBtn.textContent = 'Posting...';
          await addComment(place.id, text);
          // Refresh the view, but try to default straight back to the discussion tab
          await this.show(place, isReadOnly, currentUser, currentUserRole, canSuggest);
          const discTab = this.content.querySelector('.tab-btn[data-tab="discussion"]');
          if (discTab) discTab.click();
        } catch (err) {
          console.error(err);
          await this.showNotice('Failed to post comment.', 'Comment Failed');
        } finally {
          if (commentBtn) {
            commentBtn.disabled = false;
            commentBtn.textContent = 'Post Comment';
          }
        }
      });
    }

    // AI Speculative Context
    const aiBtn = this.content.querySelector('#detail-ai-context');
    if (aiBtn) {
      aiBtn.addEventListener('click', async () => {
        aiBtn.style.display = 'none';
        this.content.querySelector('#ai-loading').style.display = 'block';

        try {
          // Generate context using first known year if available, otherwise just use town history
          const firstEntry = entries.length > 0 ? [...entries].sort((a, b) => a.yearStart - b.yearStart)[0] : null;
          const firstYear = firstEntry ? firstEntry.yearStart : 1850; // default assumption for Blackpool growth

          const areaContext = "Blackpool was historically coastal sand dunes and marshland until the mid-19th century when the railway arrived and Victorian tourism boomed, transforming the coastline into a dense resort town.";

          const note = await generateSpeculativeContext(place.name, firstYear, areaContext);

          // Save as a new entry
          await createTimeEntry({
            placeId: place.id,
            yearStart: note.yearStart || 1800,
            yearEnd: note.yearEnd,
            title: note.title,
            summary: note.summary,
            source: note.source,
            sourceType: note.sourceType,
            confidence: note.confidence,
            images: []
          });

          // Refresh view and regenerate overview
          this.activeTab = 'overview';
          const refreshedPlace = await getPlace(place.id);
          this.show(refreshedPlace || place, isReadOnly, currentUser, currentUserRole, canSuggest);
        } catch (err) {
          console.error(err);
          aiBtn.style.display = 'block';
          this.content.querySelector('#ai-loading').textContent = '❌ Failed to generate context.';
        }
      });
    }

    // Edit entry buttons
    this.content.querySelectorAll('.edit-entry-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const entryId = btn.dataset.entryId;
        const entry = entries.find(en => en.id === entryId);
        if (entry) this.onEditEntry?.(place, entry);
      });
    });

    // Delete entry buttons
    this.content.querySelectorAll('.delete-entry-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await this.confirmAction('Delete this entry?', 'Delete Entry');
        if (confirmed) {
          await deleteTimeEntry(btn.dataset.entryId);
          this.activeTab = 'overview';
          const refreshedPlace = await getPlace(place.id);
          this.show(refreshedPlace || place, isReadOnly, currentUser, currentUserRole, canSuggest); // Refresh
        }
      });
    });

    this.content.querySelectorAll('.image-vote-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const imageId = btn.dataset.imageId;
        const vote = Number.parseInt(btn.dataset.vote || '0', 10);
        const currentVote = Number.parseInt(btn.dataset.currentVote || '0', 10);
        const nextVote = currentVote === vote ? 0 : vote;
        if (!imageId || !Number.isFinite(vote)) return;

        try {
          await voteImage(imageId, place.projectId, nextVote);
          this.activeTab = 'timeline';
          const refreshedPlace = await getPlace(place.id);
          await this.show(refreshedPlace || place, isReadOnly, currentUser, currentUserRole, canSuggest);
          this.content.querySelector('.tab-btn[data-tab="timeline"]')?.click();
        } catch (err) {
          console.error(err);
          await this.showNotice('Could not register your vote.', 'Voting Failed');
        }
      });
    });

    this.content.querySelectorAll('.image-pin-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const imageId = btn.dataset.imageId;
        if (!imageId) return;

        try {
          const nextPinned = place.pinnedImageId === imageId ? null : imageId;
          await setPlacePinnedImage(place.id, nextPinned);
          this.activeTab = 'timeline';
          const refreshedPlace = await getPlace(place.id);
          await this.show(refreshedPlace || place, isReadOnly, currentUser, currentUserRole, canSuggest);
          this.content.querySelector('.tab-btn[data-tab="timeline"]')?.click();
        } catch (err) {
          console.error(err);
          await this.showNotice('Could not update main image.', 'Pin Failed');
        }
      });
    });

    // Lightbox
    this.content.querySelectorAll('[data-lightbox]').forEach(img => {
      img.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';
        const imageUrl = safeUrl(img.src);
        if (!imageUrl) return;
        const fullImage = document.createElement('img');
        fullImage.src = imageUrl;
        fullImage.alt = img.alt || '';
        overlay.appendChild(fullImage);
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
      });
    });

    this.modal.style.display = 'flex';
  }

  close() {
    this.modal.style.display = 'none';
    this.onClose?.();
  }

  async promptHistoricName() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      overlay.style.zIndex = '3000';
      overlay.innerHTML = `
        <div class="modal glass-panel" style="max-width: 480px; width: 100%; padding: var(--space-xl);">
          <h3 style="font-family: var(--font-heading); margin-bottom: var(--space-md);">Historical Name</h3>
          <div class="form-group">
            <label class="form-label">Name</label>
            <input id="alias-name" class="form-input" type="text" placeholder="e.g. Bombay" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">From year (optional)</label>
              <input id="alias-start" class="form-input" type="number" />
            </div>
            <div class="form-group">
              <label class="form-label">Until year (optional)</label>
              <input id="alias-end" class="form-input" type="number" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Note (optional)</label>
            <textarea id="alias-note" class="form-textarea" rows="3" placeholder="Why this name changed"></textarea>
          </div>
          <div style="display:flex; justify-content:flex-end; gap: var(--space-sm); margin-top: var(--space-md);">
            <button class="btn btn-ghost" id="alias-cancel">Cancel</button>
            <button class="btn btn-primary" id="alias-save">Submit</button>
          </div>
        </div>
      `;

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) cleanup(null);
      });
      overlay.querySelector('#alias-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('#alias-save')?.addEventListener('click', () => {
        const alias = overlay.querySelector('#alias-name')?.value?.trim() || '';
        if (!alias) {
          overlay.querySelector('#alias-name')?.focus();
          return;
        }
        cleanup({
          alias,
          startYear: overlay.querySelector('#alias-start')?.value || null,
          endYear: overlay.querySelector('#alias-end')?.value || null,
          note: overlay.querySelector('#alias-note')?.value?.trim() || ''
        });
      });

      document.body.appendChild(overlay);
      overlay.querySelector('#alias-name')?.focus();
    });
  }

  async promptMoveLocation(place, initialValues = {}) {
    return new Promise((resolve) => {
      const initialLat = Number.isFinite(initialValues.lat) ? initialValues.lat : place.lat;
      const initialLng = Number.isFinite(initialValues.lng) ? initialValues.lng : place.lng;
      const initialReason = initialValues.reason || '';

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      overlay.style.zIndex = '3000';
      overlay.innerHTML = `
        <div class="modal glass-panel" style="max-width: 480px; width: 100%; padding: var(--space-xl);">
          <h3 style="font-family: var(--font-heading); margin-bottom: var(--space-md);">Suggest Location Correction</h3>
          <p style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: var(--space-md);">
            Current: ${escapeHtml(place.lat.toFixed(5))}, ${escapeHtml(place.lng.toFixed(5))}
          </p>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">New latitude</label>
              <input id="move-lat" class="form-input" type="number" step="any" value="${escapeAttr(initialLat.toFixed(6))}" />
            </div>
            <div class="form-group">
              <label class="form-label">New longitude</label>
              <input id="move-lng" class="form-input" type="number" step="any" value="${escapeAttr(initialLng.toFixed(6))}" />
            </div>
          </div>
          <div class="form-group" style="margin-top: calc(-1 * var(--space-xs));">
            <button class="btn btn-ghost" id="move-pick-map" type="button" style="width: 100%; justify-content: center;">
              Pick on map
            </button>
          </div>
          <div class="form-group">
            <label class="form-label">Reason</label>
            <textarea id="move-reason" class="form-textarea" rows="3" placeholder="Explain why the current location is incorrect">${escapeHtml(initialReason)}</textarea>
          </div>
          <div style="display:flex; justify-content:flex-end; gap: var(--space-sm); margin-top: var(--space-md);">
            <button class="btn btn-ghost" id="move-cancel">Cancel</button>
            <button class="btn btn-primary" id="move-save">Submit</button>
          </div>
        </div>
      `;

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) cleanup(null);
      });
      overlay.querySelector('#move-cancel')?.addEventListener('click', () => cleanup(null));
      overlay.querySelector('#move-pick-map')?.addEventListener('click', async () => {
        if (!this.onPickLocationFromMap) return;

        const currentLat = Number.parseFloat(overlay.querySelector('#move-lat')?.value || '');
        const currentLng = Number.parseFloat(overlay.querySelector('#move-lng')?.value || '');
        const reason = overlay.querySelector('#move-reason')?.value?.trim() || '';

        overlay.remove();
        this.modal.style.display = 'none';

        const picked = await this.onPickLocationFromMap({
          lat: Number.isFinite(currentLat) ? currentLat : initialLat,
          lng: Number.isFinite(currentLng) ? currentLng : initialLng
        });

        this.modal.style.display = 'flex';

        const nextValues = {
          lat: picked?.lat ?? (Number.isFinite(currentLat) ? currentLat : initialLat),
          lng: picked?.lng ?? (Number.isFinite(currentLng) ? currentLng : initialLng),
          reason
        };
        const resumed = await this.promptMoveLocation(place, nextValues);
        resolve(resumed);
      });
      overlay.querySelector('#move-save')?.addEventListener('click', () => {
        const lat = Number.parseFloat(overlay.querySelector('#move-lat')?.value || '');
        const lng = Number.parseFloat(overlay.querySelector('#move-lng')?.value || '');
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
        cleanup({
          lat,
          lng,
          reason: overlay.querySelector('#move-reason')?.value?.trim() || ''
        });
      });

      document.body.appendChild(overlay);
      overlay.querySelector('#move-lat')?.focus();
    });
  }

  async confirmAction(message, confirmLabel = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      overlay.style.zIndex = '3000';
      overlay.innerHTML = `
        <div class="modal glass-panel" style="max-width: 440px; width: 100%; padding: var(--space-xl);">
          <h3 style="font-family: var(--font-heading); margin-bottom: var(--space-md);">Please confirm</h3>
          <p style="color: var(--text-secondary); margin-bottom: var(--space-lg);">${escapeHtml(message)}</p>
          <div style="display:flex; justify-content:flex-end; gap: var(--space-sm);">
            <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
            <button class="btn btn-danger" id="confirm-accept">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `;

      const cleanup = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) cleanup(false);
      });
      overlay.querySelector('#confirm-cancel')?.addEventListener('click', () => cleanup(false));
      overlay.querySelector('#confirm-accept')?.addEventListener('click', () => cleanup(true));
      document.body.appendChild(overlay);
    });
  }

  async showNotice(message, title = 'Notice') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      overlay.style.zIndex = '3000';
      overlay.innerHTML = `
        <div class="modal glass-panel" style="max-width: 440px; width: 100%; padding: var(--space-xl);">
          <h3 style="font-family: var(--font-heading); margin-bottom: var(--space-md);">${escapeHtml(title)}</h3>
          <p style="color: var(--text-secondary); margin-bottom: var(--space-lg);">${escapeHtml(message)}</p>
          <div style="display:flex; justify-content:flex-end;">
            <button class="btn btn-primary" id="notice-ok">OK</button>
          </div>
        </div>
      `;

      const cleanup = () => {
        overlay.remove();
        resolve();
      };

      overlay.addEventListener('click', (evt) => {
        if (evt.target === overlay) cleanup();
      });
      overlay.querySelector('#notice-ok')?.addEventListener('click', cleanup);
      document.body.appendChild(overlay);
    });
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
