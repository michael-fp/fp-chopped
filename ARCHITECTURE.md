# FP Chopped - Architecture Documentation

## Project Overview

**FP Chopped** is a static single-page web application for viewing Guillotine Fantasy Football League data from Sleeper.app. The application displays team rosters, waiver budgets (FAB - Free Agent Budget), player statistics, and animated visualizations across multiple leagues.

### Key Features
- **Teams Tab**: View active teams, their FAB remaining, current week points, and detailed rosters
- **Player Stats Tab**: Aggregate statistics showing most chopped players, highest bids, and team spending
- **FAB Spending Tab**: Animated line chart visualization of FAB spending over the season with interactive replay

### Technology Stack
- **Pure Vanilla JavaScript (ES6 modules)** - No frameworks
- **No build system** - Direct browser imports
- **IndexedDB** - Client-side caching for player data (10-day TTL)
- **Sleeper API** - External data source for all league data

---

## Project Structure

```
fp-chopped/
├── index.html              # Main HTML file, contains tab structure
├── css/
│   └── main.css           # All application styles
├── js/
│   ├── main.js            # Application entry point, initialization
│   ├── constants.js       # Configuration values (league IDs, week numbers, colors)
│   ├── cache.js           # Global state and data cache (Maps)
│   ├── dom.js             # DOM helper utilities (el, fmtFab)
│   ├── api.js             # Sleeper API client and IndexedDB layer
│   ├── tabs.js            # Primary tab switching (Teams/Stats/FAB Spending)
│   ├── teamsView.js       # Teams tab: league list, team rosters, points
│   ├── statsView.js       # Stats tab: transaction analysis
│   └── fabSpendingView.js # FAB Spending tab: animated line chart
└── ARCHITECTURE.md        # This file
```

---

## Architecture Patterns

### Modular Architecture
The codebase follows a **modular architecture** with clear separation of concerns:

- **View modules** (`teamsView.js`, `statsView.js`, `fabSpendingView.js`) handle UI rendering and state for their respective tabs
- **Shared cache** (`cache.js`) stores leagues, rosters, users, players, transactions, matchups
- **API layer** (`api.js`) abstracts all HTTP calls and caching logic
- **Pure rendering** functions take data as parameters and return DOM nodes

### Data Flow

#### 1. Initialization (main.js)
```
main.js
  ├─> Sets up league tabs (teamsView.setupLeagueTabs)
  ├─> Loads league data in parallel (api.league, api.rosters, api.leagueUsers, api.matchups)
  ├─> Caches responses in cache Maps
  └─> Renders initial teams view
```

#### 2. Teams View Navigation
```
User clicks team
  ├─> mountTeamView() loads player directory (api.playersAllNFL)
  ├─> Player directory cached in IndexedDB for 10 days
  ├─> Roster IDs mapped to player objects
  ├─> Player points fetched from matchups API
  └─> Roster displayed with current week points
```

#### 3. FAB Spending View
```
User switches to FAB Spending tab
  ├─> loadFABSpending() fetches transactions for all weeks
  ├─> computeFABTimeline() processes transactions into timeline points
  ├─> Assigns stable colors to teams (teamColorMap)
  ├─> Renders static chart with Replay button
  └─> On Replay: animated line chart with filters and hover
```

---

## Key Concepts

### League Configuration
- **Location**: `js/constants.js` → `LEAGUE_IDS`
- **Format**: Array of `{ id: 'sleeper_league_id', label: 'Display Name' }`
- **Current**: Two leagues configured (League A, League B)

### Current Week
- **Location**: `js/constants.js` → `CURRENT_WEEK`
- **Usage**: Determines which week's matchup data to fetch for points
- **Update**: Manually increment this value each week

### FAB (Free Agent Budget)
- **Max Value**: 1000 (constant across all leagues)
- **Tracking**: Each league has `settings.waiver_budget` total
- **Usage**: Teams track `settings.waiver_budget_used`
- **Remaining**: `total - used`
- **Display**: Formatted with commas (e.g., "$750")

### Eliminated Teams
- **Detection**: Roster has `settings.eliminated` property
- **Behavior**: 
  - Filtered from "Remaining" view
  - Shown only in "Chopped" view
  - Grayed out on FAB Spending chart after elimination week

### Player Directory Caching
- **Storage**: IndexedDB
- **Key**: `'players_nfl_v1'`
- **TTL**: 10 days (configurable in `constants.js`)
- **Size**: ~5MB JSON
- **Clear**: Footer button manually clears cache

---

## FAB Spending Chart - Detailed Architecture

The FAB Spending chart is the most complex component. Here's how it works:

### Data Structure

#### Timeline Object
```javascript
{
  rosterId: number,
  leagueId: string,
  teamName: string,
  avatar: string | null,
  initials: string,
  isEliminated: boolean,
  eliminatedWeek: number | null,
  currentFab: number,
  points: [
    {
      week: number,          // Week number (0-18)
      weekProgress: number,  // Progress within week (0-1)
      fab: number,          // FAB remaining at this point
      timestamp: number     // Unix timestamp of transaction
    },
    ...
  ]
}
```

