import { getProjectChatMessages, sendProjectChatMessage, subscribeToProjectChat } from '../data/store.js';
import { escapeAttr, escapeHtml } from '../utils/sanitize.js';

const MAX_MESSAGE_LENGTH = 1200;

export default class ProjectChat {
    constructor({ onAuthRequest, onError } = {}) {
        this.onAuthRequest = onAuthRequest;
        this.onError = onError;
        this.project = null;
        this.currentUser = null;
        this.currentUserRole = null;
        this.permissions = {};
        this.messages = [];
        this.messageIds = new Set();
        this.unsubscribe = null;
        this.isOpen = false;
        this.schemaReady = true;

        this.createDom();
    }

    createDom() {
        this.modal = document.createElement('div');
        this.modal.className = 'project-chat-overlay';
        this.modal.style.display = 'none';
        this.modal.innerHTML = `
          <section class="project-chat-panel glass-panel" role="dialog" aria-modal="true" aria-labelledby="project-chat-title">
            <header class="project-chat-header">
              <div>
                <div class="project-chat-kicker">
                  <span class="project-chat-live-dot" aria-hidden="true"></span>
                  Live Project Chat
                </div>
                <h2 id="project-chat-title">Project Chat</h2>
              </div>
              <button class="icon-btn project-chat-close" type="button" aria-label="Close project chat">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>
            <div class="project-chat-status" aria-live="polite" style="display:none;"></div>
            <div class="project-chat-messages" aria-live="polite"></div>
            <div class="project-chat-composer"></div>
          </section>
        `;

        document.body.appendChild(this.modal);
        this.panelEl = this.modal.querySelector('.project-chat-panel');
        this.titleEl = this.modal.querySelector('#project-chat-title');
        this.statusEl = this.modal.querySelector('.project-chat-status');
        this.messagesEl = this.modal.querySelector('.project-chat-messages');
        this.composerEl = this.modal.querySelector('.project-chat-composer');

        this.modal.querySelector('.project-chat-close')?.addEventListener('click', () => this.hide());
        this.modal.addEventListener('click', (event) => {
            if (event.target === this.modal) this.hide();
        });
        this.keydownHandler = (event) => {
            if (event.key === 'Escape' && this.isOpen) this.hide();
        };
    }

    async show(project, { currentUser = null, currentUserRole = null, permissions = {} } = {}) {
        this.project = project;
        this.updateContext({ currentUser, currentUserRole, permissions });
        this.modal.style.display = 'flex';
        this.isOpen = true;
        document.addEventListener('keydown', this.keydownHandler);

        this.titleEl.textContent = project?.name ? `${project.name} Chat` : 'Project Chat';
        this.setStatus('Loading chat...', 'loading');
        this.messagesEl.innerHTML = '';
        this.renderComposer({ schemaReady: true });

        await this.loadMessages();
        window.requestAnimationFrame(() => this.scrollToBottom());
    }

    hide() {
        this.isOpen = false;
        this.modal.style.display = 'none';
        document.removeEventListener('keydown', this.keydownHandler);
        this.stopSubscription();
    }

    updateContext({ currentUser = this.currentUser, currentUserRole = this.currentUserRole, permissions = this.permissions } = {}) {
        this.currentUser = currentUser;
        this.currentUserRole = currentUserRole;
        this.permissions = permissions || {};
        if (this.isOpen) this.renderComposer({ schemaReady: this.schemaReady });
    }

    async loadMessages() {
        if (!this.project?.id) return;

        try {
            const result = await getProjectChatMessages(this.project.id, { limit: 75 });
            if (!result.schemaReady) {
                this.schemaReady = false;
                this.messages = [];
                this.messageIds.clear();
                this.renderMessages();
                this.setStatus('Apply supabase/phase27_project_chat.sql to enable project chat.', 'warning');
                this.renderComposer({ schemaReady: false });
                return;
            }

            this.schemaReady = true;
            this.messages = result.items;
            this.messageIds = new Set(this.messages.map(message => message.id));
            this.renderMessages();
            this.setStatus('', '');
            this.renderComposer({ schemaReady: true });
            this.startSubscription();
        } catch (err) {
            console.error('Could not load project chat:', err);
            this.messages = [];
            this.messageIds.clear();
            this.renderMessages();
            this.setStatus(err?.message || 'Could not load project chat.', 'error');
            this.renderComposer({ schemaReady: true });
        }
    }

    startSubscription() {
        this.stopSubscription();
        this.unsubscribe = subscribeToProjectChat(
            this.project.id,
            (message) => {
                this.addMessage(message);
                this.scrollToBottom();
            },
            (err) => {
                console.warn('Project chat realtime warning:', err);
            }
        );
    }

    stopSubscription() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    setStatus(message = '', state = '') {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        this.statusEl.style.display = message ? 'block' : 'none';
        if (state) {
            this.statusEl.dataset.state = state;
        } else {
            delete this.statusEl.dataset.state;
        }
    }

