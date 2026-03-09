import { requestAccess, getProjectRoles, updateRole, removeRole, updateProject, banUser, wipeUserContributions, deleteProject } from '../data/store.js';
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
                await requestAccess(projectId);
                this.hide();
                if (onSuccess) onSuccess();
            } catch (err) {
                console.error(err);
                alert('Failed to request access: ' + err.message);
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

        titleEl.textContent = 'Project Settings';

        bodyEl.innerHTML = `
      <div style="display: flex; min-height: 400px; max-height: 70vh;">
        <!-- Sidebar Navigation -->
        <div style="width: 180px; border-right: 1px solid var(--glass-border); padding: var(--space-md) 0; background: rgba(0,0,0,0.2);">
          <ul id="ps-tabs" style="list-style: none; padding: 0; margin: 0;">
            <li class="ps-tab active" data-tab="general" style="padding: var(--space-sm) var(--space-md); cursor: pointer; transition: background 0.15s; font-weight: 500;">General</li>
            <li class="ps-tab" data-tab="collab" style="padding: var(--space-sm) var(--space-md); cursor: pointer; transition: background 0.15s; font-weight: 500;">Collaborators</li>
            ${this.currentUserRole === 'owner' || this.currentUserRole === 'admin' ? `<li class="ps-tab" data-tab="mod" style="padding: var(--space-sm) var(--space-md); cursor: pointer; transition: background 0.15s; font-weight: 500;">Moderation</li>` : ''}
            ${this.currentUserRole === 'owner' ? `<li class="ps-tab" data-tab="danger" style="padding: var(--space-sm) var(--space-md); cursor: pointer; transition: background 0.15s; color: var(--danger); font-weight: 500;">Danger Zone</li>` : ''}
          </ul>
        </div>
        
        <!-- Tab Content Area -->
        <div id="ps-tab-content" style="flex: 1; padding: var(--space-xl); overflow-y: auto;">
          <div style="text-align:center; color: var(--text-muted);">Loading...</div>
        </div>
      </div>
    `;

        // Add basic hover/active styling dynamically to avoiding adding CSS class right now
        const tabs = bodyEl.querySelectorAll('.ps-tab');
        tabs.forEach(tab => {
            tab.addEventListener('mouseover', () => { if (!tab.classList.contains('active')) tab.style.background = 'var(--bg-hover)'; });
            tab.addEventListener('mouseout', () => { if (!tab.classList.contains('active')) tab.style.background = 'transparent'; });
            tab.addEventListener('click', () => {
                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.style.background = 'transparent';
                    t.style.borderLeft = 'none';
                });
                tab.classList.add('active');
                tab.style.background = 'var(--bg-surface)';
                tab.style.borderLeft = '3px solid var(--accent)';
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
      <h3 style="margin-bottom: var(--space-lg);">General Settings</h3>
      
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
                alert('Error saving project: ' + err.message);
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
                alert('Failed to update map centre');
                btn.innerHTML = originalText;
            }
        });
    }

    async renderManageList(container) {
        try {
            const roles = await getProjectRoles(this.project.id);
            // Filter out banned users for the regular collab tab
            const visibleRoles = roles.filter(r => r.role !== 'banned');

            let html = `<h3 style="margin-bottom: var(--space-lg);">Collaborators</h3>`;
            html += `<ul class="collab-list" style="list-style: none; padding: 0; margin: 0;">`;

            if (visibleRoles.length === 0) {
                html += `<li style="color: var(--text-muted); text-align: center; padding: var(--space-lg) 0;">No collaborators yet.</li>`;
            }

            visibleRoles.forEach(r => {
                let actions = '';

                if (r.role === 'pending') {
                    actions = `
            <button class="btn btn-sm btn-primary collab-approve" data-id="${escapeAttr(r.id)}">Approve</button>
            <button class="btn btn-sm btn-danger collab-reject" data-id="${escapeAttr(r.id)}">Reject</button>
          `;
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

                const authorDisplay = r.email.display_name || (r.email.email ? r.email.email.split('@')[0] : 'Unknown');
                const seed = r.email.display_name || r.email.email || 'user';
                const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1f2937&textColor=f3f4f6`;

                html += `
          <li style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-md) 0; border-bottom: 1px solid var(--bg-hover);">
            <div style="display: flex; align-items: center; gap: var(--space-sm);">
              <img src="${escapeAttr(avatarUrl)}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--glass-border);">
              <div>
                <div style="font-weight: 500; color: var(--text-primary);">${escapeHtml(authorDisplay)}</div>
                <div style="font-size: var(--text-xs); color: var(--text-secondary); text-transform: uppercase;">${escapeHtml(r.role)}</div>
              </div>
            </div>
            <div style="display: flex; gap: var(--space-sm); align-items: center;">
              ${actions}
            </div>
          </li>
        `;
            });
            html += `</ul>`;

            container.innerHTML = html;

            // Wire up buttons
            container.querySelectorAll('.collab-approve').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    await updateRole(btn.dataset.id, 'editor');
                    this.renderManageList(container);
                });
            });

            container.querySelectorAll('.collab-reject, .collab-remove').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm('Remove this user?')) {
                        btn.disabled = true;
                        await removeRole(btn.dataset.id);
                        this.renderManageList(container);
                    }
                });
            });

            container.querySelectorAll('.collab-role-select').forEach(sel => {
                sel.addEventListener('change', async (e) => {
                    sel.disabled = true;
                    await updateRole(sel.dataset.id, e.target.value);
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
            const roles = await getProjectRoles(this.project.id);
            const bannedRoles = roles.filter(r => r.role === 'banned');
            // Also list all users so they can be explicitly banned if needed? 
            // For simplicity, we show a list of current non-owner users that can be banned.
            const bannableRoles = roles.filter(r => r.role !== 'owner' && r.role !== 'banned');

            let html = `<h3 style="margin-bottom: var(--space-lg);">Moderation Controls</h3>`;

            html += `
        <div style="margin-bottom: var(--space-xl);">
          <h4 style="font-size: var(--text-sm); margin-bottom: var(--space-sm);">Ban an active collaborator</h4>
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

            html += `<h4 style="font-size: var(--text-sm); margin-bottom: var(--space-sm); border-top: 1px solid var(--glass-border); padding-top: var(--space-md);">Banned Users</h4>`;
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

            container.innerHTML = html;

            // Ban button
            container.querySelector('#mod-ban-btn').addEventListener('click', async (e) => {
                const select = container.querySelector('#mod-ban-select');
                if (!select.value) return;
                if (confirm('Ban this user? They will not be able to interact with the project.')) {
                    e.target.disabled = true;
                    await banUser(this.project.id, select.value);
                    this.renderModerationTab(container);
                }
            });

            // Unban
            container.querySelectorAll('.mod-unban').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    await removeRole(btn.dataset.id); // deleting the banned role frees them
                    this.renderModerationTab(container);
                });
            });

            // Wipe
            container.querySelectorAll('.mod-wipe').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (confirm('WARNING: This will permanently delete EVERY time entry and comment this user ever created on this project. This cannot be undone. Proceed?')) {
                        btn.disabled = true;
                        btn.textContent = 'Wiping...';
                        try {
                            await wipeUserContributions(this.project.id, btn.dataset.userid);
                            btn.textContent = 'Wiped!';
                            // Optional: full refresh to clear UI 
                            if (this.handlers.onRefreshRequired) this.handlers.onRefreshRequired();
                        } catch (err) {
                            console.error(err);
                            alert('Failed to wipe: ' + err.message);
                            btn.disabled = false;
                            btn.textContent = 'Wipe Contributions';
                        }
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
      <h3 style="margin-bottom: var(--space-lg); color: var(--danger);">Danger Zone</h3>
      
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
                    alert("Failed to delete project: " + err.message);
                    deleteBtn.disabled = false;
                    deleteBtn.textContent = 'Delete Project';
                }
            }
        });
    }
}
