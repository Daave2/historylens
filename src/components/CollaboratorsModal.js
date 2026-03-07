import { requestAccess, getProjectRoles, updateRole, removeRole } from '../data/store.js';

export default class CollaboratorsModal {
  constructor() {
    this.createDom();
  }

  createDom() {
    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'collaborators-modal';
    this.modal.style.display = 'none';

    this.modal.innerHTML = `
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h2 id="collab-modal-title">Collaborators</h2>
          <button class="icon-btn modal-close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="modal-body" id="collab-modal-body">
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

  // --- Mode 1: Viewer requesting access ---
  showRequestAccess(projectId, onSuccess) {
    const titleEl = this.modal.querySelector('#collab-modal-title');
    const bodyEl = this.modal.querySelector('#collab-modal-body');

    titleEl.textContent = 'Request Edit Access';

    bodyEl.innerHTML = `
      <p style="color: var(--text-secondary); margin-bottom: var(--space-xl);">
        You are currently viewing this project in read-only mode. Would you like to request edit access from the project owner?
      </p>
      <div style="display: flex; gap: var(--space-md); justify-content: flex-end;">
        <button class="btn btn-ghost" id="collab-cancel-btn">Cancel</button>
        <button class="btn btn-primary" id="collab-request-btn">Request Access</button>
      </div>
    `;

    bodyEl.querySelector('#collab-cancel-btn').addEventListener('click', () => this.hide());

    const requestBtn = bodyEl.querySelector('#collab-request-btn');
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

  // --- Mode 2: Owner/Admin managing access ---
  async showManage(projectId, currentUserRole) {
    this.projectId = projectId;
    this.currentUserRole = currentUserRole; // 'owner' or 'admin'
    const titleEl = this.modal.querySelector('#collab-modal-title');
    const bodyEl = this.modal.querySelector('#collab-modal-body');

    titleEl.textContent = 'Manage Collaborators';
    bodyEl.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-muted);">Loading...</div>`;
    this.modal.style.display = 'flex';

    await this.renderManageList(projectId, bodyEl);
  }

  async renderManageList(projectId, bodyEl) {
    try {
      const roles = await getProjectRoles(projectId);

      let html = `<ul class="collab-list" style="list-style: none; padding: 0; margin: 0;">`;

      if (roles.length === 0) {
        html += `<li style="color: var(--text-muted); text-align: center; padding: var(--space-lg) 0;">No collaborators yet.</li>`;
      }

      roles.forEach(r => {
        let actions = '';

        if (r.role === 'pending') {
          actions = `
            <button class="btn btn-sm btn-primary collab-approve" data-id="${r.id}">Approve</button>
            <button class="btn btn-sm btn-danger collab-reject" data-id="${r.id}">Reject</button>
          `;
        } else {
          // Note: Owners can't be removed here (they aren't in project_roles anyway)
          // Admins can be removed by other admins (or we can restrict to owners only). Let's keep it simple.
          actions = `
            <select class="collab-role-select" data-id="${r.id}">
              <option value="editor" ${r.role === 'editor' ? 'selected' : ''}>Editor</option>
              <option value="admin" ${r.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
            <button class="icon-btn btn-danger collab-remove" data-id="${r.id}" title="Remove access">
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
              <img src="${avatarUrl}" alt="Avatar" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 1px solid var(--glass-border);">
              <div>
                <div style="font-weight: 500; color: var(--text-primary);">${authorDisplay}</div>
                <div style="font-size: var(--text-xs); color: var(--text-secondary); text-transform: uppercase;">${r.role}</div>
              </div>
            </div>
            <div style="display: flex; gap: var(--space-sm); align-items: center;">
              ${actions}
            </div>
          </li>
        `;
      });
      html += `</ul>`;

      bodyEl.innerHTML = html;

      // Wire up buttons
      bodyEl.querySelectorAll('.collab-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await updateRole(btn.dataset.id, 'editor');
          this.renderManageList(projectId, bodyEl);
        });
      });

      bodyEl.querySelectorAll('.collab-reject, .collab-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remove this user?')) {
            btn.disabled = true;
            await removeRole(btn.dataset.id);
            this.renderManageList(projectId, bodyEl);
          }
        });
      });

      bodyEl.querySelectorAll('.collab-role-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
          sel.disabled = true;
          await updateRole(sel.dataset.id, e.target.value);
          this.renderManageList(projectId, bodyEl);
        });
      });

    } catch (err) {
      console.error(err);
      bodyEl.innerHTML = `<div style="color: var(--danger);">${err.message}</div>`;
    }
  }
}
