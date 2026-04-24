import './styles/index.css';
import 'leaflet/dist/leaflet.css';

import {
  getOrCreateDefaultProject,
  updateProject,
  createPlace,
  createTimeEntry,
  updateTimeEntry,
  addImage,
  createOverviewRevision,
  getPlace,
  getTimeEntriesForPlace,
  updatePlace,
  getSession,
  signOut,
  onAuthStateChange,
  getProject,
  getUserRole,
  updateProfile,
  getProfiles,
  exportProjectGeoJSON,
  submitPlaceSuggestion,
  submitEntrySuggestion,
  submitPlaceMoveSuggestion,
  submitPlaceNameSuggestion,
  addPlaceNameAlias
} from './data/store.js';
import { generatePlaceOverview } from './ai/ai.js';

import { exportProject, importBundle, exportCSV, downloadFile, readFileAsJSON } from './data/io.js';

import MapView from './components/MapView.js';
import HoverCard from './components/HoverCard.js';
import Sidebar from './components/Sidebar.js';
import TimeSlider from './components/TimeSlider.js';

// ── App State ──────────────────────────────────────────────
let currentProject = null;
let currentUser = null;
let selectedYear = new Date().getFullYear();
let currentVisiblePlaceIds = null; // null means all are visible
let guideModal = null;
let guideModalHandlers = null;
let authModalPromise = null;
let projectAuthStateHandler = null;
const componentModulePromises = {};
const GUIDE_STORAGE = {
  seen: 'historylens.quick-guide.shown.v1'
};

function loadComponentModule(key, loader) {
  if (!componentModulePromises[key]) {
    componentModulePromises[key] = loader();
  }
  return componentModulePromises[key];
}

async function ensureAuthModal() {
  if (!authModalPromise) {
    authModalPromise = loadComponentModule('AuthModal', () => import('./components/AuthModal.js'))
      .then(({ default: AuthModal }) => new AuthModal());
  }
  return authModalPromise;
}

async function ensureGuideModal() {
  if (!guideModal) {
    const { default: GuideModal } = await loadComponentModule('GuideModal', () => import('./components/GuideModal.js'));
    guideModal = new GuideModal();
    if (guideModalHandlers) {
      guideModal.setHandlers(guideModalHandlers);
    }
  }
  return guideModal;
}

function setGuideModalHandlers(handlers) {
  guideModalHandlers = handlers;
  if (guideModal) {
    guideModal.setHandlers(handlers);
  }
}

async function createProjectSettings() {
  const { default: ProjectSettings } = await loadComponentModule('ProjectSettings', () => import('./components/ProjectSettings.js'));
  return new ProjectSettings();
}

function getBasePath() {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Temporary safety mode: clear any existing worker to avoid stale shell/cache lockups.
  // Once startup is fully stable in production we can re-enable registration.
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    })
    .catch((err) => {
      console.warn('Could not clear service worker registrations:', err);
    });
}

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosSafari() {
  const ua = navigator.userAgent || '';
  const ios = /iphone|ipad|ipod/i.test(ua);
  const safari = /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
  return ios && safari;
}

function showIosInstallGuide() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '3600';
  overlay.innerHTML = `
    <div class="modal glass-panel" style="max-width: 460px;">
      <h3 style="margin-bottom: var(--space-sm);">Install On iPhone / iPad</h3>
      <p style="color: var(--text-secondary); margin-bottom: var(--space-md);">
        Safari does not show an automatic install prompt. Add HistoryLens manually:
      </p>
      <ol style="margin: 0 0 var(--space-lg) var(--space-lg); color: var(--text-secondary); line-height: 1.7;">
        <li>Tap the <strong>Share</strong> button in Safari.</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong> in the top-right corner.</li>
      </ol>
      <div style="display:flex; justify-content:flex-end;">
        <button class="btn btn-primary" id="ios-install-ok">Got it</button>
      </div>
    </div>
  `;

  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('#ios-install-ok')?.addEventListener('click', close);
  document.body.appendChild(overlay);
}

function setupInstallPromptUi() {
  let deferredInstallPrompt = null;
  const wiredButtons = new WeakSet();

  const shouldShowManualIosInstall = () => isIosSafari() && !isStandaloneMode();

  const updateButtons = () => {
    const showButtons = !isStandaloneMode() && (Boolean(deferredInstallPrompt) || shouldShowManualIosInstall());
    const buttonLabel = deferredInstallPrompt ? 'Install App' : 'Add To Home';

    document.querySelectorAll('.install-trigger').forEach((button) => {
      if (!wiredButtons.has(button)) {
        button.addEventListener('click', onInstallClick);
        wiredButtons.add(button);
      }
      const nextDisplay = showButtons ? 'inline-flex' : 'none';
      if (button.style.display !== nextDisplay) {
        button.style.display = nextDisplay;
      }
      if (button.textContent !== buttonLabel) {
        button.textContent = buttonLabel;
      }
    });
  };

  const onInstallClick = async (event) => {
    event.preventDefault();
    if (isStandaloneMode()) {
      updateButtons();
      return;
    }

    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      updateButtons();
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        showToast('Install started.', 'success');
      } else {
        showToast('Install dismissed.', 'info');
        updateButtons();
      }
      return;
    }

    if (shouldShowManualIosInstall()) {
      showIosInstallGuide();
      return;
    }

    showToast('Install is available when your browser marks this app as installable.', 'info');
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showToast('App installed successfully.', 'success');
    updateButtons();
  });

  updateButtons();
}

