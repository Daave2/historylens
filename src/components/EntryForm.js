import { escapeAttr, escapeHtml } from '../utils/sanitize.js';
import { getProjectSources, createSource, SOURCE_TYPE_ICONS } from '../data/store.js';

export default class EntryForm {
  constructor({ onSave, onCancel }) {
    this.modal = document.getElementById('entry-form-modal');
    this.content = document.getElementById('entry-form-content');
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.place = null;
    this.editingEntry = null;
    this.pendingImages = []; // { file, preview }
    this.isSuggestionMode = false;
    this.selectedSourceId = null;
    this.projectSources = [];

    this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  show(place, existingEntry = null, options = {}) {
    this.place = place;
    this.editingEntry = existingEntry;
    this.pendingImages = [];
    this.selectedSourceId = null;
    this.projectSources = [];

    const e = existingEntry || {};
    const isEdit = !!existingEntry;
    const isSuggestion = !isEdit && !!options.suggestionMode;
    const canAttachImages = !isSuggestion;
    const canCreateStructuredSources = !isSuggestion;
    this.isSuggestionMode = isSuggestion;

    this.content.innerHTML = `
      <h2 style="font-family: var(--font-heading); margin-bottom: var(--space-xl);">
        ${isEdit ? 'Edit Entry' : (isSuggestion ? 'Suggest Historical Entry' : 'Add Historical Entry')}
      </h2>
      <p style="color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: var(--space-xl);">
        for <strong>${escapeHtml(place.name)}</strong>
      </p>

      <div class="form-group">
        <label class="form-label">What happened here?</label>
        <p class="form-hint" style="margin-bottom: var(--space-sm);">Start with a short note. You can add dates, sources, and photos below.</p>
        <textarea class="form-textarea" id="ef-summary" placeholder="Example: The building reopened as a boarding house in the early 1970s and stayed in family ownership for two decades." style="min-height:130px;">${escapeHtml(e.summary || '')}</textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Approx year</label>
          <input class="form-input" id="ef-year-start" type="number" min="1000" max="2030" placeholder="e.g. 1902" value="${e.yearStart || ''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Short title (optional)</label>
          <input class="form-input" id="ef-title" type="text" placeholder="Optional short heading" value="${escapeAttr(e.title || '')}" />
        </div>
      </div>

      ${canAttachImages ? `
        <button class="btn btn-ghost" id="ef-toggle-images" style="margin-bottom: var(--space-sm);">
          ${this.pendingImages.length > 0 ? 'Hide photos and documents' : 'Add photos or documents'}
        </button>

        <div class="form-group" id="ef-images-section" style="display: ${this.pendingImages.length > 0 ? 'block' : 'none'};">
          <label class="form-label">Photos / Documents</label>
          <div class="image-upload-zone" id="ef-drop-zone">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p>Drop images here or click to browse</p>
            <span class="hint">JPG, PNG, WebP — any historical photos, maps, or documents</span>
          </div>
          <input type="file" id="ef-file-input" multiple accept="image/*" style="display:none;" />
          <div class="image-preview-grid" id="ef-preview-grid"></div>
        </div>
      ` : `
        <p class="form-hint entry-suggestion-image-note">Photos and documents can be added after an editor approves this suggested entry.</p>
      `}

      <button class="btn btn-ghost" id="ef-toggle-advanced" style="margin-bottom: var(--space-sm);">
        ${isEdit ? 'Hide dates, sources, and confidence' : 'Add dates, sources, and confidence'}
      </button>

      <div id="ef-advanced-section" style="display: ${isEdit ? 'block' : 'none'};">
        <p class="form-hint" style="margin-bottom: var(--space-md);">Use this section when you want to pin down date ranges, note where the information came from, or mark uncertainty.</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Year End</label>
            <input class="form-input" id="ef-year-end" type="number" min="1000" max="2030" placeholder="e.g. 1935 (blank = ongoing)" value="${e.yearEnd || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">Source</label>
            <input class="form-input" id="ef-source" type="text" placeholder="e.g. Blackpool Gazette archive" value="${escapeAttr(e.source || '')}" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Source Type</label>
            <select class="form-select" id="ef-source-type">
              <option value="user" ${e.sourceType === 'user' ? 'selected' : ''}>👤 Personal knowledge</option>
              <option value="archive" ${e.sourceType === 'archive' ? 'selected' : ''}>📚 Archive</option>
              <option value="newspaper" ${e.sourceType === 'newspaper' ? 'selected' : ''}>📰 Newspaper</option>
              <option value="oral" ${e.sourceType === 'oral' ? 'selected' : ''}>🗣️ Oral history</option>
              <option value="photo" ${e.sourceType === 'photo' ? 'selected' : ''}>📷 Photograph</option>
              <option value="map" ${e.sourceType === 'map' ? 'selected' : ''}>🗺️ Map / Plan</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Confidence</label>
            <select class="form-select" id="ef-confidence">
              <option value="verified" ${e.confidence === 'verified' ? 'selected' : ''}>✅ Verified — confirmed by multiple sources</option>
              <option value="likely" ${e.confidence === 'likely' ? 'selected' : ''} ${!e.confidence ? 'selected' : ''}>📌 Likely — reasonable but not fully confirmed</option>
              <option value="speculative" ${e.confidence === 'speculative' ? 'selected' : ''}>❓ Speculative — educated guess</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-top: var(--space-md);">
          <button class="btn btn-ghost" id="ef-toggle-cite" style="margin-bottom: var(--space-sm);">
            📚 Cite a structured source
          </button>
          <div id="ef-cite-section" style="display: none;">
            <div class="source-form-inline">
              <label class="form-label">${canCreateStructuredSources ? 'Search existing sources or create new' : 'Search existing sources'}</label>
              <input class="form-input" id="ef-source-search" type="text" placeholder="Type to search sources…" />
              <div id="ef-source-results" class="source-search-results" style="display: none;"></div>
              <div id="ef-source-selected" style="display: none; margin-top: var(--space-sm);"></div>
              ${canCreateStructuredSources ? `<details id="ef-source-new" style="margin-top: var(--space-sm);">
                <summary style="cursor:pointer; color: var(--text-muted); font-size: var(--text-sm);">+ Create new source</summary>
                <div style="margin-top: var(--space-sm);">
                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Title</label>
                      <input class="form-input" id="ef-new-source-title" type="text" placeholder="e.g. Blackpool Gazette" />
                    </div>
                    <div class="form-group">
                      <label class="form-label">URL (optional)</label>
                      <input class="form-input" id="ef-new-source-url" type="text" placeholder="https://…" />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Type</label>
                      <select class="form-select" id="ef-new-source-type">
                        <option value="web">🌐 Web</option>
                        <option value="archive">📚 Archive</option>
                        <option value="newspaper">📰 Newspaper</option>
                        <option value="book">📖 Book</option>
                        <option value="oral">🗣️ Oral history</option>
                        <option value="photo">📷 Photograph</option>
                        <option value="map">🗺️ Map / Plan</option>
                        <option value="other">📎 Other</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label class="form-label">Author (optional)</label>
                      <input class="form-input" id="ef-new-source-author" type="text" placeholder="Author name" />
                    </div>
                  </div>
                  <button class="btn btn-ghost" id="ef-create-source" style="margin-top: var(--space-sm);">Create & Link Source</button>
                </div>
              </details>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div style="display: flex; gap: var(--space-sm); justify-content: flex-end; margin-top: var(--space-xl);">
        <button class="btn btn-ghost" id="ef-cancel">Cancel</button>
        <button class="btn btn-primary" id="ef-save">${isEdit ? 'Save Changes' : (isSuggestion ? 'Submit Suggestion' : 'Add Entry')}</button>
      </div>
      <div id="ef-error" style="display:none; color: var(--danger); font-size: var(--text-sm); margin-top: var(--space-sm);"></div>
    `;

    // Wire events
    this.content.querySelector('#ef-cancel').addEventListener('click', () => this.close());
    this.content.querySelector('#ef-save').addEventListener('click', () => this.save());
    const advancedSection = this.content.querySelector('#ef-advanced-section');
    const advancedToggle = this.content.querySelector('#ef-toggle-advanced');
    advancedToggle.addEventListener('click', (evt) => {
      evt.preventDefault();
      const isOpen = advancedSection.style.display !== 'none';
      advancedSection.style.display = isOpen ? 'none' : 'block';
      advancedToggle.textContent = isOpen ? 'Add dates, sources, and confidence' : 'Hide dates, sources, and confidence';
    });

    const imagesSection = this.content.querySelector('#ef-images-section');
    const imagesToggle = this.content.querySelector('#ef-toggle-images');
    if (imagesSection && imagesToggle) {
      imagesToggle.addEventListener('click', (evt) => {
        evt.preventDefault();
        const isOpen = imagesSection.style.display !== 'none';
        imagesSection.style.display = isOpen ? 'none' : 'block';
        imagesToggle.textContent = isOpen ? 'Add photos or documents' : 'Hide photos and documents';
      });
    }

    // Image upload
    const dropZone = this.content.querySelector('#ef-drop-zone');
    const fileInput = this.content.querySelector('#ef-file-input');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        this.handleFiles(e.dataTransfer.files);
      });
      fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
    }

    // Citation source section
    const citeToggle = this.content.querySelector('#ef-toggle-cite');
    const citeSection = this.content.querySelector('#ef-cite-section');
    if (citeToggle && citeSection) {
      citeToggle.addEventListener('click', async (evt) => {
        evt.preventDefault();
        const isOpen = citeSection.style.display !== 'none';
        citeSection.style.display = isOpen ? 'none' : 'block';
        citeToggle.textContent = isOpen ? '📚 Cite a structured source' : '📚 Hide structured sources';

        if (!isOpen && this.projectSources.length === 0) {
          try {
            this.projectSources = await getProjectSources(place.projectId);
          } catch (err) {
            console.warn('Could not load project sources:', err);
          }
        }
      });

      const searchInput = this.content.querySelector('#ef-source-search');
      const resultsEl = this.content.querySelector('#ef-source-results');
      const selectedEl = this.content.querySelector('#ef-source-selected');

      if (searchInput && resultsEl) {
        searchInput.addEventListener('input', () => {
          const query = (searchInput.value || '').toLowerCase().trim();
          if (!query) {
            resultsEl.style.display = 'none';
            return;
          }
          const matches = this.projectSources.filter(s =>
            s.title.toLowerCase().includes(query) ||
            (s.author || '').toLowerCase().includes(query) ||
            (s.url || '').toLowerCase().includes(query)
          ).slice(0, 8);

          if (matches.length === 0) {
            resultsEl.innerHTML = '<div class="source-search-item" style="color: var(--text-muted);">No matching sources found.</div>';
          } else {
            resultsEl.innerHTML = matches.map(s =>
              `<div class="source-search-item" data-source-id="${escapeAttr(s.id)}">${escapeHtml(s.icon)} ${escapeHtml(s.title)}${s.author ? ` — ${escapeHtml(s.author)}` : ''}</div>`
            ).join('');
          }
          resultsEl.style.display = 'block';

          resultsEl.querySelectorAll('.source-search-item[data-source-id]').forEach(item => {
            item.addEventListener('click', () => {
              const source = this.projectSources.find(s => s.id === item.dataset.sourceId);
              if (source) {
                this.selectedSourceId = source.id;
                selectedEl.innerHTML = `<div class="source-chip"><span class="source-chip-icon">${source.icon}</span>${escapeHtml(source.title)}<span class="source-chip-unlink" id="ef-unlink-source" title="Remove">×</span></div>`;
                selectedEl.style.display = 'block';
                resultsEl.style.display = 'none';
                searchInput.value = '';

                selectedEl.querySelector('#ef-unlink-source')?.addEventListener('click', () => {
                  this.selectedSourceId = null;
                  selectedEl.style.display = 'none';
                  selectedEl.innerHTML = '';
                });
              }
            });
          });
        });
      }

      const createSourceBtn = this.content.querySelector('#ef-create-source');
      if (createSourceBtn) {
        createSourceBtn.addEventListener('click', async (evt) => {
          evt.preventDefault();
          const titleInput = this.content.querySelector('#ef-new-source-title');
          const newTitle = (titleInput?.value || '').trim();
          if (!newTitle) {
            titleInput.style.borderColor = 'var(--danger)';
            return;
          }
          createSourceBtn.disabled = true;
          createSourceBtn.textContent = 'Creating…';
          try {
            const newSource = await createSource({
              projectId: place.projectId,
              title: newTitle,
              url: this.content.querySelector('#ef-new-source-url')?.value || '',
              sourceType: this.content.querySelector('#ef-new-source-type')?.value || 'web',
              author: this.content.querySelector('#ef-new-source-author')?.value || ''
            });
            this.projectSources.push(newSource);
            this.selectedSourceId = newSource.id;
            selectedEl.innerHTML = `<div class="source-chip"><span class="source-chip-icon">${newSource.icon}</span>${escapeHtml(newSource.title)}<span class="source-chip-unlink" id="ef-unlink-source" title="Remove">×</span></div>`;
            selectedEl.style.display = 'block';
            this.content.querySelector('#ef-source-new').removeAttribute('open');

            selectedEl.querySelector('#ef-unlink-source')?.addEventListener('click', () => {
              this.selectedSourceId = null;
              selectedEl.style.display = 'none';
              selectedEl.innerHTML = '';
            });
          } catch (err) {
            console.error('Failed to create source:', err);
          } finally {
            createSourceBtn.disabled = false;
            createSourceBtn.textContent = 'Create & Link Source';
          }
        });
      }
    }

    this.modal.style.display = 'flex';
  }

  async handleFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const preview = URL.createObjectURL(file);
      this.pendingImages.push({ file, preview });
      this.renderPreviews();
    }
  }

  renderPreviews() {
    const grid = this.content.querySelector('#ef-preview-grid');
    grid.innerHTML = this.pendingImages.map((img, i) => `
      <div class="image-preview-item">
        <img src="${escapeAttr(img.preview)}" alt="Upload preview" />
        <button class="remove-btn" data-index="${i}">×</button>
      </div>
    `).join('');

    grid.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        URL.revokeObjectURL(this.pendingImages[idx].preview);
        this.pendingImages.splice(idx, 1);
        this.renderPreviews();
      });
    });
  }

  async save() {
    const saveBtn = this.content.querySelector('#ef-save');
    const errEl = this.content.querySelector('#ef-error');
    if (errEl) {
      errEl.style.display = 'none';
      errEl.textContent = '';
    }

    const yearStartRaw = this.content.querySelector('#ef-year-start').value;
    const parsedStart = yearStartRaw ? parseInt(yearStartRaw) : NaN;
    const yearStart = Number.isFinite(parsedStart) ? parsedStart : new Date().getFullYear();
    const yearEnd = this.content.querySelector('#ef-year-end').value
      ? parseInt(this.content.querySelector('#ef-year-end').value) : null;
    const manualTitle = this.content.querySelector('#ef-title').value.trim();
    const summary = this.content.querySelector('#ef-summary').value.trim();
    const source = this.content.querySelector('#ef-source').value.trim();
    const sourceType = this.content.querySelector('#ef-source-type').value;
    const confidence = this.content.querySelector('#ef-confidence').value;
    const title = manualTitle || deriveTitle(summary, this.place.name);

    if (!summary && this.pendingImages.length === 0 && !manualTitle) {
      this.content.querySelector('#ef-summary').style.borderColor = 'var(--danger)';
      return;
    }

    // Convert pending image files to blobs
    const imageBlobs = [];
    for (const img of this.isSuggestionMode ? [] : this.pendingImages) {
      imageBlobs.push({
        blob: img.file,
        caption: '',
        yearTaken: yearStart,
        credit: ''
      });
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = this.editingEntry ? 'Saving...' : (this.isSuggestionMode ? 'Submitting...' : 'Adding...');
    }

    try {
      await this.onSave?.({
        entryId: this.editingEntry?.id || null,
        placeId: this.place.id,
        yearStart,
        yearEnd,
        title,
        summary,
        source,
        sourceType,
        confidence,
        images: imageBlobs,
        linkedSourceId: this.selectedSourceId || null
      });
      this.close();
    } catch (err) {
      console.error('Failed to save entry:', err);
      if (errEl) {
        errEl.textContent = formatEntryError(err);
        errEl.style.display = 'block';
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = this.editingEntry ? 'Save Changes' : (this.isSuggestionMode ? 'Submit Suggestion' : 'Add Entry');
      }
    }
  }

  close() {
    this.modal.style.display = 'none';
    this.pendingImages.forEach(img => URL.revokeObjectURL(img.preview));
    this.pendingImages = [];
    this.isSuggestionMode = false;
    this.onCancel?.();
  }
}

function deriveTitle(summary, placeName) {
  if (!summary) return `Update for ${placeName}`;
  const compact = summary.replace(/\s+/g, ' ').trim();
  if (!compact) return `Update for ${placeName}`;
  return compact.length > 64 ? `${compact.slice(0, 64).trim()}...` : compact;
}

function formatEntryError(err) {
  const msg = err?.message || '';
  if (/upload|storage|bucket|image/i.test(msg)) {
    return `Image upload failed: ${msg || 'please check your connection/permissions and try again.'}`;
  }
  if (/row-level security|permission denied|not allowed|42501/i.test(msg)) {
    return 'You do not have permission to save this entry in this project.';
  }
  return msg || 'Could not save this entry. Please try again.';
}
