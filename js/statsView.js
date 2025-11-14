// js/statsView.js
import { LEAGUE_IDS, MAX_WEEKS } from './constants.js';
import { cache, state } from './cache.js';
import { api } from './api.js';
import { el, fmtFab } from './dom.js';

async function fetchLeagueTransactions(leagueId) {
  if (cache.transactions.has(leagueId)) {
    return cache.transactions.get(leagueId);
  }
  const all = [];
  for (let wk = 1; wk <= MAX_WEEKS; wk++) {
    try {
      const arr = await api.transactions(leagueId, wk);
      if (Array.isArray(arr) && arr.length) {
        arr.forEach(tx => {
          tx._week = wk;
          all.push(tx);
        });
      }
    } catch (e) {
      // ignore per-week errors
    }
  }
  cache.transactions.set(leagueId, all);
  return all;
}

async function fetchLeagueMatchups(leagueId) {
  const allMatchups = [];
  // Only fetch completed weeks (current week - 1)
  // Current week is the week with scoring data, so the week before is definitely complete
  const maxWeek = state.currentWeek ? state.currentWeek - 1 : MAX_WEEKS;
  
  for (let wk = 1; wk <= maxWeek; wk++) {
    try {
      const matchups = await api.matchups(leagueId, wk);
      if (Array.isArray(matchups) && matchups.length) {
        matchups.forEach(m => {
          m._week = wk;
          allMatchups.push(m);
        });
      }
    } catch (e) {
      // ignore per-week errors
    }
  }
  
  return allMatchups;
}

function computeLeagueStats(leagueId, transactions) {
  const chops = new Map();
  const spent = new Map();
  const winningBids = [];

  transactions.forEach(tx => {
    if (tx.status !== 'complete') return;

    if (tx.type === 'chopped' && tx.drops) {
      Object.keys(tx.drops).forEach(pid => {
        chops.set(pid, (chops.get(pid) || 0) + 1);
      });
    }

    if (tx.type === 'waiver' && tx.adds && tx.settings) {
      const bid = Number(tx.settings.waiver_bid || 0);
      const week = tx.leg || tx._week || null;
      const rosterId =
        tx.roster_ids && tx.roster_ids.length
          ? Number(tx.roster_ids[0])
          : null;

      Object.keys(tx.adds).forEach(pid => {
        winningBids.push({
          playerId: pid,
          bid,
          week,
          rosterId,
          leagueId
        });

        const rec = spent.get(pid) || { total: 0, count: 0 };
        rec.total += bid;
        rec.count += 1;
        spent.set(pid, rec);
      });
    }
  });

  return { chops, spent, winningBids };
}

function getPlayerName(playersAll, playerId) {
  const p = playersAll && playersAll[playerId];
  if (!p) return `Player ${playerId}`;
  if (p.full_name) return p.full_name;
  if (p.first_name && p.last_name) {
    return `${p.first_name} ${p.last_name}`;
  }
  return p.first_name || p.last_name || `Player ${playerId}`;
}

function getLeagueName(leagueId) {
  const league = cache.leagues.get(leagueId);
  return league && league.name ? league.name : leagueId;
}

function getOwnerLabel(leagueId, rosterId) {
  if (rosterId == null) return 'Unknown';
  const rosters = cache.rosters.get(leagueId) || [];
  const roster = rosters.find(
    r => Number(r.roster_id) === Number(rosterId)
  );
  if (!roster) return 'Unknown';
  const users = cache.users.get(leagueId) || [];
  const user = users.find(u => u.user_id === roster.owner_id);
  if (!user) return 'Unknown';
  return (
    user.display_name || user.username || 'Unknown'
  );
}

function rowsFromChopsMap(map, playersAll) {
  const arr = Array.from(map.entries()).map(
    ([playerId, count]) => ({
      player: getPlayerName(playersAll, playerId),
      times: count
    })
  );
  arr.sort((a, b) => b.times - a.times);
  return arr.slice(0, 10);
}

function rowsFromSpentMap(map, playersAll) {
  const arr = Array.from(map.entries()).map(
    ([playerId, rec]) => ({
      player: getPlayerName(playersAll, playerId),
      total: rec.total,
      times: rec.count
    })
  );
  arr.sort((a, b) => b.total - a.total);
  return arr.slice(0, 10).map(r => ({
    player: r.player,
    total: fmtFab(r.total),
    times: r.times
  }));
}

function rowsFromWinningBids(bids, playersAll) {
  const sorted = bids
    .slice()
    .sort((a, b) => b.bid - a.bid)
    .slice(0, 10);
  return sorted.map(rec => ({
    player: getPlayerName(playersAll, rec.playerId),
    bid: fmtFab(rec.bid),
    by: getOwnerLabel(rec.leagueId, rec.rosterId),
    week: rec.week != null ? rec.week : '-'
  }));
}

