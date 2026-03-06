import { getAllProjects, createProject, getSession } from '../data/store.js';

export default class Dashboard {
    constructor({ onSelectProject, onAuthRequest }) {
        this.createDom();
        this.onSelectProject = onSelectProject;
        this.onAuthRequest = onAuthRequest;
        this.currentUser = null;
    }

    createDom() {
        this.container = document.createElement('div');
        this.container.id = 'dashboard';
        this.container.className = 'dashboard-container';
        this.container.style.display = 'none';

        this.container.innerHTML = `
      <div class="dashboard-content">
        <header class="dashboard-header">
          <div class="logo">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
            <h1>History<span class="accent">Lens</span></h1>
          </div>
          <div class="dashboard-actions">
            <!-- Auth button handled at top level, but we can put one here too -->
          </div>
        </header>

        <section class="dashboard-hero">
          <h2>Discover the history around you</h2>
          <p>Explore community research or start mapping your own local history project.</p>
        </section>

        <div class="dashboard-tabs">
          <button class="tab-btn active" data-tab="public">Public Projects</button>
          <button class="tab-btn" data-tab="mine">My Projects</button>
        </div>

        <div class="project-grid" id="dashboard-grid">
          <!-- Project cards will be injected here -->
        </div>
      </div>
    `;

        document.body.appendChild(this.container);

        // Tab logic
        const tabs = this.container.querySelectorAll('.tab-btn');
        tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                this.renderGrid(btn.dataset.tab);
            });
        });

        // Delegated click for project cards
        this.container.querySelector('#dashboard-grid').addEventListener('click', (e) => {
            const card = e.target.closest('.project-card');
            if (card) {
                if (card.dataset.create === "true") {
                    this.handleCreateProject();
                } else {
                    const id = card.dataset.id;
                    if (id && this.onSelectProject) this.onSelectProject(id);
                }
            }
        });
    }

    async handleCreateProject() {
        if (!this.currentUser) {
            if (this.onAuthRequest) this.onAuthRequest();
            return;
        }

        try {
            // Just pass empty to let database define everything. 
            // Note: store.js creates default 'Untitled Project' values.
            const project = await createProject({
                name: 'New History Project',
                description: 'Click to edit description'
                // We could pass ownerId here but Supabase auth context does it via RLS if set, 
                // Wait, we need to pass ownerId if we update store.js...
                // Actually, we'll let store.js pass it in.
            });
            if (this.onSelectProject) this.onSelectProject(project.id);
        } catch (e) {
            console.error("Failed to create project", e);
            alert("Failed to create project. Check if you are signed in.");
        }
    }

    async show(currentUser = null) {
        this.currentUser = currentUser;

        // Hide map/sidebar from the main HTML
        document.getElementById('map-container').style.display = 'none';
        document.getElementById('sidebar').style.display = 'none';
        document.getElementById('time-slider-container').style.display = 'none';

        this.container.style.display = 'block';

        // Load all available projects (RLS filters out invisible ones)
        try {
            this.allProjects = await getAllProjects();
        } catch (e) {
            console.error(e);
            this.allProjects = [];
        }

        const activeTabBtn = this.container.querySelector('.tab-btn.active');
        this.renderGrid(activeTabBtn.dataset.tab);
    }

    hide() {
        this.container.style.display = 'none';

        // Restore map/sidebar
        document.getElementById('map-container').style.display = 'block';
        document.getElementById('sidebar').style.display = 'flex'; // sidebar expects flex
        document.getElementById('time-slider-container').style.display = 'block';
    }

    renderGrid(tab) {
        const grid = this.container.querySelector('#dashboard-grid');
        grid.innerHTML = ''; // reset

        let projectsToShow = [];
        if (tab === 'public') {
            projectsToShow = this.allProjects.filter(p => p.isPublic !== false);
        } else if (tab === 'mine') {
            if (!this.currentUser) {
                grid.innerHTML = `
                <div class="empty-state">
                  <p>Sign in to view and create your own projects.</p>
                  <button class="btn btn-primary" id="dash-signin-btn" style="margin-top:var(--space-md);">Sign In</button>
                </div>
             `;
                grid.querySelector('#dash-signin-btn').addEventListener('click', () => {
                    if (this.onAuthRequest) this.onAuthRequest();
                });
                return;
            }
            projectsToShow = this.allProjects.filter(p => p.ownerId === this.currentUser.id);
        }

        // If 'mine', add the create card first
        if (tab === 'mine') {
            grid.innerHTML += `
            <div class="project-card create-card" data-create="true">
              <div class="create-icon">+</div>
              <h3>Create New Project</h3>
            </div>
          `;
        }

        projectsToShow.forEach(p => {
            const date = p.createdAt ? p.createdAt.toLocaleDateString() : '';
            grid.innerHTML += `
            <div class="project-card" data-id="${p.id}">
              <div class="project-card-header">
                <h3>${p.name || 'Untitled'}</h3>
                ${p.isPublic === false ? '<span class="badge privacy-badge">Private</span>' : ''}
              </div>
              <p class="project-card-desc">${p.description || 'No description provided.'}</p>
              <div class="project-card-footer">
                <span class="date">Updated ${date}</span>
                <span class="link-arrow">→</span>
              </div>
            </div>
          `;
        });
    }
}
