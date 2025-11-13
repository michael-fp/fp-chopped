// js/tabs.js
import { state } from './cache.js';
import { loadStats } from './statsView.js';
import { loadFABSpending } from './fabSpendingView.js';

export function setPrimaryTab(tab) {
  state.activePrimaryTab = tab;
  const teamsView = document.getElementById('teams-view');
  const fabSpendingView = document.getElementById('fab-spending-view');
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
  fabSpendingView.style.display =
    tab === 'fab-spending' ? '' : 'none';
  statsView.style.display =
    tab === 'stats' ? '' : 'none';

  if (tab === 'fab-spending' && !state.fabSpendingLoaded) {
    state.fabSpendingLoaded = true;
    loadFABSpending();
  }

  if (tab === 'stats' && !state.statsLoaded) {
    state.statsLoaded = true;
    loadStats();
  }
}