function buildStatsTable(columns, rows) {
  const table = el('table', { class: 'stats-table' });
  const thead = el(
    'thead',
    {},
    el(
      'tr',
      {},
      ...columns.map(col =>
        el(
          'th',
          { style: `text-align:${col.align || 'left'}` },
          col.label
        )
      )
    )
  );
  table.append(thead);

  const tbody = el('tbody', {});
  if (!rows || rows.length === 0) {
    const td = el(
      'td',
      {
        class: 'stats-empty',
        colspan: String(columns.length)
      },
      'No data yet.'
    );
    tbody.append(el('tr', {}, td));
  } else {
    rows.forEach(row => {
      const tr = el('tr', {});
      columns.forEach(col => {
        tr.append(
          el(
            'td',
            { style: `text-align:${col.align || 'left'}` },
            row[col.key] != null ? row[col.key] : ''
          )
        );
      });
      tbody.append(tr);
    });
  }
  table.append(tbody);
  return table;
}

function createStatsSection(title, tables, columns) {
  const sec = el('section', { class: 'stats-section' });
  sec.append(el('h2', {}, title));
  const grid = el('div', {
    class: 'stats-table-grid'
  });
  tables.forEach(t => {
    const card = el('div', { class: 'stats-card' });
    card.append(
      el(
        'div',
        { class: 'stats-card-title' },
        t.title
      ),
      buildStatsTable(columns, t.rows)
    );
    grid.append(card);
  });
  sec.append(grid);
  return sec;
}

function buildMostChoppedSection(
  playersAll,
  statsByLeague,
  combined
) {
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    {
      title: 'All Leagues',
      rows: rowsFromChopsMap(combined.chops, playersAll)
    },
    {
      title: getLeagueName(league1Id),
      rows: rowsFromChopsMap(
        statsByLeague[league1Id].chops,
        playersAll
      )
    },
    {
      title: getLeagueName(league2Id),
      rows: rowsFromChopsMap(
        statsByLeague[league2Id].chops,
        playersAll
      )
    }
  ];
  const columns = [
    { key: 'player', label: 'Player', align: 'left' },
    { key: 'times', label: 'Times Chopped', align: 'right' }
  ];
  return createStatsSection(
    'Most Chopped',
    tables,
    columns
  );
}

function buildHighestSingleBidsSection(
  playersAll,
  statsByLeague,
  combined
) {
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    {
      title: 'All Leagues',
      rows: rowsFromWinningBids(
        combined.winningBids,
        playersAll
      )
    },
    {
      title: getLeagueName(league1Id),
      rows: rowsFromWinningBids(
        statsByLeague[league1Id].winningBids,
        playersAll
      )
    },
    {
      title: getLeagueName(league2Id),
      rows: rowsFromWinningBids(
        statsByLeague[league2Id].winningBids,
        playersAll
      )
    }
  ];
  const columns = [
    { key: 'player', label: 'Player', align: 'left' },
    { key: 'bid', label: 'Bid', align: 'right' },
    { key: 'by', label: 'By', align: 'left' },
    { key: 'week', label: 'Week', align: 'right' }
  ];
  return createStatsSection(
    'Highest Single Bids',
    tables,
    columns
  );
}

function buildMostSpentSection(
  playersAll,
  statsByLeague,
  combined
) {
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    {
      title: 'All Leagues',
      rows: rowsFromSpentMap(
        combined.spent,
        playersAll
      )
    },
    {
      title: getLeagueName(league1Id),
      rows: rowsFromSpentMap(
        statsByLeague[league1Id].spent,
        playersAll
      )
    },
    {
      title: getLeagueName(league2Id),
      rows: rowsFromSpentMap(
        statsByLeague[league2Id].spent,
        playersAll
      )
    }
  ];
  const columns = [
    { key: 'player', label: 'Player', align: 'left' },
    { key: 'total', label: 'Total Spent', align: 'right' },
    { key: 'times', label: 'Times Won', align: 'right' }
  ];
  return createStatsSection(
    'Most Spent Overall',
    tables,
    columns
  );
}

function computeNarrowestEscapes(leagueId, matchups) {
  const escapesByWeek = [];
  
  // Group matchups by week
  const weekMap = new Map();
  matchups.forEach(m => {
    // Skip eliminated teams (they have players: null)
    if (m.players === null) return;
    
    const week = m._week;
    if (!weekMap.has(week)) {
      weekMap.set(week, []);
    }
    weekMap.get(week).push(m);
  });
  
  // For each week, find the narrowest escape
  weekMap.forEach((teams, week) => {
    if (teams.length < 2) return;
    
    // Sort by points ascending
    const sorted = teams.slice().sort((a, b) => (a.points || 0) - (b.points || 0));
    const lowest = sorted[0];
    const secondLowest = sorted[1];
    
    const gap = (secondLowest.points || 0) - (lowest.points || 0);
    
    escapesByWeek.push({
      week,
      rosterId: secondLowest.roster_id,
      leagueId,
      gap,
      points: secondLowest.points || 0
    });
  });
  
  return escapesByWeek;
}

