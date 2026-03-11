import { supabase } from '../data/supabaseClient.js';

export default class AuthModal {
    constructor() {
        this.createDom();
        this.onLoginSuccess = null;
    }

    createDom() {
        this.modal = document.createElement('div');
        this.modal.id = 'auth-modal';
        this.modal.className = 'modal-overlay';
        this.modal.style.display = 'none';
        this.modal.style.zIndex = '3600';

        this.modal.innerHTML = `
      <div class="modal glass-panel" style="max-width: 420px; width: 100%; padding: var(--space-xl);">
        <h2 style="font-family: var(--font-heading); margin-bottom: var(--space-md);">Sign In / Sign Up</h2>
        <p style="color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: var(--space-xl);">
          To create projects or edit places, you need to sign in. Reading public history is always free.
        </p>
        
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="auth-email" class="form-input" placeholder="you@example.com" />
        </div>
        
        <div class="form-group" style="margin-bottom: var(--space-lg);">
          <label class="form-label">Password</label>
          <input type="password" id="auth-password" class="form-input" placeholder="••••••••" />
        </div>

        <div id="auth-error" style="color: var(--danger); font-size: var(--text-sm); margin-bottom: var(--space-lg); display: none;"></div>

        <div style="display: flex; gap: var(--space-sm); flex-direction: column;">
          <button class="btn btn-primary" id="auth-btn-login" style="width: 100%;">Sign In</button>
          <button class="btn btn-ghost" id="auth-btn-signup" style="width: 100%;">Create Account</button>
        </div>
        
        <div style="margin-top: var(--space-lg); text-align: center;">
          <button class="btn btn-ghost" id="auth-btn-cancel" style="font-size: var(--text-xs);">Cancel (Read Only)</button>
        </div>
      </div>
    `;

        document.body.appendChild(this.modal);
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });

        const emailInput = this.modal.querySelector('#auth-email');
        const pwdInput = this.modal.querySelector('#auth-password');
        const errBox = this.modal.querySelector('#auth-error');

        const showError = (msg) => {
            errBox.textContent = msg;
            errBox.style.display = 'block';
        };

        const clearError = () => {
            errBox.textContent = '';
            errBox.style.display = 'none';
        };

        this.modal.querySelector('#auth-btn-login').addEventListener('click', async () => {
            clearError();
            const email = emailInput.value.trim();
            const password = pwdInput.value;
            if (!email || !password) return showError('Please enter email and password.');

            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) {
                showError(error.message);
            } else {
                this.close();
                if (this.onLoginSuccess) this.onLoginSuccess(data.session.user);
            }
        });

        this.modal.querySelector('#auth-btn-signup').addEventListener('click', async () => {
            clearError();
            const email = emailInput.value.trim();
            const password = pwdInput.value;
            if (!email || !password) return showError('Please enter email and password.');

            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) {
                showError(error.message);
            } else {
                // If email confirmation is off, this returns a session immediately
                if (data.session) {
                    this.close();
                    if (this.onLoginSuccess) this.onLoginSuccess(data.session.user);
                } else {
                    showError("Check your email for a confirmation link.");
                }
            }
        });

        this.modal.querySelector('#auth-btn-cancel').addEventListener('click', () => {
            this.close();
        });
    }

    show({ onSuccess } = {}) {
        this.onLoginSuccess = onSuccess;
        this.modal.style.display = 'flex';
        this.modal.querySelector('#auth-email').focus();
        this.modal.querySelector('#auth-error').style.display = 'none';
    }

    close() {
        this.modal.style.display = 'none';
    }
}
