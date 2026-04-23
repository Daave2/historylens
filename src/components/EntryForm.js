import { escapeAttr, escapeHtml } from '../utils/sanitize.js';

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

    this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  show(place, existingEntry = null, options = {}) {
    this.place = place;
    this.editingEntry = existingEntry;
    this.pendingImages = [];

    const e = existingEntry || {};
    const isEdit = !!existingEntry;
    const isSuggestion = !isEdit && !!options.suggestionMode;
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
    imagesToggle.addEventListener('click', (evt) => {
      evt.preventDefault();
      const isOpen = imagesSection.style.display !== 'none';
      imagesSection.style.display = isOpen ? 'none' : 'block';
      imagesToggle.textContent = isOpen ? 'Add photos or documents' : 'Hide photos and documents';
    });

    // Image upload
    const dropZone = this.content.querySelector('#ef-drop-zone');
    const fileInput = this.content.querySelector('#ef-file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

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
    for (const img of this.pendingImages) {
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
        images: imageBlobs
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
