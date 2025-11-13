// js/cache.js
export const cache = {
  leagues: new Map(),
  rosters: new Map(),
  users: new Map(),
  playersAll: null,
  transactions: new Map()
};

export const state = {
  activeLeagueIndex: 0,
  activePrimaryTab: 'teams',
  statsLoaded: false
};
