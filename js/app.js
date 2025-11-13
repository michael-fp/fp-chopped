const LEAGUE_IDS = [
  { id: '1262120211746656256', label: 'League A' },
  { id: '1262120355430928384', label: 'League B' }
];

const PLAYERS_TTL_DAYS = 10;
const PLAYERS_IDB_DB = 'chopped-idb';
const PLAYERS_IDB_STORE = 'kv';
const PLAYERS_IDB_KEY = 'players_nfl_v1';
const MAX_WEEKS = 18;

const POSITION_COLORS = {
  QB: '#ff2a6d',
  RB: '#00ceb8',
  WR: '#58a7ff',
  TE: '#ffae58'
};

const $ = (sel, el=document) => el.querySelector(sel);
const el = (tag, attrs={}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k==='class') n.className=v;
    else if(k==='html') n.innerHTML=v;
    else if(k.startsWith('on') && typeof v==='function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k,v);
  });
  kids.forEach(k=> n.append(k));
  return n;
};
const fmtFab = (x) => `$${x.toLocaleString()}`;

const cache = {
  leagues: new Map(),
  rosters: new Map(),
  users: new Map(),
  playersAll: null,
  transactions: new Map()
};

let activeLeagueIndex = 0;
let activePrimaryTab = 'teams';
let statsLoaded = false;