### Key Components

#### 1. Timeline Computation (`computeFABTimeline`)
- **Input**: League ID
- **Process**:
  1. Initialize each team at week 0 with full FAB (1000)
  2. Sort transactions by week, then by timestamp
  3. For each waiver transaction, subtract bid from team's FAB
  4. Calculate `weekProgress` (0-1) based on transaction timestamp
  5. Add point to timeline with week, weekProgress, FAB, timestamp
- **Output**: Array of timeline objects

#### 2. Color Assignment (`teamColorMap`)
- **Key**: `"${leagueId}-${rosterId}"` (stable identifier)
- **Value**: Color from `CHART_COLORS` array
- **Assignment**: Done once on data load, based on order in `baseTimelines`
- **Purpose**: Teams keep same color when filters change

#### 3. Chart Rendering (`renderChart`)
- **Axes**: Static throughout animation
  - X-axis: Week 0 to `staticMaxWeek` (calculated from data)
  - Y-axis: $0 to $1000 (FAB range)
- **Animation Progress**: 0.0 to 1.0
  - 0.0 = week 0 (all teams at $1000)
  - 1.0 = current week (all active teams extended to CURRENT_WEEK)
- **Visible Points Calculation**:
  - Filter timeline points up to `targetWeek = maxWeek * progress`
  - Interpolate partial point if mid-week
  - At progress 1.0: extend active teams to CURRENT_WEEK, eliminated teams to elimination week

#### 4. Line Rendering
- **Algorithm**: Cubic Bézier curves for smooth transitions
- **Control Points**: Calculated based on FAB drop magnitude
  - Large drops: tighter curves (tension 0.3-0.6)
  - Small drops: smoother curves
- **Path**: SVG `<path>` with `d` attribute generated by `createSmoothPath()`

#### 5. Avatar Positioning & Jitter
- **Base Position**: Last point in visible points array
- **Jitter Algorithm**:
  ```
  For each avatar:
    For each previous avatar:
      If distance < JITTER_THRESHOLD (5px):
        Add JITTER_OFFSET (7px) to Y
        Add JITTER_OFFSET * 0.5 to X
  ```
- **Purpose**: Prevent overlapping avatars when teams have similar FAB
- **Line Connection**: Lines end at avatar position (including jitter)

#### 6. Hover Interactions
- **Static Mode**: Triggers re-render to show effects
- **Animation Mode**: Effects applied on each frame, no extra render
- **Effects**:
  - Hovered line: Glow filter, increased stroke width (4px)
  - Other lines: Opacity 0.4
  - Eliminated teams: Opacity 0.3 or 0.6 (if hovered)
- **Tooltip**: Persistent element in chart container, shows on hover

#### 7. Animation Loop
- **Duration**: `REPLAY_DURATION_MS` (15 seconds default)
- **Frame Rate**: ~60 FPS (requestAnimationFrame)
- **Controls**: Created once before animation, preserved during replay
- **Chart Updates**: Only SVG replaced on each frame, tooltip and controls persist
- **Progress Tracking**: `currentAnimationProgress` updated each frame

#### 8. Filter System
- **League Filter**: 'both' | league_id_1 | league_id_2
- **Team Status Filter**: 'all' | 'remaining' | 'chopped'
- **Implementation**: Filters applied to `baseTimelines` via `filterTimelinesForView()`
- **Live Updates**: Changing filters during animation:
  1. Cancels current animation
  2. Re-filters data
  3. Restarts animation at same progress

---

## API Integration

### Sleeper API Endpoints

```javascript
// League info
GET https://api.sleeper.app/v1/league/${leagueId}

// Rosters (includes FAB used, elimination status)
GET https://api.sleeper.app/v1/league/${leagueId}/rosters

// League users (team names, avatars)
GET https://api.sleeper.app/v1/league/${leagueId}/users

// Transactions for a week (waiver bids)
GET https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}

// Matchups for a week (current points)
GET https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}

// All NFL players (full directory, ~5MB)
GET https://api.sleeper.app/v1/players/nfl
```

### Response Caching Strategy

| Data Type | Storage | TTL | Key |
|-----------|---------|-----|-----|
| Leagues | Memory (Map) | Session | league_id |
| Rosters | Memory (Map) | Session | league_id |
| Users | Memory (Map) | Session | league_id |
| Transactions | Memory (Map) | Session | league_id |
| Matchups | Memory (Map) | Session | league_id |
| Players | IndexedDB | 10 days | 'players_nfl_v1' |

---

## State Management

### Global State (`cache.js`)
```javascript
export const cache = {
  leagues: new Map(),      // league_id -> league object
  rosters: new Map(),      // league_id -> rosters array
  users: new Map(),        // league_id -> users array
  playersAll: null,        // NFL player directory object
  transactions: new Map(), // league_id -> transactions array
  matchups: new Map()      // league_id -> matchups array
};

export const state = {
  activeLeagueIndex: 0,          // Current league tab (0 or 1)
  activePrimaryTab: 'teams',     // Current primary tab
  statsLoaded: false,            // Stats tab lazy-load flag
  fabSpendingLoaded: false       // FAB Spending lazy-load flag
};
```