function installMobileModalViewportFixes() {
  const root = document.documentElement;
  let syncedInput = null;

  const syncViewportHeight = () => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    root.style.setProperty('--visual-viewport-height', `${Math.round(viewportHeight)}px`);
  };

  const centerFocusedModalInput = () => {
    if (!syncedInput || !window.matchMedia('(max-width: 768px)').matches) return;
    syncedInput.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  };

  syncViewportHeight();
  window.addEventListener('resize', syncViewportHeight, { passive: true });
  window.addEventListener('orientationchange', syncViewportHeight, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewportHeight);
    window.visualViewport.addEventListener('scroll', syncViewportHeight);
  }

  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest('.modal')) return;
    if (!target.matches('input, textarea, select')) return;
    syncedInput = target;
    window.setTimeout(centerFocusedModalInput, 90);
  });

  document.addEventListener('focusout', () => {
    syncedInput = null;
  });
}

function setProjectShellVisible(visible) {
  const mapContainer = document.getElementById('map-container');
  const sidebar = document.getElementById('sidebar');
  const timeSlider = document.getElementById('time-slider-container');

  if (mapContainer) mapContainer.style.display = visible ? 'block' : 'none';
  if (sidebar) sidebar.style.display = visible ? 'flex' : 'none';
  if (!visible && timeSlider) timeSlider.style.display = 'none';
}

