// js/cache.js
export const cache = {
  leagues: new Map(),
  rosters: new Map(),
  users: new Map(),
  playersAll: null,
  transactions: new Map(),
  matchups: new Map()
};

export const state = {
  activeLeagueIndex: 0,
  activePrimaryTab: 'teams',
  statsLoaded: false,
  fabSpendingLoaded: false,
  currentWeek: null  // Dynamically detected current NFL week (max of scoring week and transaction week)
};
