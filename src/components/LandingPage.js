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
                    <p class="hero-eyebrow">Local history, one place at a time</p>
                    <h2>A simpler way to map the past.</h2>
                    <p>Browse a map, open a place, and add what you know with notes, dates, photos, and sources. HistoryLens keeps the workflow grounded and easy to follow.</p>
                    <div class="hero-actions">
                        <button class="btn btn-primary" id="hero-explore-btn">Browse Maps</button>
                        <button class="btn btn-secondary" id="hero-create-btn">Start A Project</button>
                    </div>
                    <div class="hero-points" aria-label="Key benefits">
                        <span>Write your own notes</span>
                        <span>Add photos and sources</span>
                        <span>Export your work</span>
                    </div>
                </div>
            </section>

            <section class="features-section">
                <div class="section-intro">
                    <p class="section-kicker">How It Works</p>
                    <h3>Three steps, not a giant workflow.</h3>
                </div>
                <div class="features-grid">
                    <div class="feature-card">
                        <div class="feature-step">01</div>
                        <h3>Open a map</h3>
                        <p>Start with a public project or create your own map for a street, neighbourhood, or theme.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-step">02</div>
                        <h3>Click a place</h3>
                        <p>See the summary, timeline, and discussion for each location without digging through a complex interface.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-step">03</div>
                        <h3>Add what you know</h3>
                        <p>Write an entry, attach photos or documents, and keep the record grounded in dates and sources.</p>
                    </div>
                </div>
                <div class="landing-note">
                    <p>Built for local researchers, community groups, and anyone collecting place-based history.</p>
                </div>
            </section>
            
            <footer class="landing-footer">
                <p>&copy; ${new Date().getFullYear()} HistoryLens — A place-based history map.</p>
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