function computeHighScores(leagueId, matchups) {
  const scores = [];
  
  matchups.forEach(m => {
    // Skip eliminated teams
    if (m.players === null) return;
    
    scores.push({
      week: m._week,
      rosterId: m.roster_id,
      leagueId,
      points: m.points || 0
    });
  });
  
  return scores;
}

function rowsFromNarrowestEscapes(escapes) {
  const sorted = escapes.slice().sort((a, b) => a.gap - b.gap);
  return sorted.slice(0, 10).map(e => ({
    team: getOwnerLabel(e.leagueId, e.rosterId),
    week: e.week,
    gap: e.gap.toFixed(2) + ' pts'
  }));
}

function rowsFromHighScores(scores) {
  const sorted = scores.slice().sort((a, b) => b.points - a.points);
  return sorted.slice(0, 10).map(s => ({
    team: getOwnerLabel(s.leagueId, s.rosterId),
    week: s.week,
    points: s.points.toFixed(2)
  }));
}

function buildNarrowestEscapesSection(matchupsByLeague, combined) {
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    {
      title: 'All Leagues',
      rows: rowsFromNarrowestEscapes(combined.narrowestEscapes)
    },
    {
      title: getLeagueName(league1Id),
      rows: rowsFromNarrowestEscapes(matchupsByLeague[league1Id].narrowestEscapes)
    },
    {
      title: getLeagueName(league2Id),
      rows: rowsFromNarrowestEscapes(matchupsByLeague[league2Id].narrowestEscapes)
    }
  ];
  const columns = [
    { key: 'team', label: 'Team', align: 'left' },
    { key: 'week', label: 'Week', align: 'right' },
    { key: 'gap', label: 'Points Gap', align: 'right' }
  ];
  return createStatsSection(
    'Narrowest Escapes',
    tables,
    columns
  );
}

function buildHighScoresSection(matchupsByLeague, combined) {
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    {
      title: 'All Leagues',
      rows: rowsFromHighScores(combined.highScores)
    },
    {
      title: getLeagueName(league1Id),
      rows: rowsFromHighScores(matchupsByLeague[league1Id].highScores)
    },
    {
      title: getLeagueName(league2Id),
      rows: rowsFromHighScores(matchupsByLeague[league2Id].highScores)
    }
  ];
  const columns = [
    { key: 'team', label: 'Team', align: 'left' },
    { key: 'week', label: 'Week', align: 'right' },
    { key: 'points', label: 'Points', align: 'right' }
  ];
  return createStatsSection(
    'High Scores',
    tables,
    columns
  );
}

export async function loadStats() {
  const container = document.getElementById('stats-content');
  container.replaceChildren(
    el(
      'div',
      { class: 'loading' },
      'Loading transactions and building stats...'
    )
  );

  try {
    const playersAll = await api.playersAllNFL();
    const statsByLeague = {};
    const matchupsByLeague = {};
    const combined = {
      chops: new Map(),
      spent: new Map(),
      winningBids: [],
      narrowestEscapes: [],
      highScores: []
    };

    for (const cfg of LEAGUE_IDS) {
      const txs = await fetchLeagueTransactions(cfg.id);
      const leagueStats = computeLeagueStats(
        cfg.id,
        txs
      );
      statsByLeague[cfg.id] = leagueStats;

      leagueStats.chops.forEach(
        (count, playerId) => {
          combined.chops.set(
            playerId,
            (combined.chops.get(playerId) || 0) + count
          );
        }
      );

      leagueStats.spent.forEach(
        (rec, playerId) => {
          const cur =
            combined.spent.get(playerId) || {
              total: 0,
              count: 0
            };
          cur.total += rec.total;
          cur.count += rec.count;
          combined.spent.set(playerId, cur);
        }
      );

      combined.winningBids.push(
        ...leagueStats.winningBids
      );
      
      // Fetch and compute matchup stats
      const matchups = await fetchLeagueMatchups(cfg.id);
      const narrowestEscapes = computeNarrowestEscapes(cfg.id, matchups);
      const highScores = computeHighScores(cfg.id, matchups);
      
      matchupsByLeague[cfg.id] = {
        narrowestEscapes,
        highScores
      };
      
      combined.narrowestEscapes.push(...narrowestEscapes);
      combined.highScores.push(...highScores);
    }

    const sections = [
      buildMostChoppedSection(
        playersAll,
        statsByLeague,
        combined
      ),
      buildHighestSingleBidsSection(
        playersAll,
        statsByLeague,
        combined
      ),
      buildMostSpentSection(
        playersAll,
        statsByLeague,
        combined
      ),
      buildNarrowestEscapesSection(
        matchupsByLeague,
        combined
      ),
      buildHighScoresSection(
        matchupsByLeague,
        combined
      )
    ];
    container.replaceChildren(...sections);
  } catch (err) {
    container.replaceChildren(
      el(
        'div',
        { class: 'err' },
        'Failed to load stats: ' + err.message
      )
    );
  }
}
