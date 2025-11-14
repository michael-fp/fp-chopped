// js/api.js
import {
  PLAYERS_TTL_DAYS,
  PLAYERS_IDB_DB,
  PLAYERS_IDB_STORE,
  PLAYERS_IDB_KEY
} from './constants.js';
import { cache } from './cache.js';

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

// IndexedDB helpers
function openIdb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(PLAYERS_IDB_DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(PLAYERS_IDB_STORE)) {
        db.createObjectStore(PLAYERS_IDB_STORE);
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}

async function idbGet(key) {
  try {
    const db = await openIdb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(PLAYERS_IDB_STORE, 'readonly');
      const store = tx.objectStore(PLAYERS_IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openIdb();
    await new Promise((res, rej) => {
      const tx = db.transaction(PLAYERS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(PLAYERS_IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {}
}

async function idbDelete(key) {
  try {
    const db = await openIdb();
    await new Promise((res, rej) => {
      const tx = db.transaction(PLAYERS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(PLAYERS_IDB_STORE);
      store.delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {}
}

export const api = {
  league: leagueId => getJSON(`https://api.sleeper.app/v1/league/${leagueId}`),
  rosters: leagueId =>
    getJSON(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
  leagueUsers: leagueId =>
    getJSON(`https://api.sleeper.app/v1/league/${leagueId}/users`),
  playersAllNFL: async () => {
    if (cache.playersAll) return cache.playersAll;

    const ttlMs = PLAYERS_TTL_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const stored = await idbGet(PLAYERS_IDB_KEY);
    if (
      stored &&
      stored.data &&
      stored.savedAt &&
      now - stored.savedAt < ttlMs
    ) {
      cache.playersAll = stored.data;
      return cache.playersAll;
    }

    const data = await getJSON('https://api.sleeper.app/v1/players/nfl');
    cache.playersAll = data;
    idbSet(PLAYERS_IDB_KEY, { savedAt: now, data });
    return data;
  },
  transactions: (leagueId, week) =>
    getJSON(
      `https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`
    ),
  matchups: (leagueId, week) =>
    getJSON(
      `https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`
    ),

  /**
   * Detects the current NFL week by finding the most recent week with scoring
   * Since Sleeper creates matchups for all future weeks, we use scoring data to determine the actual current week
   * @param {string} leagueId - Sleeper league ID to check
   * @param {number} maxWeek - Maximum week to check (default 18)
   * @returns {Promise<{currentWeek: number, scoringWeek: number}>}
   */
  async detectWeeks(leagueId, maxWeek = 18) {
    let currentWeek = 1;
    
    // Check weeks in reverse order to find the most recent week with scoring
    for (let week = maxWeek; week >= 1; week--) {
      try {
        const matchups = await getJSON(
          `https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`
        );
        
        // Check if any team has points > 0 (indicates week has started/completed)
        const hasScoring = matchups.some(m => m.points && m.points > 0);
        if (hasScoring) {
          currentWeek = week;
          break; // Found the current week
        }
      } catch (e) {
        // Week doesn't exist, continue checking earlier weeks
        continue;
      }
    }
    
    // Both currentWeek and scoringWeek are the same (most recent week with scoring)
    return { currentWeek, scoringWeek: currentWeek };
  }
};

// used by footer button
export async function clearPlayersCache() {
  cache.playersAll = null;
  await idbDelete(PLAYERS_IDB_KEY);
  alert(
    'Player directory cache cleared. It will re-download the next time you open a team.'
  );
}
