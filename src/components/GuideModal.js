export default class GuideModal {
    constructor(handlers = {}) {
        this.handlers = { ...handlers };
        this.mode = 'dashboard';
        this.state = {};
        this.createDom();
    }

    setHandlers(nextHandlers = {}) {
        this.handlers = { ...this.handlers, ...nextHandlers };
    }

    createDom() {
        this.modal = document.createElement('div');
        this.modal.id = 'guide-modal';
        this.modal.className = 'modal-overlay';
        this.modal.style.display = 'none';
        this.modal.style.zIndex = '3200';

        this.modal.innerHTML = `
      <div class="modal glass-panel guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <button class="modal-close icon-btn" id="guide-close-btn" aria-label="Close guide">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <p class="guide-kicker" id="guide-kicker"></p>
        <h2 id="guide-title" class="guide-title"></h2>
        <p class="guide-description" id="guide-description"></p>
        <ol class="guide-steps" id="guide-steps"></ol>
        <div class="guide-actions" id="guide-actions"></div>
        <p class="guide-note" id="guide-note"></p>
      </div>
    `;

        document.body.appendChild(this.modal);

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.hide();
        });
        this.modal.querySelector('#guide-close-btn').addEventListener('click', () => this.hide());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal.style.display !== 'none') {
                this.hide();
            }
        });
    }

    showDashboard({ isSignedIn = false } = {}) {
        this.mode = 'dashboard';
        this.state = { isSignedIn };
        this.render();
        this.show();
    }

    showProject({ canSubmit = false, canEditPublished = false, isSignedIn = false } = {}) {
        this.mode = 'project';
        this.state = { canSubmit, canEditPublished, isSignedIn };
        this.render();
        this.show();
    }

    render() {
        const content = this.mode === 'project'
            ? this.getProjectContent()
            : this.getDashboardContent();

        this.modal.querySelector('#guide-kicker').textContent = content.kicker;
        this.modal.querySelector('#guide-title').textContent = content.title;
        this.modal.querySelector('#guide-description').textContent = content.description;
        this.modal.querySelector('#guide-note').textContent = content.note || '';

        const stepsEl = this.modal.querySelector('#guide-steps');
        stepsEl.innerHTML = content.steps.map((step, index) => `
      <li class="guide-step">
        <span class="guide-step-index">${index + 1}</span>
        <div class="guide-step-body">
          <h4>${step.title}</h4>
          <p>${step.detail}</p>
        </div>
      </li>
    `).join('');

        const actionsEl = this.modal.querySelector('#guide-actions');
        actionsEl.innerHTML = content.actions.map(action => `
      <button class="btn ${action.variant === 'primary' ? 'btn-primary' : 'btn-ghost'}" data-guide-action="${action.id}">
        ${action.label}
      </button>
    `).join('');

        actionsEl.querySelectorAll('button[data-guide-action]').forEach(btn => {
            btn.addEventListener('click', () => this.runAction(btn.dataset.guideAction));
        });
    }

    getDashboardContent() {
        const { isSignedIn } = this.state;
        const steps = [
            {
                title: 'Open a project',
                detail: 'Start in Explore Maps and click any card.'
            },
            {
                title: isSignedIn ? 'Create your own project' : 'Sign in once',
                detail: isSignedIn
                    ? 'Go to My Maps and click Start a new map.'
                    : 'This unlocks My Maps and collaboration.'
            },
            {
                title: 'Add your first place',
                detail: 'In a project: click Add Place, then click the map.'
            }
        ];

        const actions = [
            { id: 'dash-public', label: 'Explore Maps', variant: 'primary' },
            { id: 'dash-mine', label: 'My Maps', variant: 'ghost' }
        ];

        if (!isSignedIn) {
            actions.push({ id: 'dash-signin', label: 'Sign In', variant: 'ghost' });
        }

        return {
            kicker: 'Quick Start',
            title: 'Start in 30 seconds',
            description: 'Three simple steps.',
            steps,
            actions,
            note: 'Open this guide anytime from the help button.'
        };
    }

    getProjectContent() {
        const { canSubmit, canEditPublished, isSignedIn } = this.state;
        const addLabel = canEditPublished ? 'Add Place' : 'Suggest Place';
        const canAdd = canSubmit;

        const steps = canAdd
            ? [
                {
                    title: `Add one place`,
                    detail: `Click ${addLabel}, then click the map.`
                },
                {
                    title: 'Add one dated fact',
                    detail: 'Open the place page and add the first dated timeline entry.'
                },
                {
                    title: 'Use Recent Changes and Talk',
                    detail: 'Review edits and use Talk for source questions or open issues.'
                }
            ]
            : [
                {
                    title: 'Use search',
                    detail: 'Find places fast from the sidebar by name, year, or event.'
                },
                {
                    title: 'Open any place',
                    detail: 'Read the summary, timeline, and recent changes.'
                },
                {
                    title: isSignedIn ? 'Request access' : 'Sign in and request access',
                    detail: isSignedIn
                        ? 'Use Request Access in the sidebar if you should help edit this map.'
                        : 'Use Sign In to Request Access in the sidebar if you should help edit this map.'
                }
            ];

        const actions = [{ id: 'project-search', label: 'Focus Search', variant: canAdd ? 'ghost' : 'primary' }];
        if (canAdd) {
            actions.unshift({ id: 'project-add', label: `Start ${addLabel}`, variant: 'primary' });
        } else {
            actions.push({
                id: 'project-request',
                label: isSignedIn ? 'Request Access' : 'Sign In to Request Access',
                variant: 'ghost'
            });
        }

        return {
            kicker: 'Project Guide',
            title: 'How to use this map',
            description: canAdd
                ? 'Build one place page at a time.'
                : 'You have read-only access right now.',
            steps,
            actions,
            note: 'Keep edits small, clear, and source-backed.'
        };
    }

    runAction(actionId) {
        switch (actionId) {
            case 'dash-public':
                this.handlers.onSwitchDashboardTab?.('public');
                break;
            case 'dash-mine':
                this.handlers.onSwitchDashboardTab?.('mine');
                break;
            case 'dash-signin':
                this.handlers.onAuthRequest?.();
                this.hide();
                break;
            case 'dash-reset':
                this.handlers.onResetGuide?.();
                this.render();
                break;
            case 'project-search':
                this.handlers.onFocusSearch?.();
                this.hide();
                break;
            case 'project-add':
                this.handlers.onStartAddPlace?.();
                this.hide();
                break;
            case 'project-request':
                this.handlers.onRequestAccess?.();
                this.hide();
                break;
            default:
                break;
        }
    }

    show() {
        this.modal.style.display = 'flex';
    }

    hide() {
        this.modal.style.display = 'none';
    }
}