// ── Init ───────────────────────────────────────────────────
async function init() {
  registerServiceWorker();
  installMobileModalViewportFixes();
  const urlParams = new URLSearchParams(window.location.search);
  const projectIdParam = urlParams.get('project');

  // On the home route we should never flash the raw project shell while auth/session bootstraps.
  if (!projectIdParam) {
    setProjectShellVisible(false);
  } else {
    setProjectShellVisible(true);
  }
  const authBtn = document.getElementById('btn-auth');
  const profileBtn = document.getElementById('btn-profile');
  const sessionPromise = getSession();
  let profileModalPromise = null;

  const ensureProfileModal = async () => {
    if (!profileModalPromise) {
      profileModalPromise = loadComponentModule('ProfileModal', () => import('./components/ProfileModal.js'))
        .then(({ default: ProfileModal }) => new ProfileModal({
          onSave: async (updates) => {
            await updateProfile(updates);
            // Refresh current user data specifically for the local cache
            const updatedProfiles = await getProfiles([currentUser.id]);
            if (updatedProfiles[currentUser.id]) {
              currentUser = { ...currentUser, user_metadata: { ...currentUser.user_metadata, ...updates }, ...updatedProfiles[currentUser.id] };
            }
            updateAuthUI(currentUser);
            showToast('Profile updated', 'success');

            // If we're looking at a project, we might need to refresh attribution UI
            if (window.dashboardComponent && !currentProject) {
              window.dashboardComponent.show(currentUser);
            }
          }
        }));
    }
    return profileModalPromise;
  };

  // Render with a signed-out baseline first, then hydrate auth state.
  currentUser = null;
  updateAuthUI(currentUser);

  onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    updateAuthUI(currentUser);
    if (typeof projectAuthStateHandler === 'function') {
      void projectAuthStateHandler(event);
    }
  });

  authBtn.addEventListener('click', async () => {
    if (currentUser) {
      await signOut();
      showToast('Signed out successfully', 'info');
    } else {
      const authModal = await ensureAuthModal();
      authModal.show({
        onSuccess: (user) => {
          showToast(`Signed in as ${user.email}`, 'success');
        }
      });
    }
  });

  profileBtn.addEventListener('click', async () => {
    if (!currentUser) return;

    // Fetch latest profile details before showing
    const profiles = await getProfiles([currentUser.id]);
    const mergedProfile = { ...currentUser, ...(profiles[currentUser.id] || {}) };
    const profileModal = await ensureProfileModal();
    profileModal.show(mergedProfile);
  });

  function updateAuthUI(user) {
    if (user) {
      authBtn.textContent = 'Sign Out';
      authBtn.title = `Signed in as ${user.email}`;
      profileBtn.style.display = 'block';
    } else {
      authBtn.textContent = 'Sign In';
      authBtn.title = '';
      profileBtn.style.display = 'none';
    }

    // Refresh dashboard or landing based on state
    if (!currentProject && window.dashboardComponent) {
      const landingEl = document.getElementById('landing-page');
      const isLandingVisible = landingEl && landingEl.style.display !== 'none';

      if (user) {
        // If signed in, always go to dashboard (hide landing)
        if (window.landingComponent) window.landingComponent.hide();
        window.dashboardComponent.show(user);
      } else {
        // If signed out, only update dashboard if they are already looking at it.
        // If the landing page is visible, keep it visibile.
        if (!isLandingVisible) {
          window.dashboardComponent.show(null);
        } else {
          if (window.landingComponent) window.landingComponent.show();
        }
      }
    }
  }

  // Routing Logic
  if (projectIdParam) {
    try {
      const session = await sessionPromise;
      currentUser = session?.user || null;
      updateAuthUI(currentUser);

      currentProject = await getProject(projectIdParam);
      if (!currentProject) throw new Error("Project not found");
      await initProjectView(currentProject);
    } catch (err) {
      console.error(err);
      showToast('Project not found or private. Redirecting to home…', 'error');
      window.setTimeout(() => {
        window.location.href = import.meta.env.BASE_URL || '/';
      }, 1200);
    }
  } else {
    const requestAuthFromHome = async () => {
      const authModal = await ensureAuthModal();
      authModal.show({
        onSuccess: (user) => {
          showToast(`Signed in as ${user.email}`, 'success');
          if (window.landingComponent && !currentProject) {
            window.landingComponent.hide();
            window.dashboardComponent.show(user);
          }
        }
      });
    };

    const [{ default: Dashboard }, { default: LandingPage }] = await Promise.all([
      loadComponentModule('Dashboard', () => import('./components/Dashboard.js')),
      loadComponentModule('LandingPage', () => import('./components/LandingPage.js'))
    ]);

    // Show Dashboard or Landing Page Context
    const dashboard = new Dashboard({
      onSelectProject: (id) => {
        window.location.search = `?project=${id}`;
      },
      onAuthRequest: requestAuthFromHome,
      onGuideRequest: async () => {
        const modal = await ensureGuideModal();
        modal.showDashboard({ isSignedIn: !!currentUser });
      }
    });
    window.dashboardComponent = dashboard;

    setGuideModalHandlers({
      onSwitchDashboardTab: (tab) => {
        dashboard.setTab(tab);
        const targetBtn = dashboard.container.querySelector(`.tab-btn[data-tab="${tab}"]`);
        spotlightElement(targetBtn);
      },
      onAuthRequest: requestAuthFromHome,
      onResetGuide: () => {
        try {
          localStorage.removeItem(GUIDE_STORAGE.seen);
        } catch {
          // Ignore localStorage access issues.
        }
        showToast('Guide progress reset.', 'success');
      }
    });

    // Create landing page
    const landing = new LandingPage({
      onExplore: () => {
        landing.hide();
        dashboard.show(currentUser);
      },
      onAuthRequest: requestAuthFromHome
    });
    window.landingComponent = landing;

    if (currentUser) {
      dashboard.show(currentUser);
    } else {
      landing.show();
    }

    sessionPromise
      .then((session) => {
        currentUser = session?.user || null;
        updateAuthUI(currentUser);
      })
      .catch((err) => {
        console.error('Could not restore auth session on home route:', err);
      });
  }

  // Defer install UI wiring until initial route view is visible.
  window.requestAnimationFrame(() => {
    window.setTimeout(() => setupInstallPromptUi(), 0);
  });
}

function getRolePermissions(role) {
  const canEditPublished = role === 'owner' || role === 'admin' || role === 'editor';
  const canSubmit = canEditPublished || role === 'pending';
  return {
    canEditPublished,
    canSubmit,
    isReadOnly: !canEditPublished
  };
}