### Module-Level State (fabSpendingView.js)
```javascript
let currentFilter = 'both';              // League filter
let currentTeamStatusFilter = 'all';     // Team status filter
let isAnimating = false;                 // Animation running flag
let isPaused = false;                    // Animation paused flag
let hoveredTeamIndex = null;             // Currently hovered team
let baseTimelines = [];                  // All timeline data
let teamColorMap = new Map();            // Stable color assignments
```

---

## Responsive Design

### Breakpoint
- **Width**: 980px
- **Desktop (≥980px)**: Both leagues side-by-side
- **Mobile (<980px)**: One league at a time with tabs

### Implementation
- **CSS**: `.single-column` class on `#columns`
- **JavaScript**: `updateResponsiveLayout()` in `teamsView.js`
- **Trigger**: Window resize event listener

---

## Adding a New League

1. **Get Sleeper League ID** from league URL
2. **Update `js/constants.js`**:
   ```javascript
   export const LEAGUE_IDS = [
     { id: '1262120211746656256', label: 'League A' },
     { id: '1262120355430928384', label: 'League B' },
     { id: 'YOUR_NEW_LEAGUE_ID', label: 'League C' }  // Add here
   ];
   ```
3. **Update Stats View** (if >2 leagues):
   - Edit `statsView.js` functions:
     - `buildMostChoppedSection()`
     - `buildHighestSingleBidsSection()`
     - `buildMostSpentSection()`
   - Currently hardcoded for 2 leagues

---

## Development Workflow

### Running Locally
No build process required. Serve with any HTTP server:

```bash
# Python 3
python3 -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js
npx http-server -p 8000
```

Then open `http://localhost:8000`

### Testing
**No automated tests exist.** Manual testing required:
1. Open site in browser
2. Check console for errors
3. Test both Teams and Player Stats tabs
4. Test responsive layout (resize browser < 980px)
5. Verify league data loads from Sleeper API
6. Test FAB Spending replay animation
7. Test filters and hover interactions

### Deployment
Static site - deploy to any web host:
- GitHub Pages
- Netlify
- Vercel
- S3 + CloudFront
- Any static file server

---

## Common Modifications

### Update Current Week
```javascript
// js/constants.js
export const CURRENT_WEEK = 13;  // Increment each week
```

### Change Player Cache TTL
```javascript
// js/constants.js
export const PLAYERS_TTL_DAYS = 7;  // Change number of days
```

### Modify Position Colors
```javascript
// js/constants.js
export const POSITION_COLORS = {
  QB: '#ff2a6d',
  RB: '#00ceb8',
  WR: '#58a7ff',
  TE: '#ffae58'
};
```

### Adjust Animation Speed
```javascript
// js/fabSpendingView.js
export const REPLAY_DURATION_MS = 20000;  // 20 seconds instead of 15
```

### Change Avatar Jitter
```javascript
// js/fabSpendingView.js (in renderChart function)
const JITTER_THRESHOLD = 5;  // Distance threshold for detecting overlap
const JITTER_OFFSET = 7;     // Pixels to offset overlapping avatars
```

---

## Known Limitations

- **No TypeScript** - Plain JavaScript with no type checking
- **No linting** - No ESLint or Prettier configuration
- **No tests** - Manual browser testing only
- **Sleeper API only** - Tightly coupled to Sleeper's data format
- **Two-league assumption** - Stats view assumes exactly 2 leagues
- **Single season** - No historical season support
- **No authentication** - Public league data only
- **Manual week updates** - `CURRENT_WEEK` must be updated manually

---

## Troubleshooting

### Player Directory Not Loading
- Check browser console for API errors
- Click "Clear Player Directory Cache" button in footer
- Sleeper API may be slow (~5MB download)
- Check IndexedDB is enabled in browser

### Teams Not Showing Points
- Verify `CURRENT_WEEK` is set correctly in `constants.js`
- Check that matchups exist for current week
- Verify Sleeper API is accessible

### FAB Chart Not Animating
- Check browser console for JavaScript errors
- Verify transactions loaded successfully
- Check that `baseTimelines` is populated
- Try refreshing the page

### Colors Changing on Filter
- Should be fixed - colors are now stable
- Clear browser cache if seeing old behavior
- Check `teamColorMap` is being populated

---

## Future Enhancement Ideas

- Add historical season selector
- Support for more than 2 leagues
- Automated tests (Jest + Playwright)
- TypeScript migration
- Build process with code splitting
- Real-time updates via Sleeper webhooks
- Export chart as image/PDF
- Customizable team colors
- Mobile-optimized chart interactions
- Weekly recap/highlights section

---

## Contact & Contribution

This is a personal project for viewing Guillotine league data. The codebase prioritizes simplicity and ease of understanding over architectural purity.

**Philosophy**: Vanilla JS, no build step, easy to modify.
