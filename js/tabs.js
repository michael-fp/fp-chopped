// js/tabs.js
import { state } from './cache.js';
import { loadStats } from './statsView.js';

export function setPrimaryTab(tab) {
  state.activePrimaryTab = tab;
  const teamsView = document.getElementById('teams-view');
  const statsView = document.getElementById('stats-view');

  document
    .querySelectorAll('.primary-tab')
    .forEach(btn => {
      btn.classList.toggle(
        'active',
        btn.dataset.tab === tab
      );
    });

  teamsView.style.display =
    tab === 'teams' ? '' : 'none';
  statsView.style.display =
    tab === 'stats' ? '' : 'none';

  if (tab === 'stats' && !state.statsLoaded) {
    state.statsLoaded = true;
    loadStats();
  }
}