async function initProjectView(project) {
  const getProjectPermissions = (role) => ({
    ...getRolePermissions(role),
    isSignedIn: !!currentUser
  });
  let currentUserRole = currentUser ? await getUserRole(project.id) : null;
  let permissions = getProjectPermissions(currentUserRole);
  const mobileSidebarQuery = window.matchMedia('(max-width: 900px)');
  let sidebar = null;
  let placeDetail = null;
  let placeForm = null;
  let entryForm = null;
  let mapView = null;
  let hoverCard = null;
  let timeSlider = null;
  let activePlaceId = null;

  const refreshOpenPlaceDetail = async () => {
    const isDetailOpen = !!activePlaceId && placeDetail?.modal?.style.display !== 'none';
    if (!isDetailOpen) return;

    const refreshedPlace = await getPlace(activePlaceId);
    if (!refreshedPlace) {
      placeDetail?.close();
      return;
    }

    await showPlaceDetail(refreshedPlace, placeDetail?.activeTab || 'overview');
  };

  const syncProjectAccessState = async ({ nextRole, closeDraftForms = false } = {}) => {
    currentUserRole = typeof nextRole === 'undefined'
      ? (currentUser ? await getUserRole(project.id) : null)
      : nextRole;
    permissions = getProjectPermissions(currentUserRole);
    if (sidebar) sidebar.setProject(currentProject, permissions, currentUserRole);

    if (closeDraftForms) {
      placeForm?.close();
      entryForm?.close();
      mapView?.setAddMode(false);
    }

    await refreshOpenPlaceDetail();
  };

  const getAccessRequestFeedback = (result = {}) => {
    const role = result.role;
    const status = result.status;

    if (role === 'pending') {
      return status === 'existing'
        ? {
            message: 'Your access request is already pending. You can keep suggesting places and timeline entries while you wait.',
            type: 'info'
          }
        : {
            message: 'Access request sent. You can start suggesting places and timeline entries while you wait.',
            type: 'success'
          };
    }

    if (role === 'owner' || role === 'admin' || role === 'editor') {
      return {
        message: 'You already have edit access to this map.',
        type: 'info'
      };
    }

    if (role === 'banned') {
      return {
        message: 'This account currently has read-only access to this map.',
        type: 'info'
      };
    }

    return {
      message: 'Access status updated.',
      type: 'info'
    };
  };

  const handleAccessRequestResult = async (result) => {
    await syncProjectAccessState({ nextRole: result?.role ?? null });
    const feedback = getAccessRequestFeedback(result);
    showToast(feedback.message, feedback.type);
  };

  const openRequestAccessDialog = async () => {
    const settingsModal = await createProjectSettings();
    settingsModal.showRequestAccess(
      currentProject.id,
      (result) => {
        void handleAccessRequestResult(result);
      },
      { projectName: currentProject.name }
    );
  };

  const requestProjectAccess = async () => {
    if (!currentUser) {
      const authModal = await ensureAuthModal();
      authModal.show({
        title: 'Sign in to request access',
        description: `Sign in to ask for edit access to ${currentProject.name}. While your request is pending, you can still suggest places and timeline entries for review.`,
        cancelLabel: 'Keep Browsing',
        onSuccess: async (user) => {
          currentUser = user;
          updateAuthUI(currentUser);
          await projectAuthStateHandler?.('SIGNED_IN');
          showToast(`Signed in as ${user.email}`, 'success');

          const existingRole = await getUserRole(currentProject.id);
          if (existingRole) {
            await handleAccessRequestResult({ role: existingRole, status: 'existing' });
            return;
          }

          await openRequestAccessDialog();
        }
      });
      return;
    }

    await openRequestAccessDialog();
  };

  // Map
  mapView = new MapView('map-container', {
    centre: project.centre,
    zoom: project.defaultZoom,
    onMapClick: async (latlng) => {
      if (!permissions.canSubmit) return;
      const form = await ensurePlaceForm();
      mapView.setAddMode(false);
      form.show(latlng, { suggestionMode: !permissions.canEditPublished });
    },
    onMarkerClick: (place) => {
      sidebar.setActive(place.id);
      void showPlaceDetail(place, 'overview');
    },
    onMarkerHover: (place, point) => {
      hoverCard.show(place, point, selectedYear);
    },
    onMarkerLeave: () => {
      hoverCard.hide();
    }
  });

  // Historic map overlays (Hidden for now as they require a MapTiler API key)
  // const mapOverlay = new MapOverlay(mapView.map);

  // Hover card
  hoverCard = new HoverCard();

  // Time slider
  timeSlider = new TimeSlider({
    onYearChange: (year) => {
      selectedYear = year;
      // Refresh marker opacities based on data availability
      updateMarkerStates(mapView, sidebar?.places || [], sidebar?.entriesByPlaceId || {}, year);
    }
  });

  const startAddPlaceFlow = () => {
    if (!permissions.canSubmit) return false;
    mapView.setAddMode(true);
    const actionLabel = permissions.canEditPublished
      ? 'place a marker. You will fill in the details next'
      : 'mark the place you want to suggest for review';
    showToast(`Click on the map to ${actionLabel}`, 'info');
    return true;
  };

  const showPlaceDetail = async (place, activeTab = 'overview') => {
    activePlaceId = place.id;
    const detail = await ensurePlaceDetail();
    detail.activeTab = activeTab;
    await detail.show(
      place,
      permissions.isReadOnly,
      currentUser,
      currentUserRole,
      permissions.canSubmit && !permissions.canEditPublished
    );
  };

  const ensurePlaceDetail = async () => {
    if (!placeDetail) {
      const { default: PlaceDetail } = await loadComponentModule('PlaceDetail', () => import('./components/PlaceDetail.js'));
      placeDetail = new PlaceDetail({
        onAddEntry: async (place) => {
          const form = await ensureEntryForm();
          form.show(place, null, { suggestionMode: !permissions.canEditPublished });
        },
        onEditEntry: async (place, entry) => {
          const form = await ensureEntryForm();
          form.show(place, entry);
        },
        onDeletePlace: async (place) => {
          mapView.removeMarker(place.id);
          await refreshAll(mapView, sidebar, timeSlider);
          showToast(`"${place.name}" deleted`, 'success');
        },
        onRegenerateOverview: async (placeId, options = {}) => {
          return regeneratePlaceOverview(placeId, options);
        },
        onSuggestMove: async (place, suggestion) => {
          await submitPlaceMoveSuggestion({
            projectId: project.id,
            placeId: place.id,
            fromLat: place.lat,
            fromLng: place.lng,
            lat: suggestion.lat,
            lng: suggestion.lng,
            reason: suggestion.reason || ''
          });
          sidebar.setProject(currentProject, permissions, currentUserRole);
          showToast('Location correction submitted for moderation', 'success');
        },
        onSuggestAlias: async (place, suggestion) => {
          if (permissions.canEditPublished) {
            await addPlaceNameAlias({
              placeId: place.id,
              projectId: project.id,
              alias: suggestion.alias,
              startYear: suggestion.startYear,
              endYear: suggestion.endYear,
              note: suggestion.note || ''
            });
            await sidebar.loadPlaces(project.id);
            const refreshed = sidebar.places.find((candidate) => candidate.id === place.id) || await getPlace(place.id);
            if (refreshed) await showPlaceDetail(refreshed, 'names');
            showToast('Historical name added', 'success');
            return;
          }

          await submitPlaceNameSuggestion({
            projectId: project.id,
            placeId: place.id,
            alias: suggestion.alias,
            startYear: suggestion.startYear,
            endYear: suggestion.endYear,
            note: suggestion.note || ''
          });
          sidebar.setProject(currentProject, permissions, currentUserRole);
          showToast('Historical name suggestion submitted', 'success');
        },
        onPickLocationFromMap: ({ lat, lng } = {}) => {
          return new Promise((resolve) => {
            const previousOnMapClick = mapView.onMapClick;
            const previousAddMode = mapView.addMode;
            const currentZoom = mapView.map.getZoom();

            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              mapView.panTo(lat, lng, currentZoom);
            }

            mapView.setAddMode(true);
            showToast('Click on the map to pick the corrected location. Press Esc to cancel.', 'info');

            const cleanup = (pickedLatLng) => {
              mapView.onMapClick = previousOnMapClick;
              mapView.setAddMode(previousAddMode);
              document.removeEventListener('keydown', onKeyDown);
              resolve(pickedLatLng);
            };

            const onKeyDown = (event) => {
              if (event.key !== 'Escape') return;
              cleanup(null);
              showToast('Location pick cancelled.', 'info');
            };

            document.addEventListener('keydown', onKeyDown);

            mapView.onMapClick = (latlng) => {
              cleanup({ lat: latlng.lat, lng: latlng.lng });
              showToast(`Picked ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`, 'success');
            };
          });
        },
        onClose: () => {
          activePlaceId = null;
        }
      });
    }
    return placeDetail;
  };

  const ensurePlaceForm = async () => {
    if (!placeForm) {
      const { default: PlaceForm } = await loadComponentModule('PlaceForm', () => import('./components/PlaceForm.js'));
      placeForm = new PlaceForm({
        mapView,
        onSave: async ({ name, description, category, lat, lng, autoEntries }) => {
          if (permissions.canEditPublished) {
            const place = await createPlace({
              projectId: project.id,
              name, description, lat, lng, category
            });
            mapView.addMarker(place);

            // Auto-create entries from discovered info
            if (autoEntries && autoEntries.length > 0) {
              for (const ae of autoEntries) {
                await createTimeEntry({
                  placeId: place.id,
                  yearStart: ae.yearStart || new Date().getFullYear(),
                  yearEnd: ae.yearEnd || null,
                  title: ae.title || name,
                  summary: ae.summary || '',
                  source: ae.source || '',
                  sourceType: ae.sourceType || 'archive',
                  confidence: ae.confidence || 'likely'
                });
              }
            }
            await regeneratePlaceOverview(place.id, { force: false });

            await sidebar.loadPlaces(project.id);
            syncMarkers(mapView, sidebar.places);
            sidebar.setActive(place.id);
            mapView.panTo(place.lat, place.lng);
            await syncTimeSliderRange(timeSlider, project.id, sidebar.entriesByPlaceId);
            updateMarkerStates(mapView, sidebar.places, sidebar.entriesByPlaceId, selectedYear);
            const entryCount = autoEntries?.length || 0;
            const refreshedPlace = sidebar.places.find((candidate) => candidate.id === place.id) || place;
            showToast(`"${name}" added${entryCount > 0 ? ` with ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}` : ''}`, 'success');
            await showPlaceDetail(refreshedPlace, 'timeline');
            return;
          }

          await submitPlaceSuggestion({
            projectId: project.id,
            name,
            description,
            category,
            lat,
            lng,
            autoEntries
          });
          sidebar.setProject(currentProject, permissions, currentUserRole);
          showToast('Place suggestion submitted for approval', 'success');
        },
        onCancel: () => {
          mapView.setAddMode(false);
        }
      });
    }
    return placeForm;
  };

  const activeTabForEntrySave = (data) => (data.images?.length ? 'timeline' : 'overview');

  const ensureEntryForm = async () => {
    if (!entryForm) {
      const { default: EntryForm } = await loadComponentModule('EntryForm', () => import('./components/EntryForm.js'));
      entryForm = new EntryForm({
        onSave: async (data) => {
          let savedEntry;
          if (data.entryId) {
            if (!permissions.canEditPublished) {
              throw new Error('You do not have permission to edit existing entries.');
            }
            // Editing
            savedEntry = await updateTimeEntry(data.entryId, {
              yearStart: data.yearStart,
              yearEnd: data.yearEnd,
              title: data.title,
              summary: data.summary,
              source: data.source,
              sourceType: data.sourceType,
              confidence: data.confidence
            });

            // Allow adding new images while editing an existing entry.
            for (const img of data.images || []) {
              try {
                await addImage({
                  timeEntryId: savedEntry.id,
                  blob: img.blob,
                  caption: img.caption,
                  yearTaken: img.yearTaken,
                  credit: img.credit
                });
              } catch (err) {
                throw new Error(err?.message ? `Image upload failed: ${err.message}` : 'Image upload failed.');
              }
            }
            showToast('Entry updated', 'success');
          } else {
            if (permissions.canEditPublished) {
              // Creating
              savedEntry = await createTimeEntry({
                placeId: data.placeId,
                yearStart: data.yearStart,
                yearEnd: data.yearEnd,
                title: data.title,
                summary: data.summary,
                source: data.source,
                sourceType: data.sourceType,
                confidence: data.confidence
              });

              // Add images
              for (const img of data.images) {
                try {
                  await addImage({
                    timeEntryId: savedEntry.id,
                    blob: img.blob,
                    caption: img.caption,
                    yearTaken: img.yearTaken,
                    credit: img.credit
                  });
                } catch (err) {
                  throw new Error(err?.message ? `Image upload failed: ${err.message}` : 'Image upload failed.');
                }
              }
              showToast('Entry added', 'success');
            } else if (permissions.canSubmit) {
              await submitEntrySuggestion({
                projectId: project.id,
                placeId: data.placeId,
                yearStart: data.yearStart,
                yearEnd: data.yearEnd,
                title: data.title,
                summary: data.summary,
                source: data.source,
                sourceType: data.sourceType,
                confidence: data.confidence
              });
              sidebar.setProject(currentProject, permissions, currentUserRole);
              showToast(
                data.images?.length
                  ? 'Entry suggestion submitted (images can be added after approval).'
                  : 'Entry suggestion submitted for approval.',
                'success'
              );
              return;
            } else {
              throw new Error('You need edit access to add timeline entries.');
            }
          }

          await sidebar.loadPlaces(project.id);
          await syncTimeSliderRange(timeSlider, project.id, sidebar.entriesByPlaceId);
          updateMarkerStates(mapView, sidebar.places, sidebar.entriesByPlaceId, selectedYear);

          // Refresh detail if open
          const place = sidebar.places.find((candidate) => candidate.id === data.placeId);
          if (place) {
            await showPlaceDetail(place, activeTabForEntrySave(data));
          }
        },
        onCancel: () => { }
      });
    }
    return entryForm;
  };

  // Sidebar
  sidebar = new Sidebar({
    onPlaceClick: (place) => {
      mapView.panTo(place.lat, place.lng);
      void showPlaceDetail(place, 'overview');
      if (mobileSidebarQuery.matches) {
        sidebar.el.classList.add('collapsed');
      }
    },
    onFilterChange: (visibleIds) => {
      currentVisiblePlaceIds = new Set(visibleIds);
      updateMarkerStates(mapView, sidebar.places, sidebar.entriesByPlaceId, selectedYear);
    },
    onAddPlace: () => startAddPlaceFlow(),
    onImport: async () => {
      try {
        const data = await readFileAsJSON();
        const result = await importBundle(data, { targetProjectId: project.id });
        const importSummary = [
          `${result.placesImported} place${result.placesImported === 1 ? '' : 's'}`,
          `${result.entriesImported} entr${result.entriesImported === 1 ? 'y' : 'ies'}`
        ];
        if (result.aliasesImported) {
          importSummary.push(`${result.aliasesImported} historic name${result.aliasesImported === 1 ? '' : 's'}`);
        }
        if (result.imagesImported) {
          importSummary.push(`${result.imagesImported} image${result.imagesImported === 1 ? '' : 's'}`);
        }
        showToast(`Imported ${importSummary.join(', ')}`, 'success');
        await refreshAll(mapView, sidebar, timeSlider);
      } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
      }
    },
    onExport: async () => {
      try {
        const geojson = await exportProjectGeoJSON(project.id);
        const filename = `${project.name.replace(/\s+/g, '-').toLowerCase()}.geojson`;
        downloadFile(geojson, filename, 'application/geo+json');
        showToast('Project exported as GeoJSON successfully', 'success');
      } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
      }
    },
    onProjectEdit: async (changes) => {
      currentProject = await updateProject(project.id, changes);
    },
    onProjectSettings: async () => {
      const settingsModal = await createProjectSettings();
      settingsModal.showManage(currentProject, currentUserRole, {
        onSetCentre: async () => {
          const centre = mapView.map.getCenter();
          const zoom = mapView.map.getZoom();
          currentProject = await updateProject(currentProject.id, {
            settings: {
              map: { center: [centre.lat, centre.lng], zoom }
            }
          });
        },
        onSaveProjectInfo: async (changes) => {
          currentProject = await updateProject(currentProject.id, changes);
          sidebar.setProject(currentProject, permissions, currentUserRole);
        },
        onRefreshRequired: async () => {
          await refreshAll(mapView, sidebar, timeSlider);
          await sidebar.refreshInboxBadge();
        },
        onInboxChanged: async () => {
          await sidebar.refreshInboxBadge();
        }
      });
    },
    onRequestAccess: requestProjectAccess,
    onGuide: async () => {
      const modal = await ensureGuideModal();
      modal.showProject({
        canSubmit: permissions.canSubmit,
        canEditPublished: permissions.canEditPublished,
        isSignedIn: !!currentUser
      });
    }
  });
  sidebar.setProject(project, permissions, currentUserRole);
  await sidebar.loadPlaces(project.id);
  projectAuthStateHandler = async () => {
    await syncProjectAccessState({ closeDraftForms: true });
  };

  setGuideModalHandlers({
    onFocusSearch: () => {
      const searchInput = document.getElementById('place-search');
      if (!searchInput) return;
      const highlightTarget = searchInput.closest('.search-bar') || searchInput;
      spotlightElement(highlightTarget);
      searchInput.focus();
      searchInput.select();
    },
    onStartAddPlace: () => {
      const addBtn = document.getElementById('btn-add-place');
      if (!permissions.canSubmit || !addBtn || addBtn.style.display === 'none') {
        showToast('You currently have read-only access in this project.', 'info');
        return;
      }
      spotlightElement(addBtn);
      startAddPlaceFlow();
    },
    onRequestAccess: () => {
      void requestProjectAccess();
    }
  });

  let hasAutoCollapsedSidebar = false;
  const applyResponsiveSidebar = (queryEvent) => {
    const isMobile = queryEvent?.matches ?? mobileSidebarQuery.matches;

    if (isMobile && !hasAutoCollapsedSidebar) {
      sidebar.el.classList.add('collapsed');
      hasAutoCollapsedSidebar = true;
    } else if (!isMobile) {
      sidebar.el.classList.remove('collapsed');
      hasAutoCollapsedSidebar = false;
    }

    requestAnimationFrame(() => mapView.invalidateSize());
  };

  applyResponsiveSidebar(mobileSidebarQuery);
  if (typeof mobileSidebarQuery.addEventListener === 'function') {
    mobileSidebarQuery.addEventListener('change', applyResponsiveSidebar);
  } else {
    mobileSidebarQuery.addListener(applyResponsiveSidebar);
  }

  const warmProjectUi = () => {
    void ensurePlaceDetail();
    void ensurePlaceForm();
    void ensureEntryForm();
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warmProjectUi, { timeout: 1500 });
  } else {
    window.setTimeout(warmProjectUi, 1200);
  }

  // CSV export keyboard shortcut (Ctrl+Shift+E)
  document.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      const csv = await exportCSV(project.id);
      downloadFile(csv, `${project.name.replace(/\s+/g, '-').toLowerCase()}-export.csv`, 'text/csv');
      showToast('CSV exported', 'success');
    }
  });

  // Sidebar expand button
  if (!document.getElementById('sidebar-expand')) {
    const expandBtn = document.createElement('button');
    expandBtn.id = 'sidebar-expand';
    expandBtn.className = 'icon-btn glass-panel';
    expandBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
    expandBtn.addEventListener('click', () => sidebar.toggle());
    document.getElementById('app').appendChild(expandBtn);
  }

  // Load markers and initial rendering
  syncMarkers(mapView, sidebar.places);
  await syncTimeSliderRange(timeSlider, project.id, sidebar.entriesByPlaceId);
  updateMarkerStates(mapView, sidebar.places, sidebar.entriesByPlaceId, selectedYear);

  // Set the global for the helpers to reference if we don't pass project.id directly
  currentProject = project;
}

