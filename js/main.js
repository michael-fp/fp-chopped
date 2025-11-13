// js/main.js
import {
  setupLeagueTabs,
  initLeagues,
  updateResponsiveLayout
} from './teamsView.js';
import { setPrimaryTab } from './tabs.js';
import { clearPlayersCache } from './api.js';

// Expose to window ONLY IF your HTML still has inline handlers.
// After we remove inline handlers, only setPrimaryTab MUST remain.
window.setPrimaryTab = setPrimaryTab;

async function initApp() {
  // Set up league tabs
  setupLeagueTabs();

  // Load leagues
  await initLeagues();

  // Initial responsive layout
  updateResponsiveLayout();
  window.addEventListener('resize', updateResponsiveLayout);

  // Attach event listener to Refresh Player Directory button
  const refreshBtn = document.getElementById('refresh-player-dir');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', clearPlayersCache);
  }
}

initApp();
