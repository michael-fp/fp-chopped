# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a static single-page web application for viewing **Guillotine Fantasy Football League** data from Sleeper.app. The site displays team rosters, waiver budgets (FAB), and player statistics across multiple leagues.

**Key Features:**
- Displays active teams and their remaining FAB (Free Agent Budget)
- Shows team rosters (starters and bench)
- Aggregates player statistics (most chopped, highest bids, total spending)
- Uses IndexedDB to cache player directory for 10 days
- Responsive design with mobile/desktop views

## Development Commands

### Running Locally
This is a static site with no build process. Serve it with any HTTP server:
```bash
# Python 3
python3 -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js (if http-server is installed)
npx http-server -p 8000
```

Then open `http://localhost:8000` in a browser.

### Testing
**No automated tests exist.** Manual testing is required by:
1. Opening the site in a browser
2. Checking console for errors
3. Testing both Teams and Player Stats tabs
4. Testing responsive layout (resize browser < 980px)
5. Verifying league data loads from Sleeper API

## Architecture

### Technology Stack
- **Vanilla JavaScript (ES6 modules)** - No framework
- **No build system** - Direct browser imports
- **IndexedDB** - Client-side caching for player data
- **Sleeper API** - External data source

### Code Organization

The codebase follows a **modular architecture** with clear separation of concerns:

```
js/
├── main.js         - Application entry point, initialization
├── app.js          - Legacy monolithic file (not actively used)
├── constants.js    - Configuration (league IDs, colors, settings)
├── cache.js        - Global state and data cache (Maps)
├── dom.js          - DOM helper utilities (el, fmtFab)
├── api.js          - Sleeper API client and IndexedDB layer
├── teamsView.js    - Teams tab: league list, team rosters
├── statsView.js    - Stats tab: transaction analysis
└── tabs.js         - Primary tab switching (Teams/Stats)
```

**Key architectural patterns:**
- **View modules** (teamsView, statsView) handle UI rendering and state for their tab
- **Shared cache** in `cache.js` stores leagues, rosters, users, players, transactions
- **API layer** in `api.js` abstracts all HTTP calls and caching logic
- **Pure rendering** functions take data as parameters and return DOM nodes

### Data Flow

1. **Initialization** (main.js):
   - Sets up league tabs
   - Loads league data in parallel via `api.league()`, `api.rosters()`, `api.leagueUsers()`
   - Caches responses in `cache` Maps
   - Renders teams view for each league

2. **Teams View Navigation**:
   - User clicks team → `mountTeamView()` loads player directory via `api.playersAllNFL()`
   - Player directory cached in IndexedDB for 10 days
   - Roster IDs mapped to player objects for display

3. **Stats View** (lazy loaded):
   - First access triggers `loadStats()`
   - Fetches all transactions for weeks 1-18 for each league
   - Computes aggregated stats (chops, bids, spending)
   - Renders three sections: Most Chopped, Highest Bids, Most Spent

### Critical Concepts

**League IDs:**
- Configured in `constants.js` (`LEAGUE_IDS` array)
- Each has `id` (Sleeper league ID) and `label`
- To add/change leagues, modify this array

**Waiver Budget (FAB):**
- Each league has a `settings.waiver_budget` total
- Teams track `settings.waiver_budget_used`
- Remaining = total - used

**Eliminated Teams:**
- Guillotine leagues eliminate teams weekly
- Filtered by presence of `roster.settings.eliminated` property

**Player Directory Caching:**
- Sleeper's NFL player directory (~5MB JSON) cached in IndexedDB
- Key: `PLAYERS_IDB_KEY` = `'players_nfl_v1'`
- TTL: 10 days
- User can manually clear via footer button

**Transactions Analysis:**
- Type `'chopped'` → player was eliminated
- Type `'waiver'` → player added via waiver bid
- Stats computed from all `complete` transactions across weeks 1-18

### Responsive Behavior
- Desktop (≥980px): Shows both leagues side-by-side
- Mobile (<980px): Shows one league at a time with tabs

## Modifying the Application

### Adding a New League
Edit `js/constants.js`:
```javascript
export const LEAGUE_IDS = [
  { id: '1262120211746656256', label: 'League A' },
  { id: '1262120355430928384', label: 'League B' },
  { id: 'NEW_LEAGUE_ID', label: 'League C' }  // Add here
];
```

**Note:** Stats view hardcodes league1Id/league2Id. If adding more than 2 leagues, update `statsView.js` functions:
- `buildMostChoppedSection()`
- `buildHighestSingleBidsSection()`
- `buildMostSpentSection()`

### Changing Player Cache TTL
Edit `js/constants.js`:
```javascript
export const PLAYERS_TTL_DAYS = 10;  // Change number of days
```

### Modifying Position Colors
Edit `js/constants.js`:
```javascript
export const POSITION_COLORS = {
  QB: '#ff2a6d',
  RB: '#00ceb8',
  WR: '#58a7ff',
  TE: '#ffae58'
};
```

## Known Constraints

- **No TypeScript** - Plain JavaScript with no type checking
- **No linting** - No ESLint or Prettier configuration
- **No tests** - Manual browser testing only
- **Sleeper API only** - Tightly coupled to Sleeper's data format
- **Two-league assumption** - Stats view assumes exactly 2 leagues
- **Single season** - No historical season support
- **No authentication** - Public league data only