// ── Helpers ─────────────────────────────────────────────────

function syncMarkers(mapView, places = []) {
  mapView.syncMarkers(places);
}

function getEntryStateForYear(entries = [], year) {
  if (!entries.length) return 'none';

  const exact = entries.find((entry) => entry.yearStart <= year && (entry.yearEnd === null || entry.yearEnd >= year));
  if (exact) return 'exact';

  const hasEarlierEntry = entries.some((entry) => entry.yearStart <= year);
  if (hasEarlierEntry) return 'last_known';

  return 'before_known';
}

function updateMarkerStates(mapView, places = [], entriesByPlaceId = {}, year) {
  for (const place of places) {
    if (currentVisiblePlaceIds && !currentVisiblePlaceIds.has(place.id)) {
      mapView.setMarkerVisible(place.id, false);
      continue;
    }

    mapView.setMarkerVisible(place.id, true);

    const resultType = getEntryStateForYear(entriesByPlaceId[place.id] || [], year);
    // Dim markers that have no data for this year
    if (resultType === 'none') {
      mapView.setMarkerOpacity(place.id, 0.4);
    } else if (resultType === 'before_known' || resultType === 'last_known') {
      mapView.setMarkerOpacity(place.id, 0.65);
    } else {
      mapView.setMarkerOpacity(place.id, 1);
    }
  }
}

