// js/teamsView.js
import { LEAGUE_IDS, POSITION_COLORS, CURRENT_WEEK } from './constants.js';
import { cache, state } from './cache.js';
import { api } from './api.js';
import { el, fmtFab } from './dom.js';

const columnsEl = document.getElementById('columns');
const tabsEl = document.getElementById('league-tabs');

function mapUsersByOwnerId(users) {
  const m = new Map();
  users.forEach(u => {
    m.set(u.user_id, {
      user_id: u.user_id,
      username: u.username,
      display_name: u.display_name,
      team_name:
        (u.metadata &&
          (u.metadata.team_name || u.metadata.team_name_full)) ||
        null,
      avatar: u.avatar || null
    });
  });
  return m;
}

export function setupLeagueTabs() {
  LEAGUE_IDS.forEach((cfg, index) => {
    const btn = el(
      'button',
      {
        class: 'tab-btn' + (index === state.activeLeagueIndex ? ' active' : ''),
        onclick: () => setActiveLeague(index)
      },
      cfg.label || `League ${index + 1}`
    );
    btn.dataset.index = index;
    tabsEl.append(btn);
  });
}

function setActiveLeague(index) {
  state.activeLeagueIndex = index;
  const cols = columnsEl.querySelectorAll('.col');
  cols.forEach(col => {
    col.dataset.active =
      Number(col.dataset.index) === index ? 'true' : 'false';
  });
  tabsEl.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle(
      'active',
      Number(btn.dataset.index) === index
    );
  });
}

export function updateResponsiveLayout() {
  if (window.innerWidth < 980) {
    columnsEl.classList.add('single-column');
    tabsEl.style.display = 'flex';
    setActiveLeague(state.activeLeagueIndex);
  } else {
    columnsEl.classList.remove('single-column');
    tabsEl.style.display = 'none';
  }
}

export async function initLeagues() {
  for (const [i, leagueCfg] of LEAGUE_IDS.entries()) {
    const col = renderColumnSkeleton(i);
    columnsEl.append(col);

    try {
      const [league, rosters, users, matchups] = await Promise.all([
        cache.leagues.get(leagueCfg.id) || api.league(leagueCfg.id),
        cache.rosters.get(leagueCfg.id) || api.rosters(leagueCfg.id),
        cache.users.get(leagueCfg.id) || api.leagueUsers(leagueCfg.id),
        cache.matchups.get(leagueCfg.id) || api.matchups(leagueCfg.id, CURRENT_WEEK)
      ]);

      cache.leagues.set(leagueCfg.id, league);
      cache.rosters.set(leagueCfg.id, rosters);
      cache.users.set(leagueCfg.id, users);
      cache.matchups.set(leagueCfg.id, matchups);

      const tabBtn = tabsEl.querySelector(
        `.tab-btn[data-index="${i}"]`
      );
      if (tabBtn && league.name) tabBtn.textContent = league.name;

      mountLeagueView(col, leagueCfg.id, league, rosters, users);
    } catch (err) {
      col.replaceChildren(
        columnHeader('Error'),
        el(
          'div',
          { class: 'view' },
          el(
            'div',
            { class: 'err' },
            `Failed to load league ${leagueCfg.id}. ${err.message}`
          )
        )
      );
    }
  }
}

/* internal rendering helpers */

function renderColumnSkeleton(index) {
  const c = el('div', { class: 'col' });
  c.dataset.index = index;
  c.dataset.active = (index === state.activeLeagueIndex).toString();
  c.append(
    columnHeader('Loading'),
    el(
      'div',
      { class: 'view' },
      el('div', { class: 'loading' }, 'Fetching league data...')
    )
  );
  return c;
}

function columnHeader(title, season) {
  const hdr = el('div', { class: 'col-header' });
  hdr.append(
    el('div', { class: 'league-pill' }, title),
    season ? el('div', { class: 'small' }, season) : el('span')
  );
  return hdr;
}

function mountLeagueView(container, leagueId, league, rosters, users) {
  const matchups = cache.matchups.get(leagueId) || [];
  container.replaceChildren(
    columnHeader(
      league.name || 'League',
      `Season ${league.season}`
    ),
    el(
      'div',
      { class: 'view' },
      buildTeamList(container, leagueId, league, rosters, users, matchups)
    )
  );
}