    canPost() {
        return !!this.currentUser
            && !!this.permissions?.canSubmit
            && this.currentUserRole !== 'banned';
    }

    renderMessages() {
        if (!this.messagesEl) return;
        if (!this.messages.length) {
            this.messagesEl.innerHTML = `
              <div class="project-chat-empty">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                </svg>
                <h3>No messages yet</h3>
                <p>Start with a research question, meeting note, or lead worth checking.</p>
              </div>
            `;
            return;
        }

        this.messagesEl.innerHTML = this.messages.map(message => this.renderMessage(message)).join('');
    }

    renderMessage(message) {
        const isOwn = this.currentUser?.id === message.userId;
        const author = isOwn ? 'You' : this.getAuthorLabel(message);
        const body = escapeHtml(message.body).replace(/\n/g, '<br>');
        const createdAt = message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt);

        return `
          <article class="project-chat-message${isOwn ? ' is-own' : ''}" data-message-id="${escapeAttr(message.id)}">
            <div class="project-chat-message-meta">
              <span>${escapeHtml(author)}</span>
              <time datetime="${escapeAttr(createdAt.toISOString())}">${escapeHtml(this.formatMessageTime(createdAt))}</time>
            </div>
            <div class="project-chat-bubble">${body}</div>
          </article>
        `;
    }

    renderComposer({ schemaReady = true } = {}) {
        if (!this.composerEl) return;

        if (!schemaReady) {
            this.composerEl.innerHTML = `
              <div class="project-chat-access-note">Chat storage is not installed on this Supabase project yet.</div>
            `;
            return;
        }

        if (this.canPost()) {
            this.composerEl.innerHTML = `
              <form class="project-chat-form">
                <textarea class="project-chat-input" maxlength="${MAX_MESSAGE_LENGTH}" rows="3" placeholder="Message the project..." aria-label="Project chat message"></textarea>
                <div class="project-chat-form-row">
                  <span class="project-chat-count">0/${MAX_MESSAGE_LENGTH}</span>
                  <button class="btn btn-primary project-chat-send" type="submit">Send</button>
                </div>
              </form>
            `;

            const form = this.composerEl.querySelector('.project-chat-form');
            const textarea = this.composerEl.querySelector('.project-chat-input');
            const countEl = this.composerEl.querySelector('.project-chat-count');
            textarea?.addEventListener('input', () => {
                countEl.textContent = `${textarea.value.length}/${MAX_MESSAGE_LENGTH}`;
            });
            textarea?.addEventListener('keydown', (event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    form?.requestSubmit();
                }
            });
            form?.addEventListener('submit', (event) => {
                event.preventDefault();
                void this.submitMessage(textarea);
            });
            return;
        }

        const message = this.currentUserRole === 'banned'
            ? 'This account currently has read-only access on this project.'
            : this.currentUser
                ? 'Request access to join the project chat.'
                : 'Sign in and request access to join the project chat.';

        this.composerEl.innerHTML = `
          <div class="project-chat-access-note">
            <span>${escapeHtml(message)}</span>
            ${this.currentUserRole !== 'banned' ? '<button class="btn btn-ghost project-chat-access" type="button">Request Access</button>' : ''}
          </div>
        `;
        this.composerEl.querySelector('.project-chat-access')?.addEventListener('click', () => this.onAuthRequest?.());
    }

    async submitMessage(textarea) {
        const text = textarea?.value || '';
        if (!text.trim()) return;

        const button = this.composerEl.querySelector('.project-chat-send');
        button.disabled = true;
        button.textContent = 'Sending...';
        this.setStatus('', '');

        try {
            const message = await sendProjectChatMessage(this.project.id, text);
            textarea.value = '';
            const countEl = this.composerEl.querySelector('.project-chat-count');
            if (countEl) countEl.textContent = `0/${MAX_MESSAGE_LENGTH}`;
            this.addMessage(message);
            this.scrollToBottom();
        } catch (err) {
            console.error('Could not send project chat message:', err);
            const message = err?.message || 'Could not send message.';
            this.setStatus(message, 'error');
            this.onError?.(message);
        } finally {
            button.disabled = false;
            button.textContent = 'Send';
        }
    }

    addMessage(message) {
        if (!message?.id || this.messageIds.has(message.id)) return;
        this.messageIds.add(message.id);
        this.messages.push(message);
        this.messages.sort((a, b) => a.createdAt - b.createdAt);
        this.renderMessages();
    }

    scrollToBottom() {
        if (!this.messagesEl) return;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    getAuthorLabel(message) {
        const profile = message.profile || {};
        return profile.displayName || (profile.email ? profile.email.split('@')[0] : 'Community member');
    }

    formatMessageTime(date) {
        return new Intl.DateTimeFormat(undefined, {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }
}
