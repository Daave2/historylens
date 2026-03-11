export default class LandingPage {
    constructor({ onExplore, onAuthRequest }) {
        this.createDom();
        this.onExplore = onExplore;
        this.onAuthRequest = onAuthRequest;
    }

    createDom() {
        this.container = document.createElement('div');
        this.container.id = 'landing-page';
        this.container.className = 'landing-container';
        this.container.style.display = 'none';

        this.container.innerHTML = `
            <header class="landing-header">
                <div class="logo">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
                        <path d="M2 12h20"/>
                    </svg>
                    <h1>History<span class="accent">Lens</span></h1>
                </div>
                <div class="nav-actions">
                    <button class="btn btn-ghost install-trigger" id="landing-install-btn" style="display:none;">Install App</button>
                    <button class="btn btn-ghost" id="landing-login-btn">Sign In</button>
                    <button class="btn btn-primary" id="landing-signup-btn">Get Started</button>
                </div>
            </header>

            <section class="hero-section">
                <div class="hero-bg"></div>
                <div class="hero-content">
                    <h2>Map the stories<br/>of your streets.</h2>
                    <p>HistoryLens is a collaborative, open-source platform for researching and documenting local history on an interactive timeline map.</p>
                    <div class="hero-actions">
                        <button class="btn btn-primary" id="hero-explore-btn">Explore Projects</button>
                        <button class="btn btn-secondary" id="hero-create-btn">Create Your Own</button>
                    </div>
                </div>
            </section>

            <section class="features-section">
                <div class="features-grid">
                    <div class="feature-card">
                        <div class="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        </div>
                        <h3>Interactive Mapping</h3>
                        <p>Pinpoint historical locations and overlay a timeline of events, photos, and context for an evolving geographic narrative.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        </div>
                        <h3>Community Driven</h3>
                        <p>Invite trusted collaborators to help digitise local archives, cross-reference census data, and verify stories.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><polyline points="14 2 14 8 20 8"/><path d="M3 15h6"/><path d="M3 18h6"/></svg>
                        </div>
                        <h3>Own Your Data</h3>
                        <p>Your history shouldn't be locked away. Export entire projects as GeoJSON to keep your research preserved forever.</p>
                    </div>
                </div>
            </section>
            
            <footer class="landing-footer">
                <p>&copy; ${new Date().getFullYear()} HistoryLens — An open-source research tool.</p>
            </footer>
        `;

        document.body.appendChild(this.container);

        // Bind Events
        this.container.querySelector('#landing-login-btn').addEventListener('click', () => {
            if (this.onAuthRequest) this.onAuthRequest();
        });

        this.container.querySelector('#landing-signup-btn').addEventListener('click', () => {
            if (this.onAuthRequest) this.onAuthRequest();
        });

        this.container.querySelector('#hero-create-btn').addEventListener('click', () => {
            if (this.onAuthRequest) this.onAuthRequest();
        });

        this.container.querySelector('#hero-explore-btn').addEventListener('click', () => {
            if (this.onExplore) this.onExplore();
        });
    }

    show() {
        // Hide map/sidebar/dashboard from the main HTML
        document.getElementById('map-container').style.display = 'none';
        document.getElementById('sidebar').style.display = 'none';
        document.getElementById('time-slider-container').style.display = 'none';
        if (document.getElementById('dashboard')) {
            document.getElementById('dashboard').style.display = 'none';
        }

        this.container.style.display = 'block';
    }

    hide() {
        this.container.style.display = 'none';
    }
}
