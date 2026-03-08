import { supabase } from '../data/supabaseClient.js';
import { signInWithFacebook } from '../data/store.js';

export default class AuthModal {
    constructor() {
        this.createDom();
        this.onLoginSuccess = null;
    }

    createDom() {
        this.modal = document.createElement('div');
        this.modal.id = 'auth-modal';
        this.modal.className = 'modal-overlay glass-panel';
        this.modal.style.display = 'none';

        this.modal.innerHTML = `
      <div class="modal-content glass-card" style="max-width: 400px; padding: var(--space-xl);">
        <h2 style="font-family: var(--font-heading); margin-bottom: var(--space-md);">Sign In / Sign Up</h2>
        <p style="color: var(--text-secondary); font-size: var(--text-sm); margin-bottom: var(--space-xl);">
          To create projects or edit places, you need to sign in. Reading public history is always free.
        </p>

        <button class="btn" id="auth-btn-facebook" style="width: 100%; margin-bottom: var(--space-lg); background-color: #1877F2; color: white; border-color: #1877F2; gap: var(--space-sm); justify-content: center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
          Continue with Facebook
        </button>

        <div style="display: flex; align-items: center; text-align: center; margin-bottom: var(--space-lg);">
          <div style="flex-grow: 1; border-bottom: 1px solid var(--border-color);"></div>
          <span style="padding: 0 var(--space-md); color: var(--text-muted); font-size: var(--text-xs); text-transform: uppercase;">or email</span>
          <div style="flex-grow: 1; border-bottom: 1px solid var(--border-color);"></div>
        </div>
        
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

        this.modal.querySelector('#auth-btn-facebook').addEventListener('click', async () => {
            clearError();
            try {
                // This will redirect the user to Facebook. 
                // The current session will end, and the app will reload with the token in the URL.
                await signInWithFacebook();
            } catch (err) {
                showError(err.message);
            }
        });

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
