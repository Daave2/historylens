import { getTimeEntriesForPlace, getImagesForEntry, deleteTimeEntry, deletePlace, createTimeEntry, getProfiles, getComments, addComment } from '../data/store.js';
import { hasAiAccess, generateSpeculativeContext } from '../ai/ai.js';

export default class PlaceDetail {
  constructor({ onAddEntry, onEditEntry, onDeletePlace, onClose }) {
    this.modal = document.getElementById('place-detail-modal');
    this.content = document.getElementById('place-detail-content');
    this.onAddEntry = onAddEntry;
    this.onEditEntry = onEditEntry;
    this.onDeletePlace = onDeletePlace;
    this.onClose = onClose;
    this.place = null;

    // Close button
    this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  async show(place, isReadOnly = false, currentUser = null, currentUserRole = null) {
    this.place = place;
    const entries = await getTimeEntriesForPlace(place.id);
    const comments = await getComments(place.id);

    // Fetch user profiles for attribution
    const userIds = [place.createdBy, ...entries.map(e => e.createdBy), ...comments.map(c => c.user_id)];
    const profiles = await getProfiles(userIds);

    const catColour = {
      residential: '#a78bfa', commercial: '#f59e0b', landmark: '#f472b6',
      natural: '#34d399', infrastructure: '#60a5fa'
    }[place.category] || '#a78bfa';

    const catLabel = place.category.charAt(0).toUpperCase() + place.category.slice(1);

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
            if (!img.publicUrl) return '';
            return `<img src="${img.publicUrl}" alt="${img.caption || ''}" title="${img.caption || ''}" data-lightbox />`;
          }).join('')}</div>`
          : '';

        const yearRange = entry.yearEnd
          ? `${entry.yearStart} – ${entry.yearEnd}`
          : `${entry.yearStart} – present`;

        const confClass = entry.confidence || 'likely';

        // Attribution logic
        const profile = profiles[entry.createdBy];
        let authorDisplay = 'Unknown User';
        if (profile) {
          authorDisplay = profile.display_name || (profile.email ? profile.email.split('@')[0] : 'Unknown');
        }

        timelineHtml += `
          <div class="timeline-entry" data-entry-id="${entry.id}">
            <div class="timeline-dot ${confClass}"></div>
            <div class="timeline-year">${yearRange}</div>
            <div class="timeline-title">${entry.title || 'Untitled entry'}</div>
            <div class="timeline-summary">${entry.summary || ''}</div>
            ${imagesHtml}
            <div class="timeline-source">
              <span class="confidence-badge ${confClass}">${confClass}</span>
              ${entry.source ? `<span>· ${entry.source}</span>` : ''}
              <span>· Added by ${authorDisplay}</span>
              ${(!isReadOnly && (currentUserRole === 'owner' || currentUserRole === 'admin' || (currentUser && entry.createdBy === currentUser.id))) ? `
              <button class="icon-btn edit-entry-btn" data-entry-id="${entry.id}" title="Edit entry">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn delete-entry-btn" data-entry-id="${entry.id}" title="Delete entry">
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
                <strong>${authorDisplay}</strong>
                <span style="color: var(--text-muted); font-size: var(--text-xs);">${new Date(comment.created_at).toLocaleDateString()}</span>
              </div>
              <div style="font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap;">${comment.content}</div>
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
          <h2>${place.name}</h2>
          <span class="place-category-badge" style="background:${catColour}22; color:${catColour}">
            ${catLabel}
          </span>
          <span style="font-size: var(--text-xs); color: var(--text-muted); margin-left: var(--space-sm);">
            ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}
          </span>
          <div style="font-size: var(--text-xs); color: var(--text-secondary); margin-top: var(--space-xs);">
            Added by ${placeAuthor} on ${place.createdAt.toLocaleDateString()}
          </div>
        </div>
      </div>

      ${place.description ? `
      <div class="place-detail-description" style="
        font-family: var(--font-body); 
        font-size: var(--text-sm); 
        line-height: 1.6; 
        color: var(--text-secondary); 
        margin: var(--space-md) 0 var(--space-lg) 0; 
        padding-bottom: var(--space-md); 
        border-bottom: 1px solid var(--glass-border);
        white-space: pre-wrap;
      ">
        ${place.description}
      </div>
      ` : ''}

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
        <button class="tab-btn active" data-tab="timeline" style="background: none; border: none; padding: var(--space-sm) 0; color: var(--text-primary); font-weight: 600; cursor: pointer; border-bottom: 2px solid var(--accent);">Timeline</button>
        <button class="tab-btn" data-tab="discussion" style="background: none; border: none; padding: var(--space-sm) 0; color: var(--text-muted); font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent;">Discussion <span class="badge" style="margin-left:4px; padding:2px 6px; font-size:10px;">${comments.length}</span></button>
      </div>

      <div id="tab-timeline" class="tab-content" style="display: block;">
        ${timelineHtml}
      </div>
      <div id="tab-discussion" class="tab-content" style="display: none;">
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
        this.content.querySelector(`#tab-${tab.dataset.tab}`).style.display = 'block';
      });
    });

    // Wire event listeners
    if (!isReadOnly) {
      this.content.querySelector('#detail-add-entry')?.addEventListener('click', () => {
        this.onAddEntry?.(place);
      });

      this.content.querySelector('#detail-delete-place')?.addEventListener('click', async () => {
        if (confirm(`Delete "${place.name}" and all its entries?`)) {
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

          // Refresh view
          this.show(place);
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
        if (confirm('Delete this entry?')) {
          await deleteTimeEntry(btn.dataset.entryId);
          this.show(place); // Refresh
        }
      });
    });

    // Lightbox
    this.content.querySelectorAll('[data-lightbox]').forEach(img => {
      img.addEventListener('click', () => {
        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';
        overlay.innerHTML = `<img src="${img.src}" alt="${img.alt}" />`;
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
}