async function getJSON(url){
  const res = await fetch(url, { headers: { 'Accept':'application/json' }});
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

/* IndexedDB helpers for players blob */
function openIdb(){
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

async function idbGet(key){
  try{
    const db = await openIdb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(PLAYERS_IDB_STORE, 'readonly');
      const store = tx.objectStore(PLAYERS_IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  }catch(e){
    return null;
  }
}

async function idbSet(key, value){
  try{
    const db = await openIdb();
    await new Promise((res, rej) => {
      const tx = db.transaction(PLAYERS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(PLAYERS_IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }catch(e){}
}

async function idbDelete(key){
  try{
    const db = await openIdb();
    await new Promise((res, rej) => {
      const tx = db.transaction(PLAYERS_IDB_STORE, 'readwrite');
      const store = tx.objectStore(PLAYERS_IDB_STORE);
      store.delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }catch(e){}
}

const api = {
  league: (leagueId) => getJSON(`https://api.sleeper.app/v1/league/${leagueId}`),
  rosters: (leagueId) => getJSON(`https://api.sleeper.app/v1/league/${leagueId}/rosters`),
  leagueUsers: (leagueId) => getJSON(`https://api.sleeper.app/v1/league/${leagueId}/users`),
  playersAllNFL: async () => {
    if (cache.playersAll) return cache.playersAll;
    const ttlMs = PLAYERS_TTL_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const stored = await idbGet(PLAYERS_IDB_KEY);
    if (stored && stored.data && stored.savedAt && (now - stored.savedAt) < ttlMs) {
      cache.playersAll = stored.data;
      return cache.playersAll;
    }
    const data = await getJSON('https://api.sleeper.app/v1/players/nfl');
    cache.playersAll = data;
    idbSet(PLAYERS_IDB_KEY, { savedAt: now, data });
    return data;
  },
  transactions: (leagueId, week) => getJSON(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`)
};

function mapUsersByOwnerId(users){
  const m = new Map();
  users.forEach(u => {
    m.set(u.user_id, {
      user_id: u.user_id,
      username: u.username,
      display_name: u.display_name,
      team_name: u.metadata && (u.metadata.team_name || u.metadata.team_name_full) || null,
      avatar: u.avatar || null
    });
  });
  return m;
}

const columnsEl = document.getElementById('columns');
const tabsEl = document.getElementById('league-tabs');

function setupTabs(){
  LEAGUE_IDS.forEach((cfg, index) => {
    const btn = el('button', {
      class: 'tab-btn' + (index === activeLeagueIndex ? ' active' : ''),
      onclick: () => setActiveLeague(index)
    }, cfg.label || `League ${index+1}`);
    btn.dataset.index = index;
    tabsEl.append(btn);
  });
}

function setActiveLeague(index){
  activeLeagueIndex = index;
  const cols = columnsEl.querySelectorAll('.col');
  cols.forEach(col => {
    col.dataset.active = (Number(col.dataset.index) === index).toString();
  });
  tabsEl.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.index) === index);
  });
}

function updateResponsiveLayout(){
  if (window.innerWidth < 980){
    columnsEl.classList.add('single-column');
    tabsEl.style.display = 'flex';
    setActiveLeague(activeLeagueIndex);
  } else {
    columnsEl.classList.remove('single-column');
    tabsEl.style.display = 'none';
  }
}

/* Primary tab switching */
function setPrimaryTab(tab){
  activePrimaryTab = tab;
  const teamsView = document.getElementById('teams-view');
  const statsView = document.getElementById('stats-view');
  document.querySelectorAll('.primary-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  teamsView.style.display = tab === 'teams' ? '' : 'none';
  statsView.style.display = tab === 'stats' ? '' : 'none';

  if (tab === 'stats' && !statsLoaded){
    loadStats();
  }
}

async function init(){
  setupTabs();

  for(const [i, leagueCfg] of LEAGUE_IDS.entries()){
    const col = renderColumnSkeleton(i);
    columnsEl.append(col);

    try{
      const [league, rosters, users] = await Promise.all([
        cache.leagues.get(leagueCfg.id) || api.league(leagueCfg.id),
        cache.rosters.get(leagueCfg.id) || api.rosters(leagueCfg.id),
        cache.users.get(leagueCfg.id)   || api.leagueUsers(leagueCfg.id)
      ]);
      cache.leagues.set(leagueCfg.id, league);
      cache.rosters.set(leagueCfg.id, rosters);
      cache.users.set(leagueCfg.id, users);

      const tabBtn = tabsEl.querySelector(`.tab-btn[data-index="${i}"]`);
      if (tabBtn && league.name) tabBtn.textContent = league.name;

      mountLeagueView(col, leagueCfg.id, league, rosters, users);
    }catch(err){
      col.replaceChildren(
        columnHeader('Error'),
        el('div',{class:'view'},
          el('div',{class:'err'}, `Failed to load league ${leagueCfg.id}. ${err.message}`)
        )
      );
    }
  }

  updateResponsiveLayout();
  window.addEventListener('resize', updateResponsiveLayout);
}

/* Teams tab rendering */
function renderColumnSkeleton(index){
  const c = el('div', {class:'col'});
  c.dataset.index = index;
  c.dataset.active = (index === activeLeagueIndex).toString();
  c.append(
    columnHeader('Loading'),
    el('div',{class:'view'},
      el('div',{class:'loading'}, 'Fetching league data...'))
  );
  return c;
}

function columnHeader(title, season){
  const hdr = el('div', {class:'col-header'});
  hdr.append(
    el('div',{class:'league-pill'}, title),
    season ? el('div',{class:'small'}, season) : el('span')
  );
  return hdr;
}

function mountLeagueView(container, leagueId, league, rosters, users){
  container.replaceChildren(
    columnHeader(league.name || 'League', `Season ${league.season}`),
    el('div', {class:'view'}, buildTeamList(container, leagueId, league, rosters, users))
  );
}

function buildTeamList(container, leagueId, league, rosters, users){
  const waiverCap = Number(league.settings && league.settings.waiver_budget || 0);
  const usersById = mapUsersByOwnerId(users);
  const active = rosters.filter(r => !(r.settings && Object.prototype.hasOwnProperty.call(r.settings,'eliminated')));

  active.sort((a,b)=>{
    const aRem = waiverCap - Number(a.settings && a.settings.waiver_budget_used || 0);
    const bRem = waiverCap - Number(b.settings && b.settings.waiver_budget_used || 0);
    return bRem - aRem;
  });

  const list = el('div',{class:'list'});

  active.forEach(r=>{
    const u = usersById.get(r.owner_id) || {};
    const teamName = u.team_name || u.display_name || 'Team';
    const username = u.username ? `@${u.username}` : '';
    const remaining = Math.max(0, waiverCap - Number(r.settings && r.settings.waiver_budget_used || 0));
    const initials = (teamName || 'T').split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();

    let avatarNode;
    if (u.avatar){
      const src = `https://sleepercdn.com/avatars/thumbs/${u.avatar}`;
      avatarNode = el('div',{class:'avatar'},
        el('img',{class:'avatar-img', src, alt:teamName})
      );
    } else {
      avatarNode = el('div',{class:'avatar','aria-hidden':'true'}, initials);
    }

    const row = el(
      'div',
      {
        class:'row',
        role:'button',
        tabindex:'0',
        onclick:()=> mountTeamView(container, leagueId, league, r, usersById),
        onkeydown:(e)=>{ if(e.key==='Enter' || e.key===' ') row.click(); }
      },
      avatarNode,
      el('div',{},
        el('div',{class:'title'}, teamName),
        el('div',{class:'meta'}, username)
      ),
      el('div',{},
        el('div',{class:'fab'}, fmtFab(remaining)),
        el('div',{class:'cap muted', style:'text-align:right'}, 'FAB left')
      )
    );
    list.append(row);
  });

  if(active.length===0){
    list.append(el('div',{class:'empty'}, 'No active teams.'));
  }
  return list;
}

async function mountTeamView(container, leagueId, league, roster, usersById){
  const user = usersById.get(roster.owner_id) || {};
  const teamName = user.team_name || user.display_name || 'Team';
  const header = columnHeader(league.name || 'League', `Season ${league.season}`);

  const view = el('div',{class:'view'});
  const head = el('div',{class:'team-head'},
    el('button',{
      class:'btn',
      onclick:()=> mountLeagueView(container, leagueId, league, cache.rosters.get(leagueId), cache.users.get(leagueId))
    }, '← Back'),
    el('div',{class:'team-name'}, teamName),
    el('div',{class:'muted'}, user.username ? `@${user.username}` : '')
  );
  view.append(head, el('div',{class:'loading'}, 'Loading players...'));
  container.replaceChildren(header, view);

  try{
    const playersAll = await api.playersAllNFL();
    const startersIds = (roster.starters || []).filter(id => id && id !== "0");
    const allIds = (roster.players || []).filter(Boolean);
    const benchIds = allIds.filter(id => !startersIds.includes(id));

    const starters = startersIds.map(id => playersAll[id]).filter(Boolean);
    const bench    = benchIds.map(id => playersAll[id]).filter(Boolean);

    const grid = el('div',{class:'grid'});
    grid.append(
      renderPlayerCard('Starters', starters),
      renderPlayerCard('Bench', bench)
    );

    view.replaceChildren(head, grid);
  }catch(err){
    view.replaceChildren(
      head,
      el('div',{class:'err'}, 'Could not load players. The Sleeper player directory may be blocked or took too long. Try again or refresh the player directory.')
    );
  }
}

function renderPlayerCard(title, arr){
  const card = el('div',{class:'card'});
  card.append(el('h3',{}, title));

  if(!arr || arr.length===0){
    card.append(el('div',{class:'empty'}, 'No players to show.'));
    return card;
  }

  arr.forEach(p=>{
    const name = p && (p.full_name || (p.first_name && p.last_name && (p.first_name + ' ' + p.last_name)) || p.first_name) || 'Player';
    const team = p && (p.team || (p.metadata && p.metadata.team)) || '';
    const pos  = p && p.position || '';
    const bye  = p && p.bye_week ? `Bye ${p.bye_week}` : '';
    const status = p && p.status || 'Active';
    const label = pos || '?';
    const color = POSITION_COLORS[pos] || '#9bb3c9';

    const row = el('div',{class:'player'},
      el('div',{class:'p-avatar','aria-hidden':'true', style:`background:${color}`}, label),
      el('div',{},
        el('div',{}, document.createTextNode(name)),
        el('div',{class:'muted'}, team ? `${team}${bye ? ' • ' + bye : ''}` : (bye || ''))
      ),
      el('div',{}, el('span',{class:'badge'}, status))
    );
    card.append(row);
  });
  return card;
}

/* Player Stats tab logic */

async function fetchLeagueTransactions(leagueId){
  if (cache.transactions.has(leagueId)) return cache.transactions.get(leagueId);
  const all = [];
  for (let wk = 1; wk <= MAX_WEEKS; wk++){
    try{
      const arr = await api.transactions(leagueId, wk);
      if (Array.isArray(arr) && arr.length){
        arr.forEach(tx => { tx._week = wk; all.push(tx); });
      }
      // we intentionally do not early-break in case there are later weeks with data
    }catch(e){
      // ignore per-week errors, keep what we have
    }
  }
  cache.transactions.set(leagueId, all);
  return all;
}

function computeLeagueStats(leagueId, transactions){
  const chops = new Map(); // playerId -> count
  const spent = new Map(); // playerId -> { total, count }
  const winningBids = [];  // { playerId, bid, week, rosterId, leagueId }

  transactions.forEach(tx => {
    if (tx.status !== 'complete') return;

    if (tx.type === 'chopped' && tx.drops){
      Object.keys(tx.drops).forEach(pid => {
        chops.set(pid, (chops.get(pid) || 0) + 1);
      });
    }

    if (tx.type === 'waiver' && tx.adds && tx.settings){
      const bid = Number(tx.settings.waiver_bid || 0);
      const week = tx.leg || tx._week || null;
      const rosterId = tx.roster_ids && tx.roster_ids.length ? Number(tx.roster_ids[0]) : null;

      Object.keys(tx.adds).forEach(pid => {
        winningBids.push({ playerId: pid, bid, week, rosterId, leagueId });

        const rec = spent.get(pid) || { total:0, count:0 };
        rec.total += bid;
        rec.count += 1;
        spent.set(pid, rec);
      });
    }
  });

  return { chops, spent, winningBids };
}

function getPlayerName(playersAll, playerId){
  const p = playersAll && playersAll[playerId];
  if (!p) return `Player ${playerId}`;
  if (p.full_name) return p.full_name;
  if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
  return p.first_name || p.last_name || `Player ${playerId}`;
}

function getLeagueName(leagueId){
  const league = cache.leagues.get(leagueId);
  return league && league.name ? league.name : leagueId;
}

function getOwnerLabel(leagueId, rosterId){
  if (rosterId == null) return 'Unknown';
  const rosters = cache.rosters.get(leagueId) || [];
  const roster = rosters.find(r => Number(r.roster_id) === Number(rosterId));
  if (!roster) return 'Unknown';
  const users = cache.users.get(leagueId) || [];
  const user = users.find(u => u.user_id === roster.owner_id);
  if (!user) return 'Unknown';
  return user.display_name || user.username || 'Unknown';
}

function rowsFromChopsMap(map, playersAll){
  const arr = Array.from(map.entries()).map(([playerId, count]) => ({
    player: getPlayerName(playersAll, playerId),
    times: count
  }));
  arr.sort((a,b) => b.times - a.times);
  return arr.slice(0, 10);
}

function rowsFromSpentMap(map, playersAll){
  const arr = Array.from(map.entries()).map(([playerId, rec]) => ({
    player: getPlayerName(playersAll, playerId),
    total: rec.total,
    times: rec.count
  }));
  arr.sort((a,b) => b.total - a.total);
  return arr.slice(0, 10).map(r => ({
    player: r.player,
    total: fmtFab(r.total),
    times: r.times
  }));
}

function rowsFromWinningBids(bids, playersAll){
  const sorted = bids.slice().sort((a,b) => b.bid - a.bid).slice(0, 10);
  return sorted.map(rec => ({
    player: getPlayerName(playersAll, rec.playerId),
    bid: fmtFab(rec.bid),
    by: getOwnerLabel(rec.leagueId, rec.rosterId),
    week: rec.week != null ? rec.week : '-'
  }));
}

function createStatsSection(title, tables, columns){
  const sec = el('section',{class:'stats-section'});
  sec.append(el('h2',{}, title));
  const grid = el('div',{class:'stats-table-grid'});
  tables.forEach(t => {
    const card = el('div',{class:'stats-card'});
    card.append(
      el('div',{class:'stats-card-title'}, t.title),
      buildStatsTable(columns, t.rows)
    );
    grid.append(card);
  });
  sec.append(grid);
  return sec;
}

function buildStatsTable(columns, rows){
  const table = el('table',{class:'stats-table'});
  const thead = el('thead',{},
    el('tr',{}, ...columns.map(col =>
      el('th',{style:`text-align:${col.align || 'left'}`}, col.label)
    ))
  );
  table.append(thead);
  const tbody = el('tbody',{});
  if (!rows || rows.length === 0){
    const td = el('td',{class:'stats-empty', colspan:String(columns.length)}, 'No data yet.');
    tbody.append(el('tr',{}, td));
  } else {
    rows.forEach(row => {
      const tr = el('tr',{});
      columns.forEach(col => {
        tr.append(
          el('td',{style:`text-align:${col.align || 'left'}`}, row[col.key] != null ? row[col.key] : '')
        );
      });
      tbody.append(tr);
    });
  }
  table.append(tbody);
  return table;
}

function buildMostChoppedSection(playersAll, statsByLeague, combined){
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    { title:'All Leagues', rows: rowsFromChopsMap(combined.chops, playersAll) },
    { title:getLeagueName(league1Id), rows: rowsFromChopsMap(statsByLeague[league1Id].chops, playersAll) },
    { title:getLeagueName(league2Id), rows: rowsFromChopsMap(statsByLeague[league2Id].chops, playersAll) }
  ];
  const columns = [
    { key:'player', label:'Player', align:'left' },
    { key:'times', label:'Times Chopped', align:'right' }
  ];
  return createStatsSection('Most Chopped', tables, columns);
}

function buildHighestSingleBidsSection(playersAll, statsByLeague, combined){
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    { title:'All Leagues', rows: rowsFromWinningBids(combined.winningBids, playersAll) },
    { title:getLeagueName(league1Id), rows: rowsFromWinningBids(statsByLeague[league1Id].winningBids, playersAll) },
    { title:getLeagueName(league2Id), rows: rowsFromWinningBids(statsByLeague[league2Id].winningBids, playersAll) }
  ];
  const columns = [
    { key:'player', label:'Player', align:'left' },
    { key:'bid', label:'Bid', align:'right' },
    { key:'by', label:'By', align:'left' },
    { key:'week', label:'Week', align:'right' }
  ];
  return createStatsSection('Highest Single Bids', tables, columns);
}

function buildMostSpentSection(playersAll, statsByLeague, combined){
  const league1Id = LEAGUE_IDS[0].id;
  const league2Id = LEAGUE_IDS[1].id;
  const tables = [
    { title:'All Leagues', rows: rowsFromSpentMap(combined.spent, playersAll) },
    { title:getLeagueName(league1Id), rows: rowsFromSpentMap(statsByLeague[league1Id].spent, playersAll) },
    { title:getLeagueName(league2Id), rows: rowsFromSpentMap(statsByLeague[league2Id].spent, playersAll) }
  ];
  const columns = [
    { key:'player', label:'Player', align:'left' },
    { key:'total', label:'Total Spent', align:'right' },
    { key:'times', label:'Times Won', align:'right' }
  ];
  return createStatsSection('Most Spent Overall', tables, columns);
}

async function loadStats(){
  statsLoaded = true;
  const container = document.getElementById('stats-content');
  container.replaceChildren(el('div',{class:'loading'}, 'Loading transactions and building stats...'));

  try{
    const playersAll = await api.playersAllNFL();
    const statsByLeague = {};
    const combined = {
      chops: new Map(),
      spent: new Map(),
      winningBids: []
    };

    for (const cfg of LEAGUE_IDS){
      const txs = await fetchLeagueTransactions(cfg.id);
      const leagueStats = computeLeagueStats(cfg.id, txs);
      statsByLeague[cfg.id] = leagueStats;

      leagueStats.chops.forEach((count, playerId) => {
        combined.chops.set(playerId, (combined.chops.get(playerId) || 0) + count);
      });
      leagueStats.spent.forEach((rec, playerId) => {
        const cur = combined.spent.get(playerId) || { total:0, count:0 };
        cur.total += rec.total;
        cur.count += rec.count;
        combined.spent.set(playerId, cur);
      });
      combined.winningBids.push(...leagueStats.winningBids);
    }

    const sections = [
      buildMostChoppedSection(playersAll, statsByLeague, combined),
      buildHighestSingleBidsSection(playersAll, statsByLeague, combined),
      buildMostSpentSection(playersAll, statsByLeague, combined)
    ];
    container.replaceChildren(...sections);
  }catch(err){
    container.replaceChildren(el('div',{class:'err'}, 'Failed to load stats: ' + err.message));
  }
}

/* Shared utilities */
async function clearPlayersCache(){
  cache.playersAll = null;
  await idbDelete(PLAYERS_IDB_KEY);
  alert('Player directory cache cleared. It will re-download the next time you open a team.');
}

init();