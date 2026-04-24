import { requestAccess, getProjectRoles, updateRole, removeRole, updateProject, banUser, wipeUserContributions, deleteProject, getModerationSubmissions, reviewModerationSubmission, getProfiles } from '../data/store.js';
import { escapeAttr, escapeHtml } from '../utils/sanitize.js';

export default class ProjectSettings {
    constructor() {
        this.createDom();
    }

    createDom() {
        this.modal = document.createElement('div');
        this.modal.className = 'modal-overlay';
        this.modal.id = 'project-settings-modal';
        this.modal.style.display = 'none';

        this.modal.innerHTML = `
      <div class="modal glass-panel" style="max-width: 600px; width: 90%; padding: 0;">
        <div class="modal-header" style="padding: var(--space-md) var(--space-xl); border-bottom: 1px solid var(--glass-border);">
          <h2 id="ps-modal-title">Project Settings</h2>
          <button class="icon-btn modal-close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body" id="ps-modal-body" style="padding: 0;">
          <!-- Content injected here -->
        </div>
      </div>
    `;

        document.body.appendChild(this.modal);

        this.modal.querySelector('.modal-close').addEventListener('click', () => this.hide());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hide();
        });
    }

    hide() {
        this.modal.style.display = 'none';
    }

    notifyInboxChanged() {
        try {
            this.handlers?.onInboxChanged?.();
        } catch (err) {
            console.warn('Could not notify inbox counter update:', err);
        }
    }

    showInlineFeedback(container, message, type = 'error') {
        if (!container) return;
        let feedback = container.querySelector('.ps-inline-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'ps-inline-feedback';
            feedback.setAttribute('aria-live', 'polite');
            feedback.style.marginBottom = 'var(--space-md)';
            feedback.style.padding = 'var(--space-sm) var(--space-md)';
            feedback.style.border = '1px solid';
            feedback.style.borderRadius = 'var(--radius-sm)';
            feedback.style.fontSize = 'var(--text-sm)';
            container.prepend(feedback);
        }

        const isError = type === 'error';
        feedback.textContent = message;
        feedback.style.color = isError ? 'var(--danger)' : 'var(--success)';
        feedback.style.background = isError ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.12)';
        feedback.style.borderColor = isError ? 'rgba(248,113,113,0.35)' : 'rgba(74,222,128,0.35)';
        feedback.style.display = 'block';

        clearTimeout(this.inlineFeedbackTimeout);
        this.inlineFeedbackTimeout = setTimeout(() => {
            if (feedback?.parentElement) {
                feedback.remove();
            }
        }, 5000);
    }

    async confirmAction(message, confirmLabel = 'Confirm') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            overlay.style.zIndex = '3500';
            overlay.innerHTML = `
              <div class="modal glass-panel" style="max-width: 440px;">
                <h3 style="margin-bottom: var(--space-sm);">Please confirm</h3>
                <p style="color: var(--text-secondary); margin-bottom: var(--space-lg);">${escapeHtml(message)}</p>
                <div style="display:flex; justify-content:flex-end; gap: var(--space-sm);">
                  <button class="btn btn-ghost" id="ps-confirm-cancel">Cancel</button>
                  <button class="btn btn-danger" id="ps-confirm-ok">${escapeHtml(confirmLabel)}</button>
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
            overlay.querySelector('#ps-confirm-cancel')?.addEventListener('click', () => cleanup(false));
            overlay.querySelector('#ps-confirm-ok')?.addEventListener('click', () => cleanup(true));
            document.body.appendChild(overlay);
        });
    }

    async promptNote({ title = 'Optional Note', message = 'Add context (optional):', placeholder = 'Write a note…', confirmLabel = 'Continue' } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            overlay.style.zIndex = '3500';
            overlay.innerHTML = `
              <div class="modal glass-panel" style="max-width: 520px;">
                <h3 style="margin-bottom: var(--space-sm);">${escapeHtml(title)}</h3>
                <p style="color: var(--text-secondary); margin-bottom: var(--space-md);">${escapeHtml(message)}</p>
                <textarea id="ps-note-input" class="form-textarea" rows="4" placeholder="${escapeAttr(placeholder)}"></textarea>
                <div style="display:flex; justify-content:flex-end; gap: var(--space-sm); margin-top: var(--space-md);">
                  <button class="btn btn-ghost" id="ps-note-skip">Skip</button>
                  <button class="btn btn-primary" id="ps-note-save">${escapeHtml(confirmLabel)}</button>
                </div>
              </div>
            `;

            const cleanup = (value) => {
                overlay.remove();
                resolve((value || '').trim());
            };

            overlay.addEventListener('click', (evt) => {
                if (evt.target === overlay) cleanup('');
            });
            overlay.querySelector('#ps-note-skip')?.addEventListener('click', () => cleanup(''));
            overlay.querySelector('#ps-note-save')?.addEventListener('click', () => {
                cleanup(overlay.querySelector('#ps-note-input')?.value || '');
            });
            document.body.appendChild(overlay);
            overlay.querySelector('#ps-note-input')?.focus();
        });
    }

    // --- Mode 1: Viewer requesting access (inherited from old CollaboratorsModal) ---
    showRequestAccess(projectId, onSuccess) {
        const titleEl = this.modal.querySelector('#ps-modal-title');
        const bodyEl = this.modal.querySelector('#ps-modal-body');

        titleEl.textContent = 'Request Edit Access';

        bodyEl.innerHTML = `
      <div style="padding: var(--space-xl);">
        <p style="color: var(--text-secondary); margin-bottom: var(--space-xl);">
          You are currently viewing this project in read-only mode. Would you like to request edit access from the project owner?
        </p>
        <div style="display: flex; gap: var(--space-md); justify-content: flex-end;">
          <button class="btn btn-ghost" id="ps-cancel-btn">Cancel</button>
          <button class="btn btn-primary" id="ps-request-btn">Request Access</button>
        </div>
      </div>
    `;

        bodyEl.querySelector('#ps-cancel-btn').addEventListener('click', () => this.hide());

        const requestBtn = bodyEl.querySelector('#ps-request-btn');
        requestBtn.addEventListener('click', async () => {
            requestBtn.disabled = true;
            requestBtn.textContent = 'Requesting...';
            try {
                const result = await requestAccess(projectId);
                this.hide();
                if (onSuccess) onSuccess(result);
            } catch (err) {
                console.error(err);
                this.showInlineFeedback(bodyEl, `Failed to request access: ${err?.message || 'Unknown error'}`);
                requestBtn.disabled = false;
                requestBtn.textContent = 'Request Access';
            }
        });

        this.modal.style.display = 'flex';
    }

    // --- Mode 2: Owner/Admin Settings Dashboard ---
    async showManage(project, currentUserRole, handlers) {
        this.project = project;
        this.currentUserRole = currentUserRole; // 'owner' or 'admin'
        this.handlers = handlers; // Need updateProject, mapCentre callbacks

        const titleEl = this.modal.querySelector('#ps-modal-title');
        const bodyEl = this.modal.querySelector('#ps-modal-body');

        titleEl.textContent = 'Manage Map';

        bodyEl.innerHTML = `
      <div class="ps-layout">
        <!-- Sidebar Navigation -->
        <div class="ps-nav">
          <ul id="ps-tabs" class="ps-tabs">
            <li class="ps-tab active" data-tab="general">Project</li>
            <li class="ps-tab" data-tab="collab">Access</li>
            ${this.currentUserRole === 'owner' || this.currentUserRole === 'admin' ? `<li class="ps-tab" data-tab="mod">Review</li>` : ''}
            ${this.currentUserRole === 'owner' ? `<li class="ps-tab" data-tab="danger" style="color: var(--danger);">Danger Zone</li>` : ''}
          </ul>
        </div>
        
        <!-- Tab Content Area -->
        <div id="ps-tab-content" class="ps-tab-content">
          <div style="text-align:center; color: var(--text-muted);">Loading...</div>
        </div>
      </div>
    `;

        const applyActiveTabStyle = (tab, active) => {
            const compactTabs = window.matchMedia('(max-width: 768px)').matches;
            tab.style.background = active ? 'var(--bg-surface)' : 'transparent';
            tab.style.borderLeft = compactTabs ? 'none' : (active ? '3px solid var(--accent)' : '3px solid transparent');
            tab.style.borderBottom = compactTabs ? (active ? '2px solid var(--accent)' : '2px solid transparent') : 'none';
        };

        // Add basic hover/active styling dynamically.
        const tabs = bodyEl.querySelectorAll('.ps-tab');
        tabs.forEach(tab => {
            tab.addEventListener('mouseover', () => { if (!tab.classList.contains('active')) tab.style.background = 'var(--bg-hover)'; });
            tab.addEventListener('mouseout', () => { if (!tab.classList.contains('active')) tab.style.background = 'transparent'; });
            tab.addEventListener('click', () => {
                tabs.forEach(t => {
                    t.classList.remove('active');
                    applyActiveTabStyle(t, false);
                });
                tab.classList.add('active');
                applyActiveTabStyle(tab, true);
                this.switchTab(tab.dataset.tab);
            });
        });

        // Default to first tab
        tabs[0].click();
        this.modal.style.display = 'flex';
    }

    async switchTab(tabName) {
        const contentEl = this.modal.querySelector('#ps-tab-content');
        contentEl.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-muted);">Loading...</div>`;

        if (tabName === 'general') {
            this.renderGeneralTab(contentEl);
        } else if (tabName === 'collab') {
            await this.renderManageList(contentEl);
        } else if (tabName === 'mod') {
            await this.renderModerationTab(contentEl);
        } else if (tabName === 'danger') {
            this.renderDangerTab(contentEl);
        }
    }

    renderGeneralTab(container) {
        container.innerHTML = `
      <div class="ps-pane-header">
        <h3>Project Details</h3>
        <p>Update the name, short summary, privacy, and opening map view.</p>
      </div>
      
      <div class="form-group">
        <label class="form-label">Project Name</label>
        <input type="text" id="set-proj-name" class="form-input" value="${escapeAttr(this.project.name || '')}" />
      </div>

      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea id="set-proj-desc" class="form-textarea" rows="3">${escapeHtml(this.project.description || '')}</textarea>
      </div>

      <div class="form-group" style="display: flex; align-items: center; gap: var(--space-sm); margin-top: var(--space-xl);">
        <input type="checkbox" id="set-proj-public" ${this.project.isPublic !== false ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--accent);" />
        <label for="set-proj-public" style="font-weight: 500; cursor: pointer;">Public Project</label>
      </div>
      <p style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: var(--space-xl); margin-left: 24px;">
        Public projects can be viewed by anyone, but only explicitly invited collaborators can edit them.
      </p>

      <div style="border-top: 1px solid var(--glass-border); padding-top: var(--space-lg); margin-top: var(--space-lg);">
          <h4 style="margin-bottom: var(--space-sm);">Map View</h4>
          <p style="font-size: var(--text-xs); color: var(--text-muted); margin-bottom: var(--space-md);">
              Set the default area users see when opening this project.
          </p>
          <button id="set-proj-centre" class="btn btn-ghost" style="width: 100%; justify-content: center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
            Set Default Map Centre to Current View
          </button>
      </div>

      <div style="margin-top: var(--space-xl); display: flex; justify-content: flex-end;">
        <button id="set-proj-save" class="btn btn-primary">Save Changes</button>
      </div>
    `;

        container.querySelector('#set-proj-save').addEventListener('click', async (e) => {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = 'Saving...';
            try {
                await this.handlers.onSaveProjectInfo({
                    name: container.querySelector('#set-proj-name').value,
                    description: container.querySelector('#set-proj-desc').value,
                    isPublic: container.querySelector('#set-proj-public').checked
                });
                btn.textContent = 'Saved!';
                setTimeout(() => { btn.disabled = false; btn.textContent = 'Save Changes'; }, 2000);
            } catch (err) {
                console.error(err);
                this.showInlineFeedback(container, `Error saving project: ${err?.message || 'Unknown error'}`);
                btn.disabled = false;
                btn.textContent = 'Save Changes';
            }
        });

        container.querySelector('#set-proj-centre').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const originalText = btn.innerHTML;
            btn.innerHTML = 'Updating...';
            try {
                await this.handlers.onSetCentre();
                btn.innerHTML = '<span style="color:var(--success)">Centre Updated!</span>';
                setTimeout(() => { btn.innerHTML = originalText; }, 2000);
            } catch (err) {
                console.error(err);
                this.showInlineFeedback(container, 'Failed to update map centre');
                btn.innerHTML = originalText;
            }
        });
    }

    async renderManageList(container) {
        try {
            const roles = await getProjectRoles(this.project.id);
            const pendingRoles = roles.filter(r => r.role === 'pending');
            const activeRoles = roles.filter(r => r.role !== 'pending' && r.role !== 'banned');

            const renderPerson = (r) => {
                const authorDisplay = r.email.display_name || (r.email.email ? r.email.email.split('@')[0] : 'Unknown');
                const seed = r.email.display_name || r.email.email || 'user';
                const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1f2937&textColor=f3f4f6`;
                return { authorDisplay, avatarUrl };
            };

            let html = `
              <div class="ps-pane-header">
                <h3>Access</h3>
                <p>Approve requests, choose who can edit, and remove access when needed.</p>
              </div>
            `;

            html += `
              <section class="ps-section">
                <div class="ps-section-heading">
                  <h4>Pending Access Requests</h4>
                  <p>People waiting to help edit this map.</p>
                </div>
            `;

            if (pendingRoles.length === 0) {
                html += `<div class="ps-empty">No access requests are waiting right now.</div>`;
            } else {
                html += pendingRoles.map((r) => {
                    const { authorDisplay, avatarUrl } = renderPerson(r);
                    return `
                      <div class="ps-row">
                        <div class="ps-row-person">
                          <img src="${escapeAttr(avatarUrl)}" alt="Avatar" class="ps-avatar">
                          <div>
                            <div class="ps-row-title">${escapeHtml(authorDisplay)}</div>
                            <div class="ps-row-meta">Waiting for approval</div>
                          </div>
                        </div>
                        <div class="ps-row-actions">
                          <button class="btn btn-sm btn-primary collab-approve" data-id="${escapeAttr(r.id)}">Approve</button>
                          <button class="btn btn-sm btn-danger collab-reject" data-id="${escapeAttr(r.id)}">Reject</button>
                        </div>
                      </div>
                    `;
                }).join('');
            }
            html += `</section>`;

            html += `
              <section class="ps-section">
                <div class="ps-section-heading">
                  <h4>People With Access</h4>
                  <p>Editors and admins who can already work on the map.</p>
                </div>
            `;

            if (activeRoles.length === 0) {
                html += `<div class="ps-empty">No one has been granted access yet.</div>`;
            } else {
                html += activeRoles.map((r) => {
                    const { authorDisplay, avatarUrl } = renderPerson(r);
                    let actions = '';
                    if (r.role === 'owner') {
                        actions = `<span class="badge">Owner</span>`;
                    } else {
                        actions = `
                          <select class="collab-role-select" data-id="${escapeAttr(r.id)}">
                            <option value="editor" ${r.role === 'editor' ? 'selected' : ''}>Editor</option>
                            <option value="admin" ${r.role === 'admin' ? 'selected' : ''}>Admin</option>
                          </select>
                          <button class="icon-btn btn-danger collab-remove" data-id="${escapeAttr(r.id)}" title="Remove access">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        `;
                    }

                    return `
                      <div class="ps-row">
                        <div class="ps-row-person">
                          <img src="${escapeAttr(avatarUrl)}" alt="Avatar" class="ps-avatar">
                          <div>
                            <div class="ps-row-title">${escapeHtml(authorDisplay)}</div>
                            <div class="ps-row-meta">${escapeHtml(r.role)}</div>
                          </div>
                        </div>
                        <div class="ps-row-actions">
                          ${actions}
                        </div>
                      </div>
                    `;
                }).join('');
            }
            html += `</section>`;

            container.innerHTML = html;
            this.notifyInboxChanged();

            // Wire up buttons
            container.querySelectorAll('.collab-approve').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    await updateRole(btn.dataset.id, 'editor');
                    this.notifyInboxChanged();
                    this.renderManageList(container);
                });
            });

            container.querySelectorAll('.collab-reject, .collab-remove').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const confirmed = await this.confirmAction('Remove this user?', 'Remove');
                    if (!confirmed) return;
                    btn.disabled = true;
                    await removeRole(btn.dataset.id);
                    this.notifyInboxChanged();
                    this.renderManageList(container);
                });
            });

            container.querySelectorAll('.collab-role-select').forEach(sel => {
                sel.addEventListener('change', async (e) => {
                    sel.disabled = true;
                    await updateRole(sel.dataset.id, e.target.value);
                    this.notifyInboxChanged();
                    this.renderManageList(container);
                });
            });

        } catch (err) {
            console.error(err);
            container.innerHTML = `<div style="color: var(--danger);">${escapeHtml(err?.message || 'Failed to load collaborators')}</div>`;
        }
    }

    async renderModerationTab(container) {
        try {
            const [roles, submissions] = await Promise.all([
                getProjectRoles(this.project.id),
                getModerationSubmissions(this.project.id, { limit: 120 })
            ]);
            const bannedRoles = roles.filter(r => r.role === 'banned');
            const bannableRoles = roles.filter(r => r.role !== 'owner' && r.role !== 'banned');
            const pendingSubs = submissions.filter(s => s.status === 'pending');
            const recentReviewed = submissions.filter(s => s.status !== 'pending').slice(0, 10);
            const submitterIds = [...new Set(submissions.map(s => s.submitterId).filter(Boolean))];
            const submitterMap = await getProfiles(submitterIds);

            const displaySubmitter = (userId) => {
                const profile = submitterMap[userId];
                if (!profile) return 'Unknown user';
                return profile.display_name || (profile.email ? profile.email.split('@')[0] : 'Unknown user');
            };

            const formatSubmissionType = (type) => {
                if (type === 'place_create') return 'New Place';
                if (type === 'entry_create') return 'Timeline Entry';
                if (type === 'place_move') return 'Location Correction';
                if (type === 'place_name_alias') return 'Historical Name';
                return type;
            };

            const formatSubmissionSummary = (submission) => {
                const payload = submission.payload || {};
                if (submission.submissionType === 'place_create') {
                    const name = payload.name || 'Unnamed place';
                    return `${name} at ${Number(payload.lat).toFixed(5)}, ${Number(payload.lng).toFixed(5)}`;
                }
                if (submission.submissionType === 'entry_create') {
                    const title = payload.title || 'Untitled';
                    const year = payload.yearStart ? ` (${payload.yearStart})` : '';
                    return `${title}${year}`;
                }
                if (submission.submissionType === 'place_move') {
                    const fromLat = Number(payload.fromLat);
                    const fromLng = Number(payload.fromLng);
                    const toLat = Number(payload.lat);
                    const toLng = Number(payload.lng);
                    const base = `${toLat.toFixed(5)}, ${toLng.toFixed(5)}`;
                    if (Number.isFinite(fromLat) && Number.isFinite(fromLng) && Number.isFinite(toLat) && Number.isFinite(toLng)) {
                        const delta = haversineDistanceMeters(fromLat, fromLng, toLat, toLng);
                        return `Move to ${base} (${delta.toFixed(0)}m from current)`;
                    }
                    return `Move to ${base}`;
                }
                if (submission.submissionType === 'place_name_alias') {
                    const alias = payload.alias || 'Unnamed alias';
                    const start = payload.startYear ? `from ${payload.startYear}` : '';
                    const end = payload.endYear ? `until ${payload.endYear}` : '';
                    const when = [start, end].filter(Boolean).join(' ');
                    return when ? `${alias} (${when})` : alias;
                }
                return JSON.stringify(payload);
            };

            let html = `
              <div class="ps-pane-header">
                <h3>Review</h3>
                <p>Approve community suggestions and handle restricted users in one place.</p>
              </div>
            `;

            html += `
        <section class="ps-section">
          <div class="ps-section-heading">
            <h4>Pending Suggestions</h4>
            <p>Review and publish community submissions.</p>
          </div>
      `;

            if (pendingSubs.length === 0) {
                html += `<div class="ps-empty">No suggestions are waiting for review.</div>`;
            } else {
                pendingSubs.forEach(sub => {
                    html += `
            <div class="ps-card">
              <div style="display:flex; justify-content:space-between; gap: var(--space-sm); align-items:flex-start;">
                <div>
                  <div style="font-size: var(--text-xs); color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em;">${escapeHtml(formatSubmissionType(sub.submissionType))}</div>
                  <div style="font-size: var(--text-sm); color: var(--text-primary); margin-top: 2px;">${escapeHtml(formatSubmissionSummary(sub))}</div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                    by ${escapeHtml(displaySubmitter(sub.submitterId))} · ${new Date(sub.createdAt).toLocaleString()}
                  </div>
                </div>
                <div style="display:flex; gap: var(--space-xs);">
                  <button class="btn btn-sm btn-primary mod-sub-approve" data-id="${escapeAttr(sub.id)}">Approve</button>
                  <button class="btn btn-sm btn-danger mod-sub-reject" data-id="${escapeAttr(sub.id)}">Reject</button>
                </div>
              </div>
            </div>
          `;
                });
            }
            html += `</section>`;

            html += `
        <section class="ps-section">
          <div class="ps-section-heading">
            <h4>Recent Decisions</h4>
            <p>A quick look at the latest approvals and rejections.</p>
          </div>
      `;
            if (recentReviewed.length === 0) {
                html += `<div style="color: var(--text-muted); font-size: var(--text-xs);">No reviewed submissions yet.</div>`;
            } else {
                html += `<ul style="list-style:none; padding:0; margin:0;">`;
                recentReviewed.forEach(sub => {
                    html += `
            <li style="padding: 6px 0; border-bottom: 1px solid var(--bg-hover); font-size: 12px; color: var(--text-secondary);">
              <strong style="color:${sub.status === 'approved' ? 'var(--success)' : 'var(--danger)'};">${escapeHtml(sub.status.toUpperCase())}</strong>
              · ${escapeHtml(formatSubmissionType(sub.submissionType))}
              · ${escapeHtml(displaySubmitter(sub.submitterId))}
            </li>
          `;
                });
                html += `</ul>`;
            }
            html += `</section>`;

            html += `
        <section class="ps-section">
          <div class="ps-section-heading">
            <h4>Restricted Users</h4>
            <p>Ban active collaborators when needed, or restore access for blocked users.</p>
          </div>
          <div style="margin-bottom: var(--space-lg);">
            <h5 style="font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--space-sm);">Ban an active collaborator</h5>
          <div style="display: flex; gap: var(--space-sm);">
            <select id="mod-ban-select" class="form-select" style="flex: 1;">
              <option value="">Select a user...</option>
              ${bannableRoles.map(r => {
                const name = r.email.display_name || (r.email.email ? r.email.email.split('@')[0] : 'Unknown');
                return `<option value="${escapeAttr(r.user_id)}">${escapeHtml(name)} (${escapeHtml(r.role)})</option>`;
            }).join('')}
            </select>
            <button id="mod-ban-btn" class="btn btn-danger">Ban</button>
          </div>
          </div>
      `;

            html += `<h5 style="font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: var(--space-sm);">Banned Users</h5>`;
            html += `<ul style="list-style: none; padding: 0; margin: 0;">`;

            if (bannedRoles.length === 0) {
                html += `<li style="color: var(--text-muted); text-align: center; padding: var(--space-sm) 0;">No banned users.</li>`;
            }

            bannedRoles.forEach(r => {
                const authorDisplay = r.email.display_name || (r.email.email ? r.email.email.split('@')[0] : 'Unknown');
                html += `
          <li style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-sm) 0; border-bottom: 1px solid var(--bg-hover);">
            <div style="font-weight: 500; color: var(--text-primary);">${escapeHtml(authorDisplay)}</div>
            <div style="display: flex; gap: var(--space-sm); align-items: center;">
              <button class="btn btn-sm btn-ghost mod-unban" data-id="${escapeAttr(r.id)}">Unban</button>
              <button class="btn btn-sm btn-danger mod-wipe" data-userid="${escapeAttr(r.user_id)}" title="Permanently delete all their comments and map entries">Wipe Contributions</button>
            </div>
          </li>
                `;
            });
            html += `</ul>`;
            html += `</section>`;

            container.innerHTML = html;
            this.notifyInboxChanged();

            container.querySelectorAll('.mod-sub-approve').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const note = await this.promptNote({
                        title: 'Approve Submission',
                        message: 'Optional approval note for the contributor:',
                        placeholder: 'Add an optional note…',
                        confirmLabel: 'Approve'
                    });
                    btn.disabled = true;
                    try {
                        await reviewModerationSubmission(btn.dataset.id, { decision: 'approved', note });
                        if (this.handlers.onRefreshRequired) this.handlers.onRefreshRequired();
                        this.notifyInboxChanged();
                        this.renderModerationTab(container);
                    } catch (err) {
                        console.error(err);
                        this.showInlineFeedback(container, 'Failed to approve submission: ' + (err?.message || 'Unknown error'));
                        btn.disabled = false;
                    }
                });
            });

            container.querySelectorAll('.mod-sub-reject').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const note = await this.promptNote({
                        title: 'Reject Submission',
                        message: 'Rejection reason shown to the contributor:',
                        placeholder: 'Explain why this was rejected…',
                        confirmLabel: 'Reject'
                    });
                    btn.disabled = true;
                    try {
                        await reviewModerationSubmission(btn.dataset.id, { decision: 'rejected', note });
                        this.notifyInboxChanged();
                        this.renderModerationTab(container);
                    } catch (err) {
                        console.error(err);
                        this.showInlineFeedback(container, 'Failed to reject submission: ' + (err?.message || 'Unknown error'));
                        btn.disabled = false;
                    }
                });
            });

            // Ban button
            container.querySelector('#mod-ban-btn')?.addEventListener('click', async (e) => {
                const select = container.querySelector('#mod-ban-select');
                if (!select || !select.value) return;
                const confirmed = await this.confirmAction(
                    'Ban this user? They will not be able to interact with the project.',
                    'Ban User'
                );
                if (!confirmed) return;
                e.target.disabled = true;
                await banUser(this.project.id, select.value);
                this.notifyInboxChanged();
                this.renderModerationTab(container);
            });

            // Unban
            container.querySelectorAll('.mod-unban').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    await removeRole(btn.dataset.id);
                    this.notifyInboxChanged();
                    this.renderModerationTab(container);
                });
            });

            // Wipe
            container.querySelectorAll('.mod-wipe').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const confirmed = await this.confirmAction(
                        'WARNING: This will permanently delete every time entry and comment this user created on this project. This cannot be undone.',
                        'Wipe Contributions'
                    );
                    if (!confirmed) return;
                    btn.disabled = true;
                    btn.textContent = 'Wiping...';
                    try {
                        await wipeUserContributions(this.project.id, btn.dataset.userid);
                        btn.textContent = 'Wiped!';
                        if (this.handlers.onRefreshRequired) this.handlers.onRefreshRequired();
                    } catch (err) {
                        console.error(err);
                        this.showInlineFeedback(container, `Failed to wipe: ${err?.message || 'Unknown error'}`);
                        btn.disabled = false;
                        btn.textContent = 'Wipe Contributions';
                    }
                });
            });

        } catch (err) {
            console.error(err);
            container.innerHTML = `<div style="color: var(--danger);">${escapeHtml(err?.message || 'Failed to load moderation controls')}</div>`;
        }
    }

    renderDangerTab(container) {
        container.innerHTML = `
      <div class="ps-pane-header">
        <h3 style="color: var(--danger);">Danger Zone</h3>
        <p>Permanent actions live here. Double-check before continuing.</p>
      </div>
      
      <div style="border: 1px solid var(--danger); border-radius: var(--radius-md); padding: var(--space-lg); background: rgba(239, 68, 68, 0.05);">
        <h4 style="margin-bottom: var(--space-sm);">Delete Project</h4>
        <p style="color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: var(--space-lg);">
          This will permanently delete the project, along with all associated places, timeline entries, images, and user comments. 
          <strong>This action cannot be undone.</strong>
        </p>
        
        <div class="form-group">
          <label class="form-label" style="font-size: var(--text-xs);">Please type <strong>${escapeHtml(this.project.name)}</strong> to confirm:</label>
          <input type="text" id="danger-confirm-name" class="form-input" style="border-color: var(--danger);" autocomplete="off" />
        </div>

        <button id="danger-delete-btn" class="btn btn-danger" disabled style="width: 100%; justify-content: center; margin-top: var(--space-md);">
          I understand the consequences, delete this project
        </button>
      </div>
    `;

        const confirmInput = container.querySelector('#danger-confirm-name');
        const deleteBtn = container.querySelector('#danger-delete-btn');

        confirmInput.addEventListener('input', () => {
            deleteBtn.disabled = confirmInput.value !== this.project.name;
        });

        deleteBtn.addEventListener('click', async () => {
            if (confirmInput.value === this.project.name) {
                deleteBtn.disabled = true;
                deleteBtn.textContent = 'Deleting...';
                try {
                    await deleteProject(this.project.id);
                    // Redirect user to home or dashboard after deletion
                    window.location.href = import.meta.env.BASE_URL || '/';
                } catch (err) {
                    console.error(err);
                    this.showInlineFeedback(container, `Failed to delete project: ${err?.message || 'Unknown error'}`);
                    deleteBtn.disabled = false;
                    deleteBtn.textContent = 'Delete Project';
                }
            }
        });
    }
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
}
