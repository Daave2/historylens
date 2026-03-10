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
  getBestEntryForYear,
  getTimeEntriesForPlace,
  updatePlace,
  getPlacesByProject,
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
import PlaceDetail from './components/PlaceDetail.js';
import PlaceForm from './components/PlaceForm.js';
import EntryForm from './components/EntryForm.js';
import MapOverlay from './components/MapOverlay.js';
import AuthModal from './components/AuthModal.js';
import ProfileModal from './components/ProfileModal.js';
import Dashboard from './components/Dashboard.js';
import LandingPage from './components/LandingPage.js';
import ProjectSettings from './components/ProjectSettings.js';
import GuideModal from './components/GuideModal.js';

// ── App State ──────────────────────────────────────────────
let currentProject = null;
let currentUser = null;
let selectedYear = new Date().getFullYear();
let currentVisiblePlaceIds = null; // null means all are visible
let guideModal = null;
const GUIDE_STORAGE = {
  seen: 'historylens.quick-guide.shown.v1',
  auto: 'historylens.quick-guide.auto.v1'
};

function isAutoGuideEnabled() {
  try {
    return localStorage.getItem(GUIDE_STORAGE.auto) !== '0';
  } catch {
    return true;
  }
}

function setAutoGuideEnabled(enabled) {
  try {
    localStorage.setItem(GUIDE_STORAGE.auto, enabled ? '1' : '0');
  } catch {
    // Ignore storage write issues.
  }
}

function resetGuideSeenState() {
  try {
    localStorage.removeItem(GUIDE_STORAGE.seen);
  } catch {
    // Ignore storage write issues.
  }
}