async function syncTimeSliderRange(timeSlider, projectId, entriesByPlaceId = null) {
  await timeSlider.setRange(projectId, { entriesByPlaceId });
  selectedYear = timeSlider.getYear();
}

async function refreshAll(mapView, sidebar, timeSlider) {
  await sidebar.loadPlaces(currentProject.id);
  syncMarkers(mapView, sidebar.places);
  await syncTimeSliderRange(timeSlider, currentProject.id, sidebar.entriesByPlaceId);
  updateMarkerStates(mapView, sidebar.places, sidebar.entriesByPlaceId, selectedYear);
}

function spotlightElement(element, durationMs = 1200) {
  if (!element) return;
  element.classList.remove('guide-highlight');
  // Force a reflow so the pulse can be replayed repeatedly.
  void element.offsetWidth;
  element.classList.add('guide-highlight');
  window.setTimeout(() => element.classList.remove('guide-highlight'), durationMs);
}

async function regeneratePlaceOverview(placeId, { force = false, apply = true, overviewText = null } = {}) {
  try {
    const place = await getPlace(placeId);
    if (!place) return { updated: false, place: null, previousDescription: '', nextDescription: '' };
    const previousDescription = (place.description || '').trim();
    if (!force && previousDescription && apply) {
      return { updated: false, place, previousDescription, nextDescription: previousDescription };
    }

    const nextDescription = (overviewText !== null && overviewText !== undefined)
      ? String(overviewText).trim()
      : (await generatePlaceOverview(place, await getTimeEntriesForPlace(placeId))).trim();

    if (nextDescription && nextDescription !== previousDescription) {
      if (!apply) {
        return { updated: true, place, previousDescription, nextDescription };
      }

      await updatePlace(placeId, { description: nextDescription });
      // Keep place updates resilient even if overview-history migration is missing.
      try {
        await createOverviewRevision({
          placeId,
          previousDescription,
          newDescription: nextDescription,
          reason: 'regenerate'
        });
      } catch (historyErr) {
        console.warn('Could not log overview revision:', historyErr);
      }
      const updated = await getPlace(placeId);
      return { updated: true, place: updated || place, previousDescription, nextDescription };
    }
    return { updated: false, place, previousDescription, nextDescription };
  } catch (err) {
    console.warn('Overview regeneration skipped:', err);
    throw err;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 300ms ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Boot
init().catch(err => {
  console.error('HistoryLens init failed:', err);
  document.body.innerHTML = `<div style="color:#f87171;padding:2rem;font-family:sans-serif;">
    <h1>HistoryLens failed to start</h1>
    <p>${err.message}</p>
  </div>`;
});
