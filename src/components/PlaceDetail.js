import { getTimeEntriesForPlace, getImagesForEntry, deleteTimeEntry, deletePlace, createTimeEntry, getProfiles, getComments, addComment, updatePlace, getPlace, getOverviewHistory, restoreOverviewRevision, createOverviewRevision } from '../data/store.js';
import { hasAiAccess, generateSpeculativeContext } from '../ai/ai.js';
import { safeUrl } from '../utils/sanitize.js';

export default class PlaceDetail {
  constructor({ onAddEntry, onEditEntry, onDeletePlace, onRegenerateOverview, onClose }) {
    this.modal = document.getElementById('place-detail-modal');
    this.content = document.getElementById('place-detail-content');
    this.onAddEntry = onAddEntry;
    this.onEditEntry = onEditEntry;
    this.onDeletePlace = onDeletePlace;
    this.onRegenerateOverview = onRegenerateOverview;
    this.onClose = onClose;
    this.place = null;
    this.activeTab = 'overview';

    // Close button
    this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  async show(place, isReadOnly = false, currentUser = null, currentUserRole = null) {
    this.place = place;
    const [entries, comments, overviewHistory] = await Promise.all([
      getTimeEntriesForPlace(place.id),
      getComments(place.id),
      getOverviewHistory(place.id)
    ]);

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
    if (entries.length === 0) {
      timelineHtml = `
        <div class="empty-state">
          <h4>No historical entries yet</h4>
          <p style="margin-bottom: var(--space-md);">Add the first piece of history for this place — a photo, a story, or a reference.</p>
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
      for (const entry of entries) {
        const images = await getImagesForEntry(entry.id);
        const imagesHtml = images.length > 0
          ? `<div class="timeline-images">${images.map(img => {
            const imageUrl = safeUrl(img.publicUrl);
            if (!imageUrl) return '';
            return `<img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(img.caption || '')}" title="${escapeAttr(img.caption || '')}" data-lightbox />`;
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
    if (!isReadOnly && currentUser) {
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

    this.content.innerHTML = `
      <div class="place-detail-header">
        <div>
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
        </div>
      </div>

      ${!isReadOnly ? `
      <div class="place-detail-actions">
        <button class="btn btn-primary" id="detail-add-entry">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          Add Entry
        </button>
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
          await this.show(refreshed || place, isReadOnly, currentUser, currentUserRole);
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
            await this.show(updated || place, isReadOnly, currentUser, currentUserRole);
            const overviewTab = this.content.querySelector('.tab-btn[data-tab="overview"]');
            overviewTab?.click();
          } catch (err) {
            console.error(err);
            alert('Failed to save overview.');
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
            await this.show(result.place || place, isReadOnly, currentUser, currentUserRole);
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
          await this.show(restoredPlace || place, isReadOnly, currentUser, currentUserRole);
          this.content.querySelector('.tab-btn[data-tab="overview"]')?.click();
        } catch (err) {
          console.error(err);
          alert('Failed to restore overview version.');
        }
      });
    });

    // Wire event listeners
    if (!isReadOnly) {
      this.content.querySelector('#detail-add-entry')?.addEventListener('click', () => {
        this.onAddEntry?.(place);
      });

      this.content.querySelector('#detail-delete-place')?.addEventListener('click', async () => {
        const confirmed = await this.confirmAction(`Delete "${place.name}" and all its entries?`, 'Delete Place');
        if (confirmed) {
          await deletePlace(place.id);
          this.onDeletePlace?.(place);
          this.close();
        }
      });
    }

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
          await this.show(place, isReadOnly, currentUser, currentUserRole);
          const discTab = this.content.querySelector('.tab-btn[data-tab="discussion"]');
          if (discTab) discTab.click();
        } catch (err) {
          console.error(err);
          alert('Failed to post comment.');
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
          this.show(refreshedPlace || place, isReadOnly, currentUser, currentUserRole);
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
          this.show(refreshedPlace || place, isReadOnly, currentUser, currentUserRole); // Refresh
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

  async confirmAction(message, confirmLabel = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      overlay.style.zIndex = '3000';
      overlay.innerHTML = `
        <div class="modal-content glass-card" style="max-width: 440px; width: 100%; padding: var(--space-xl);">
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
        <div class="modal-content glass-card" style="max-width: 440px; width: 100%; padding: var(--space-xl);">
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