function buildTeamList(container, leagueId, league, rosters, users, matchups) {
  const waiverCap = Number(
    (league.settings && league.settings.waiver_budget) || 0
  );
  const usersById = mapUsersByOwnerId(users);
  
  // Create a map of roster_id to points
  const pointsByRosterId = new Map();
  (matchups || []).forEach(m => {
    pointsByRosterId.set(m.roster_id, m.points || 0);
  });
  const active = rosters.filter(
    r =>
      !(
        r.settings &&
        Object.prototype.hasOwnProperty.call(
          r.settings,
          'eliminated'
        )
      )
  );

  active.sort((a, b) => {
    const aRem =
      waiverCap -
      Number(
        (a.settings && a.settings.waiver_budget_used) || 0
      );
    const bRem =
      waiverCap -
      Number(
        (b.settings && b.settings.waiver_budget_used) || 0
      );
    return bRem - aRem;
  });

  const list = el('div', { class: 'list' });

  active.forEach(r => {
    const u = usersById.get(r.owner_id) || {};
    const teamName =
      u.team_name || u.display_name || 'Team';
    const username = u.username ? `@${u.username}` : '';
    const remaining = Math.max(
      0,
      waiverCap -
        Number(
          (r.settings && r.settings.waiver_budget_used) || 0
        )
    );
    const points = pointsByRosterId.get(r.roster_id) || 0;
    const initials = (teamName || 'T')
      .split(/\s+/)
      .slice(0, 2)
      .map(s => s[0])
      .join('')
      .toUpperCase();

    let avatarNode;
    if (u.avatar) {
      const src = `https://sleepercdn.com/avatars/thumbs/${u.avatar}`;
      avatarNode = el(
        'div',
        { class: 'avatar' },
        el('img', {
          class: 'avatar-img',
          src,
          alt: teamName
        })
      );
    } else {
      avatarNode = el(
        'div',
        { class: 'avatar', 'aria-hidden': 'true' },
        initials
      );
    }

    const row = el(
      'div',
      {
        class: 'row',
        role: 'button',
        tabindex: '0',
        onclick: () =>
          mountTeamView(
            container,
            leagueId,
            league,
            r,
            usersById
          ),
        onkeydown: e => {
          if (e.key === 'Enter' || e.key === ' ') row.click();
        }
      },
      avatarNode,
      el(
        'div',
        {},
        el('div', { class: 'title' }, teamName),
        el('div', { class: 'meta' }, `${points.toFixed(2)} pts`)
      ),
      el(
        'div',
        {},
        el('div', { class: 'fab' }, fmtFab(remaining)),
        el(
          'div',
          {
            class: 'cap muted',
            style: 'text-align:right'
          },
          'FAB left'
        )
      )
    );
    list.append(row);
  });

  if (active.length === 0) {
    list.append(
      el(
        'div',
        { class: 'empty' },
        'No active teams.'
      )
    );
  }
  return list;
}

async function mountTeamView(
  container,
  leagueId,
  league,
  roster,
  usersById
) {
  const user = usersById.get(roster.owner_id) || {};
  const teamName =
    user.team_name || user.display_name || 'Team';
  const header = columnHeader(
    league.name || 'League',
    `Season ${league.season}`
  );
  
  // Get matchups to show points
  const matchups = cache.matchups.get(leagueId) || [];
  const matchup = matchups.find(m => m.roster_id === roster.roster_id);
  const totalPoints = matchup ? (matchup.points || 0) : 0;

  const view = el('div', { class: 'view' });
  const head = el(
    'div',
    { class: 'team-head' },
    el(
      'button',
      {
        class: 'btn',
        onclick: () =>
          mountLeagueView(
            container,
            leagueId,
            league,
            cache.rosters.get(leagueId),
            cache.users.get(leagueId)
          )
      },
      '← Back'
    ),
    el('div', { class: 'team-name' }, teamName),
    el(
      'div',
      { class: 'team-points', style: 'margin-left: auto; font-size: 1.5rem; font-weight: bold;' },
      `${totalPoints.toFixed(2)} pts`
    ),
    el(
      'div',
      { class: 'muted' },
      user.username ? `@${user.username}` : ''
    )
  );
  view.append(
    head,
    el('div', { class: 'loading' }, 'Loading players...')
  );
  container.replaceChildren(header, view);

  try {
    const playersAll = await api.playersAllNFL();
    const startersIds = (roster.starters || []).filter(
      id => id && id !== '0'
    );
    const allIds = (roster.players || []).filter(Boolean);
    const benchIds = allIds.filter(
      id => !startersIds.includes(id)
    );

    const starters = startersIds
      .map(id => playersAll[id])
      .filter(Boolean);
    const bench = benchIds
      .map(id => playersAll[id])
      .filter(Boolean);

    const grid = el('div', { class: 'grid' });
    grid.append(
      renderPlayerCard('Starters', starters, matchup),
      renderPlayerCard('Bench', bench, matchup)
    );

    view.replaceChildren(head, grid);
  } catch (err) {
    view.replaceChildren(
      head,
      el(
        'div',
        { class: 'err' },
        'Could not load players. The Sleeper player directory may be blocked or took too long. Try again or refresh the player directory.'
      )
    );
  }
}

function renderPlayerCard(title, arr, matchup) {
  const card = el('div', { class: 'card' });
  card.append(el('h3', {}, title));

  if (!arr || arr.length === 0) {
    card.append(
      el(
        'div',
        { class: 'empty' },
        'No players to show.'
      )
    );
    return card;
  }
  
  // Create map of player points from matchup
  const playerPoints = new Map();
  if (matchup && matchup.players_points) {
    Object.entries(matchup.players_points).forEach(([playerId, points]) => {
      playerPoints.set(playerId, points || 0);
    });
  }

  arr.forEach(p => {
    const name =
      (p &&
        (p.full_name ||
          (p.first_name &&
            p.last_name &&
            p.first_name + ' ' + p.last_name) ||
          p.first_name)) ||
      'Player';
    const team =
      (p && (p.team || (p.metadata && p.metadata.team))) ||
      '';
    const pos = (p && p.position) || '';
    const bye =
      p && p.bye_week ? `Bye ${p.bye_week}` : '';
    const playerId = p && p.player_id;
    const points = playerId ? (playerPoints.get(playerId) || 0) : 0;
    const label = pos || '?';
    const color = POSITION_COLORS[pos] || '#9bb3c9';

    const row = el(
      'div',
      { class: 'player' },
      el(
        'div',
        {
          class: 'p-avatar',
          'aria-hidden': 'true',
          style: `background:${color}`
        },
        label
      ),
      el(
        'div',
        {},
        el('div', {}, document.createTextNode(name)),
        el(
          'div',
          { class: 'muted' },
          team
            ? `${team}${bye ? ' • ' + bye : ''}`
            : bye || ''
        )
      ),
      el(
        'div',
        { style: 'font-weight: bold; color: var(--text);' },
        `${points.toFixed(2)}`
      )
    );
    card.append(row);
  });

  return card;
}
