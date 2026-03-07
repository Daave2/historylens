export default class ProfileModal {
    constructor({ onSave }) {
        this.modal = document.getElementById('profile-modal');
        this.content = document.getElementById('profile-modal-content');
        this.onSave = onSave;

        // Bind close handlers
        this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
    }

    show(currentProfile = {}) {
        // Generate a simple avatar based on email or name
        const seed = currentProfile.display_name || currentProfile.email || 'user';
        const avatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=1f2937&textColor=f3f4f6`;

        this.content.innerHTML = `
      <h2 style="font-family: var(--font-heading); margin-bottom: var(--space-lg);">My Profile</h2>
      
      <div style="display: flex; gap: var(--space-md); margin-bottom: var(--space-xl); align-items: center;">
        <img src="${avatarUrl}" alt="Avatar" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 2px solid var(--glass-border);">
        <div style="flex: 1;">
          <div style="color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: 2px;">Account Email</div>
          <div style="font-weight: 500;">${currentProfile.email || 'Unknown'}</div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Display Name</label>
        <input class="form-input" id="profile-display-name" type="text" 
               placeholder="e.g. Jane Doe" 
               value="${currentProfile.display_name || ''}" />
        <span class="form-hint">This name will be shown publicly when you add places or entries.</span>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: var(--space-sm); margin-top: var(--space-xl);">
        <button class="btn btn-ghost" id="profile-cancel">Cancel</button>
        <button class="btn btn-primary" id="profile-save">Save Profile</button>
      </div>
    `;

        // Wire up events
        this.content.querySelector('#profile-cancel').addEventListener('click', () => this.close());
        this.content.querySelector('#profile-save').addEventListener('click', () => this._handleSave());
        this.content.querySelector('#profile-display-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._handleSave();
        });

        this.modal.style.display = 'flex';
    }

    close() {
        this.modal.style.display = 'none';
    }

    async _handleSave() {
        const nameInput = this.content.querySelector('#profile-display-name');
        const newName = nameInput.value.trim();

        const saveBtn = this.content.querySelector('#profile-save');
        saveBtn.textContent = 'Saving...';
        saveBtn.disabled = true;

        try {
            await this.onSave({ display_name: newName });
            this.close();
        } catch (err) {
            console.error('Failed to save profile:', err);
            saveBtn.textContent = 'Save Profile';
            saveBtn.disabled = false;
            alert('Error saving profile. Please try again.');
        }
    }
}