// ── Init ───────────────────────────────────────────────────
async function init() {
  const authModal = new AuthModal();
  guideModal = new GuideModal();
  let maybeAutoOpenDashboardGuide = () => { };
  let hasAutoGuideShown = false;

  const profileModal = new ProfileModal({
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
  });

  const authBtn = document.getElementById('btn-auth');
  const profileBtn = document.getElementById('btn-profile');

  // Initialize Auth state
  const session = await getSession();
  currentUser = session?.user || null;
  updateAuthUI(currentUser);

  onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    updateAuthUI(currentUser);
  });

  authBtn.addEventListener('click', async () => {
    if (currentUser) {
      await signOut();
      showToast('Signed out successfully', 'info');
    } else {
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
        maybeAutoOpenDashboardGuide();
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
  const urlParams = new URLSearchParams(window.location.search);
  const projectIdParam = urlParams.get('project');

  if (projectIdParam) {
    try {
      currentProject = await getProject(projectIdParam);
      if (!currentProject) throw new Error("Project not found");
      initProjectView(currentProject);
    } catch (err) {
      console.error(err);
      showToast('Project not found or private. Redirecting to home…', 'error');
      window.setTimeout(() => {
        window.location.href = import.meta.env.BASE_URL || '/';
      }, 1200);
    }
  } else {
    const requestAuthFromHome = () => {
      authModal.show({
        onSuccess: (user) => {
          showToast(`Signed in as ${user.email}`, 'success');
          if (window.landingComponent && !currentProject) {
            window.landingComponent.hide();
            window.dashboardComponent.show(user);
            maybeAutoOpenDashboardGuide();
          }
        }
      });
    };

    // Show Dashboard or Landing Page Context
    const dashboard = new Dashboard({
      onSelectProject: (id) => {
        window.location.search = `?project=${id}`;
      },
      onAuthRequest: requestAuthFromHome,
      onGuideRequest: () => {
        guideModal.showDashboard({
          isSignedIn: !!currentUser,
          autoGuideEnabled: isAutoGuideEnabled()
        });
      }
    });
    window.dashboardComponent = dashboard;

    maybeAutoOpenDashboardGuide = () => {
      if (hasAutoGuideShown) return;
      if (!isAutoGuideEnabled()) return;
      try {
        if (localStorage.getItem(GUIDE_STORAGE.seen)) {
          hasAutoGuideShown = true;
          return;
        }
        localStorage.setItem(GUIDE_STORAGE.seen, '1');
      } catch {
        // Ignore localStorage access issues.
      }
      hasAutoGuideShown = true;

      setTimeout(() => {
        if (!currentProject && dashboard.container?.style.display !== 'none') {
          guideModal.showDashboard({
            isSignedIn: !!currentUser,
            autoGuideEnabled: isAutoGuideEnabled()
          });
        }
      }, 300);
    };

    guideModal.setHandlers({
      onSwitchDashboardTab: (tab) => {
        dashboard.setTab(tab);
        const targetBtn = dashboard.container.querySelector(`.tab-btn[data-tab="${tab}"]`);
        spotlightElement(targetBtn);
      },
      onAuthRequest: requestAuthFromHome,
      onToggleAutoGuide: (enabled) => {
        setAutoGuideEnabled(enabled);
        showToast(enabled ? 'Auto guide turned on' : 'Auto guide turned off', 'info');
      },
      onResetGuide: () => {
        resetGuideSeenState();
        hasAutoGuideShown = false;
        showToast('Onboarding reset. It will auto-open on next dashboard visit.', 'success');
      }
    });

    // Create landing page
    const landing = new LandingPage({
      onExplore: () => {
        landing.hide();
        dashboard.show(currentUser);
        maybeAutoOpenDashboardGuide();
      },
      onAuthRequest: requestAuthFromHome
    });
    window.landingComponent = landing;

    if (currentUser) {
      dashboard.show(currentUser);
      maybeAutoOpenDashboardGuide();
    } else {
      landing.show();
    }
  }
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
  let currentUserRole = currentUser ? await getUserRole(project.id) : null;
  let permissions = getRolePermissions(currentUserRole);
  const mobileSidebarQuery = window.matchMedia('(max-width: 900px)');
  let sidebar = null;
  let placeDetail = null;
  let placeForm = null;
  let entryForm = null;

  const applyRoleChange = (nextRole) => {
    currentUserRole = nextRole;
    permissions = getRolePermissions(currentUserRole);
    if (sidebar) sidebar.setProject(currentProject, permissions, currentUserRole);
  };

  const showPlaceDetail = (place) => {
    if (!placeDetail) return;
    placeDetail.show(
      place,
      permissions.isReadOnly,
      currentUser,
      currentUserRole,
      permissions.canSubmit && !permissions.canEditPublished
    );
  };

  // Map
  const mapView = new MapView('map-container', {
    centre: project.centre,
    zoom: project.defaultZoom,
    onMapClick: (latlng) => {
      if (!permissions.canSubmit) return;
      if (!placeForm) return;
      mapView.setAddMode(false);
      placeForm.show(latlng, { suggestionMode: !permissions.canEditPublished });
    },
    onMarkerClick: (place) => {
      sidebar.setActive(place.id);
      placeDetail.activeTab = 'overview';
      showPlaceDetail(place);
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
  const hoverCard = new HoverCard();

  // Time slider
  const timeSlider = new TimeSlider({
    onYearChange: (year) => {
      selectedYear = year;
      // Refresh marker opacities based on data availability
      updateMarkerStates(mapView, project.id, year);
    }
  });
  await timeSlider.setRange(project.id);

  const startAddPlaceFlow = () => {
    if (!permissions.canSubmit) return false;
    mapView.setAddMode(true);
    const actionLabel = permissions.canEditPublished ? 'place a marker' : 'suggest a place for review';
    showToast(`Click on the map to ${actionLabel}`, 'info');
    return true;
  };

  // Sidebar
  sidebar = new Sidebar({
    onPlaceClick: (place) => {
      mapView.panTo(place.lat, place.lng);
      placeDetail.activeTab = 'overview';
      showPlaceDetail(place);
      if (mobileSidebarQuery.matches) {
        sidebar.el.classList.add('collapsed');
      }
    },
    onFilterChange: (visibleIds) => {
      currentVisiblePlaceIds = new Set(visibleIds);
      updateMarkerStates(mapView, project.id, selectedYear);
    },
    onAddPlace: () => startAddPlaceFlow(),
    onImport: async () => {
      try {
        const data = await readFileAsJSON();
        const result = await importBundle(data);
        showToast(`Imported ${result.placesImported} places and ${result.entriesImported} entries`, 'success');
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
    onProjectSettings: () => {
      const settingsModal = new ProjectSettings();
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
    onRequestAccess: () => {
      const handleAccessRequestResult = (result) => {
        const nextRole = result?.role || 'pending';
        applyRoleChange(nextRole);
      };

      if (!currentUser) {
        const authModal = new AuthModal();
        authModal.show({
          onSuccess: () => {
            const settingsModal = new ProjectSettings();
            settingsModal.showRequestAccess(currentProject.id, handleAccessRequestResult);
          }
        });
        return;
      }
      const settingsModal = new ProjectSettings();
      settingsModal.showRequestAccess(currentProject.id, handleAccessRequestResult);
    },
    onGuide: () => {
      guideModal?.showProject({
        canSubmit: permissions.canSubmit,
        canEditPublished: permissions.canEditPublished
      });
    }
  });
  sidebar.setProject(project, permissions, currentUserRole);
  await sidebar.loadPlaces(project.id);

  guideModal?.setHandlers({
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

  // Place detail
  placeDetail = new PlaceDetail({
    onAddEntry: (place) => {
      if (!entryForm) return;
      entryForm.show(place, null, { suggestionMode: !permissions.canEditPublished });
    },
    onEditEntry: (place, entry) => {
      if (!entryForm) return;
      entryForm.show(place, entry);
    },
    onDeletePlace: async (place) => {
      mapView.removeMarker(place.id);
      await refreshAll(mapView, sidebar, timeSlider);
      showToast(`"${place.name}" deleted`, 'success');
    },
    onRegenerateOverview: async (placeId) => {
      return regeneratePlaceOverview(placeId, { force: true });
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
        const refreshed = await getPlace(place.id);
        if (refreshed) showPlaceDetail(refreshed);
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
    onClose: () => { }
  });

  // Place form
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
        await timeSlider.setRange(project.id);
        const entryCount = autoEntries?.length || 0;
        showToast(`"${name}" added${entryCount > 0 ? ` with ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}` : ''}`, 'success');
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

  // Entry form
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

      await timeSlider.setRange(project.id);
      await sidebar.loadPlaces(project.id);

      // Refresh detail if open
      const place = await getPlacesByProject(project.id).then(places => places.find(p => p.id === data.placeId));
      if (place) {
        // Keep overview as default generally, but jump to timeline after image uploads
        placeDetail.activeTab = data.images?.length ? 'timeline' : 'overview';
        showPlaceDetail(place);
      }
    },
    onCancel: () => { }
  });

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
    expandBtn.style.position = 'absolute';
    expandBtn.style.left = 'var(--space-md)';
    expandBtn.style.top = 'var(--space-md)';
    expandBtn.style.zIndex = '900';
    expandBtn.addEventListener('click', () => sidebar.toggle());
    document.getElementById('app').appendChild(expandBtn);
  }

  // Load markers and initial rendering
  await loadMarkers(mapView, project.id);
  await timeSlider.setRange(project.id);
  updateMarkerStates(mapView, project.id, selectedYear);

  // Set the global for the helpers to reference if we don't pass project.id directly
  currentProject = project;
}

// ── Helpers ─────────────────────────────────────────────────

async function loadMarkers(mapView, projectId) {
  const places = await getPlacesByProject(projectId);
  mapView.clearMarkers();
  for (const place of places) {
    mapView.addMarker(place);
  }
}

async function updateMarkerStates(mapView, projectId, year) {
  const places = await getPlacesByProject(projectId);
  for (const place of places) {
    if (currentVisiblePlaceIds && !currentVisiblePlaceIds.has(place.id)) {
      mapView.setMarkerVisible(place.id, false);
      continue;
    }

    mapView.setMarkerVisible(place.id, true);

    const result = await getBestEntryForYear(place.id, year);
    // Dim markers that have no data for this year
    if (result.type === 'none') {
      mapView.setMarkerOpacity(place.id, 0.4);
    } else if (result.type === 'before_known' || result.type === 'last_known') {
      mapView.setMarkerOpacity(place.id, 0.65);
    } else {
      mapView.setMarkerOpacity(place.id, 1);
    }
  }
}

async function refreshAll(mapView, sidebar, timeSlider) {
  await loadMarkers(mapView, currentProject.id);
  await sidebar.loadPlaces(currentProject.id);
  await timeSlider.setRange(currentProject.id);
}

function spotlightElement(element, durationMs = 1200) {
  if (!element) return;
  element.classList.remove('guide-highlight');
  // Force a reflow so the pulse can be replayed repeatedly.
  void element.offsetWidth;
  element.classList.add('guide-highlight');
  window.setTimeout(() => element.classList.remove('guide-highlight'), durationMs);
}

async function regeneratePlaceOverview(placeId, { force = false } = {}) {
  try {
    const place = await getPlace(placeId);
    if (!place) return { updated: false, place: null, previousDescription: '' };
    const previousDescription = (place.description || '').trim();
    if (!force && previousDescription) {
      return { updated: false, place, previousDescription };
    }

    const entries = await getTimeEntriesForPlace(placeId);
    const overview = await generatePlaceOverview(place, entries);
    if (overview && overview.trim() && overview.trim() !== previousDescription) {
      await updatePlace(placeId, { description: overview });
      // Keep place updates resilient even if overview-history migration is missing.
      try {
        await createOverviewRevision({
          placeId,
          previousDescription,
          newDescription: overview,
          reason: 'regenerate'
        });
      } catch (historyErr) {
        console.warn('Could not log overview revision:', historyErr);
      }
      const updated = await getPlace(placeId);
      return { updated: true, place: updated || place, previousDescription };
    }
    return { updated: false, place, previousDescription };
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
