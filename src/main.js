import './styles/index.css';
import 'leaflet/dist/leaflet.css';

import {
  getOrCreateDefaultProject,
  updateProject,
  createPlace,
  createTimeEntry,
  updateTimeEntry,
  getPlacesByProject,
  getSession,
  signOut,
  onAuthStateChange,
  getProject,
  getUserRole,
  updateProfile,
  getProfiles,
  exportProjectGeoJSON
} from './data/store.js';

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
import CollaboratorsModal from './components/CollaboratorsModal.js';

// ── App State ──────────────────────────────────────────────
let currentProject = null;
let currentUser = null;
let selectedYear = new Date().getFullYear();
let currentVisiblePlaceIds = null; // null means all are visible

// ── Init ───────────────────────────────────────────────────
async function init() {
  const authModal = new AuthModal();
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

    // Refresh dashboard if it's currently showing
    if (!currentProject && window.dashboardComponent) {
      window.dashboardComponent.show(user);
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
      alert("Project not found or private.");
      window.location.href = '/';
    }
  } else {
    // Show Dashboard or Landing Page Context
    const dashboard = new Dashboard({
      onSelectProject: (id) => {
        window.location.search = `?project=${id}`;
      },
      onAuthRequest: () => {
        authModal.show({
          onSuccess: (user) => {
            showToast(`Signed in as ${user.email}`, 'success');
            // If they just signed in and are on landing page, maybe bounce them to dashboard
            if (window.landingComponent && !currentProject) {
              window.landingComponent.hide();
              window.dashboardComponent.show(user);
            }
          }
        });
      }
    });
    window.dashboardComponent = dashboard;

    // Create landing page
    const landing = new LandingPage({
      onExplore: () => {
        landing.hide();
        dashboard.show(currentUser);
      },
      onAuthRequest: () => {
        authModal.show({
          onSuccess: (user) => {
            showToast(`Signed in as ${user.email}`, 'success');
            landing.hide();
            dashboard.show(user);
          }
        });
      }
    });
    window.landingComponent = landing;

    if (currentUser) {
      dashboard.show(currentUser);
    } else {
      landing.show();
    }
  }
}

async function initProjectView(project) {
  const currentUserRole = currentUser ? await getUserRole(project.id) : null;
  const isReadOnly = !currentUserRole || currentUserRole === 'pending' || (currentUserRole !== 'owner' && currentUserRole !== 'editor' && currentUserRole !== 'admin');

  // Map
  const mapView = new MapView('map-container', {
    centre: project.centre,
    zoom: project.defaultZoom,
    onMapClick: (latlng) => {
      if (isReadOnly) return;
      mapView.setAddMode(false);
      placeForm.show(latlng);
    },
    onMarkerClick: (place) => {
      sidebar.setActive(place.id);
      placeDetail.show(place, isReadOnly, currentUser, currentUserRole);
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

  // Sidebar
  const sidebar = new Sidebar({
    onPlaceClick: (place) => {
      mapView.panTo(place.lat, place.lng);
      placeDetail.show(place);
    },
    onFilterChange: (visibleIds) => {
      currentVisiblePlaceIds = new Set(visibleIds);
      updateMarkerStates(mapView, project.id, selectedYear);
    },
    onAddPlace: () => {
      mapView.setAddMode(true);
      showToast('Click on the map to place a marker', 'info');
    },
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
    onManageCollaborators: () => {
      const collabModal = new CollaboratorsModal();
      collabModal.showManage(project.id, currentUserRole);
    },
    onRequestAccess: () => {
      if (!currentUser) {
        showToast('Please sign in first to request access', 'info');
        const authModal = new AuthModal();
        authModal.show({
          onSuccess: () => {
            const collabModal = new CollaboratorsModal();
            collabModal.showRequestAccess(project.id, () => {
              showToast('Access request sent!', 'success');
            });
          }
        });
        return;
      }
      const collabModal = new CollaboratorsModal();
      collabModal.showRequestAccess(project.id, () => {
        showToast('Access request sent!', 'success');
      });
    },
    onSetCentre: async () => {
      const centre = mapView.map.getCenter();
      const zoom = mapView.map.getZoom();
      currentProject = await updateProject(project.id, {
        centre: { lat: centre.lat, lng: centre.lng },
        defaultZoom: zoom
      });
      showToast(`Map centre set to ${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)} (zoom ${zoom})`, 'success');
    }
  });
  sidebar.setProject(project, isReadOnly, currentUserRole);
  await sidebar.loadPlaces(project.id);

  // Place detail
  const placeDetail = new PlaceDetail({
    onAddEntry: (place) => {
      entryForm.show(place);
    },
    onEditEntry: (place, entry) => {
      entryForm.show(place, entry);
    },
    onDeletePlace: async (place) => {
      mapView.removeMarker(place.id);
      await refreshAll(mapView, sidebar, timeSlider);
      showToast(`"${place.name}" deleted`, 'success');
    },
    onClose: () => { }
  });

  // Place form
  const placeForm = new PlaceForm({
    mapView,
    onSave: async ({ name, category, lat, lng, autoEntries }) => {
      const place = await createPlace({
        projectId: project.id,
        name, lat, lng, category
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

      await sidebar.loadPlaces(project.id);
      await timeSlider.setRange(project.id);
      const entryCount = autoEntries?.length || 0;
      showToast(`"${name}" added${entryCount > 0 ? ` with ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'}` : ''}`, 'success');
    },
    onCancel: () => {
      mapView.setAddMode(false);
    }
  });

  // Entry form
  const entryForm = new EntryForm({
    onSave: async (data) => {
      let savedEntry;
      if (data.entryId) {
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
        showToast('Entry updated', 'success');
      } else {
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
          await addImage({
            timeEntryId: savedEntry.id,
            blob: img.blob,
            caption: img.caption,
            yearTaken: img.yearTaken,
            credit: img.credit
          });
        }
        showToast('Entry added', 'success');
      }

      await timeSlider.setRange(project.id);
      await sidebar.loadPlaces(project.id);

      // Refresh detail if open
      const place = await getPlacesByProject(project.id).then(places => places.find(p => p.id === data.placeId));
      if (place) placeDetail.show(place, isReadOnly, currentUser, currentUserRole);
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
