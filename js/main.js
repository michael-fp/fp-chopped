// js/main.js
import {
  setupLeagueTabs,
  initLeagues,
  updateResponsiveLayout
} from './teamsView.js';
import { setPrimaryTab } from './tabs.js';
import { clearPlayersCache } from './api.js';

// expose for inline onclick handlers in index.html
window.setPrimaryTab = setPrimaryTab;
window.clearPlayersCache = clearPlayersCache;

async function initApp() {
  setupLeagueTabs();
  await initLeagues();
  updateResponsiveLayout();
  window.addEventListener('resize', updateResponsiveLayout);
}

initApp();
