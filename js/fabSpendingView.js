// js/fabSpendingView.js
import { LEAGUE_IDS, MAX_WEEKS, CURRENT_WEEK } from './constants.js';
import { cache } from './cache.js';
import { api } from './api.js';
import { el } from './dom.js';

// Animation duration in milliseconds - change this to adjust replay speed
export const REPLAY_DURATION_MS = 15000;

const CHART_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
  '#E63946', '#A8DADC', '#457B9D', '#F1FAEE', '#E76F51'
];

let currentFilter = 'both';
let currentTeamStatusFilter = 'all'; // 'all', 'remaining', or 'chopped'
let isAnimating = false;
let isPaused = false;
let animationFrameId = null;
let pausedProgress = 0;
let currentAnimationProgress = 1.0;
let hoveredTeamIndex = null;
let baseTimelines = []; // all timelines across leagues for current load
let staticMaxFab = 1000; // FAB always starts at 1000
let staticMaxWeek = 0;
let teamColorMap = new Map(); // Stable color mapping for each team

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

function getTeamName(leagueId, rosterId) {
  const rosters = cache.rosters.get(leagueId) || [];
  const roster = rosters.find(r => Number(r.roster_id) === Number(rosterId));
  if (!roster) return 'Unknown';
  
  const users = cache.users.get(leagueId) || [];
  const user = users.find(u => u.user_id === roster.owner_id);
  if (!user) return 'Unknown';
  
  return (user.metadata && (user.metadata.team_name || user.metadata.team_name_full)) ||
         user.display_name || user.username || 'Unknown';
}

function getTeamAvatar(leagueId, rosterId) {
  const rosters = cache.rosters.get(leagueId) || [];
  const roster = rosters.find(r => Number(r.roster_id) === Number(rosterId));
  if (!roster) return null;
  
  const users = cache.users.get(leagueId) || [];
  const user = users.find(u => u.user_id === roster.owner_id);
  return user && user.avatar ? user.avatar : null;
}

function getTeamInitials(leagueId, rosterId) {
  const name = getTeamName(leagueId, rosterId);
  return name.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

function computeFABTimeline(leagueId) {
  const league = cache.leagues.get(leagueId);
  const rosters = cache.rosters.get(leagueId) || [];
  const transactions = cache.transactions.get(leagueId) || [];
  
  const waiverCap = Number((league.settings && league.settings.waiver_budget) || 0);
  
  // Initialize timeline for each roster using official FAB state
  const timelines = {};
  rosters.forEach(r => {
    const rosterId = Number(r.roster_id);
    const usedFab = Number((r.settings && r.settings.waiver_budget_used) || 0);
    const currentFab = waiverCap - usedFab;
    
    timelines[rosterId] = {
      rosterId,
      leagueId,
      teamName: getTeamName(leagueId, rosterId),
      avatar: getTeamAvatar(leagueId, rosterId),
      initials: getTeamInitials(leagueId, rosterId),
      isEliminated: r.settings && Object.prototype.hasOwnProperty.call(r.settings, 'eliminated'),
      eliminatedWeek: null,
      currentFab,
      points: [{ week: 0, weekProgress: 0, fab: waiverCap, timestamp: 0 }]
    };
  });
  
  // Process transactions with timestamp precision
  const sortedTx = transactions
    .filter(tx => tx.status === 'complete' && tx.type === 'waiver')
    .sort((a, b) => {
      if (a._week !== b._week) return a._week - b._week;
      return (a.status_updated || 0) - (b.status_updated || 0);
    });
  
  sortedTx.forEach(tx => {
    if (!tx.roster_ids || !tx.roster_ids.length) return;
    const rosterId = Number(tx.roster_ids[0]);
    const week = tx._week;
    const bid = Number((tx.settings && tx.settings.waiver_bid) || 0);
    const timestamp = tx.status_updated || tx.created || 0;
    
    if (!timelines[rosterId]) return;
    
    const timeline = timelines[rosterId];
    const lastPoint = timeline.points[timeline.points.length - 1];
    const newFab = lastPoint.fab - bid;
    
    // Calculate week progress (0-1) based on timestamp within the week
    // Week boundaries are approximate (Wednesday to Wednesday)
    const weekStartMs = 1694649600000 + (week - 1) * 7 * 24 * 60 * 60 * 1000; // Approx start of season
    const weekDurationMs = 7 * 24 * 60 * 60 * 1000;
    const weekProgress = Math.max(0, Math.min(1, (timestamp - weekStartMs) / weekDurationMs));
    
    timeline.points.push({ 
      week, 
      weekProgress, 
      fab: newFab,
      timestamp
    });
  });
  
  // Fill in eliminated week
  Object.values(timelines).forEach(timeline => {
    if (timeline.isEliminated) {
      const rosters = cache.rosters.get(leagueId) || [];
      const roster = rosters.find(r => Number(r.roster_id) === timeline.rosterId);
      if (roster && roster.settings && roster.settings.eliminated) {
        timeline.eliminatedWeek = roster.settings.eliminated;
      }
    }
  });
  
  return Object.values(timelines);
}

function buildLeagueSegmentedControl(onFilterChange) {
  const container = el('div', { class: 'segmented-control' });
  
  const options = [
    { value: 'both', label: 'Both' },
    { value: LEAGUE_IDS[0].id, label: cache.leagues.get(LEAGUE_IDS[0].id)?.name || LEAGUE_IDS[0].label },
    { value: LEAGUE_IDS[1].id, label: cache.leagues.get(LEAGUE_IDS[1].id)?.name || LEAGUE_IDS[1].label }
  ];
  
  options.forEach(opt => {
    const btn = el('button', {
      class: 'segment-btn' + (opt.value === currentFilter ? ' active' : ''),
      onclick: () => {
        currentFilter = opt.value;
        container.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onFilterChange(opt.value);
      }
    }, opt.label);
    btn.dataset.value = opt.value;
    container.append(btn);
  });
  
  return container;
}

function buildTeamStatusSegmentedControl(onFilterChange) {
  const container = el('div', { class: 'segmented-control' });
  
  const options = [
    { value: 'all', label: 'All Teams' },
    { value: 'remaining', label: 'Remaining' },
    { value: 'chopped', label: 'Chopped' }
  ];
  
  options.forEach(opt => {
    const btn = el('button', {
      class: 'segment-btn' + (opt.value === currentTeamStatusFilter ? ' active' : ''),
      onclick: () => {
        currentTeamStatusFilter = opt.value;
        container.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onFilterChange(opt.value);
      }
    }, opt.label);
    btn.dataset.value = opt.value;
    container.append(btn);
  });
  
  return container;
}

// Helper to create smooth Bezier curves through points
function createSmoothPath(points, xScale, yScale, overrideEndX = null, overrideEndY = null) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const point = points[0];
    const x = point._overrideX !== undefined ? point._overrideX : xScale(point.week + point.weekProgress);
    const y = point._overrideY !== undefined ? point._overrideY : yScale(point.fab);
    return `M ${x} ${y}`;
  }
  
  let path = '';
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    // Use override coordinates for last point if provided
    const isLastPoint = i === points.length - 1;
    const x = (isLastPoint && point._overrideX !== undefined) ? point._overrideX : xScale(point.week + point.weekProgress);
    const y = (isLastPoint && point._overrideY !== undefined) ? point._overrideY : yScale(point.fab);
    
    if (i === 0) {
      path += `M ${x} ${y}`;
    } else {
      const prevPoint = points[i - 1];
      const prevX = xScale(prevPoint.week + prevPoint.weekProgress);
      const prevY = yScale(prevPoint.fab);
      
      // Calculate FAB drop magnitude to adjust curve tension
      const fabDrop = Math.abs(point.fab - prevPoint.fab);
      const timeGap = (point.week + point.weekProgress) - (prevPoint.week + prevPoint.weekProgress);
      
      // For large FAB drops in short time, create a smoother S-curve transition
      // Control point tension: smaller for bigger drops (smoother curve)
      const tension = Math.max(0.3, Math.min(0.6, 1 - (fabDrop / 200)));
      
      const cp1x = prevX + (x - prevX) * tension;
      const cp1y = prevY + (y - prevY) * 0.1; // Slight vertical movement
      const cp2x = prevX + (x - prevX) * (1 - tension);
      const cp2y = prevY + (y - prevY) * 0.9; // Most vertical movement near end
      
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x} ${y}`;
    }
  }
  
  return path;
}

// Helper to get interpolated position on Bezier curve for avatar placement
function getBezierPoint(p0, p1, cp1, cp2, t) {
  // Cubic Bezier formula: B(t) = (1-t)³P0 + 3(1-t)²tCP1 + 3(1-t)t²CP2 + t³P1
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  
  return {
    x: mt3 * p0.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * p1.x,
    y: mt3 * p0.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * p1.y
  };
}

// Get avatar position along the smooth curve (not just at endpoint)
function getAvatarPosition(points, xScale, yScale, currentWeekWithProgress) {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return {
      x: xScale(points[0].week + points[0].weekProgress),
      y: yScale(points[0].fab)
    };
  }
  
  // Find which segment we're in
  for (let i = 1; i < points.length; i++) {
    const prevPoint = points[i - 1];
    const point = points[i];
    const prevWeek = prevPoint.week + prevPoint.weekProgress;
    const currWeek = point.week + point.weekProgress;
    
    if (currentWeekWithProgress >= prevWeek && currentWeekWithProgress <= currWeek) {
      // We're in this segment, interpolate along the Bezier curve
      const prevX = xScale(prevWeek);
      const prevY = yScale(prevPoint.fab);
      const currX = xScale(currWeek);
      const currY = yScale(point.fab);
      
      // Calculate control points (same logic as createSmoothPath)
      const fabDrop = Math.abs(point.fab - prevPoint.fab);
      const tension = Math.max(0.3, Math.min(0.6, 1 - (fabDrop / 200)));
      
      const cp1 = {
        x: prevX + (currX - prevX) * tension,
        y: prevY + (currY - prevY) * 0.1
      };
      const cp2 = {
        x: prevX + (currX - prevX) * (1 - tension),
        y: prevY + (currY - prevY) * 0.9
      };
      
      // Calculate t (0 to 1) within this segment
      const weekDiff = currWeek - prevWeek;
      const segmentProgress = weekDiff > 0 ? (currentWeekWithProgress - prevWeek) / weekDiff : 0;
      
      return getBezierPoint(
        { x: prevX, y: prevY },
        { x: currX, y: currY },
        cp1,
        cp2,
        segmentProgress
      );
    }
  }
  
  // Default to last point
  const lastPoint = points[points.length - 1];
  return {
    x: xScale(lastPoint.week + lastPoint.weekProgress),
    y: yScale(lastPoint.fab)
  };
}

function renderChart(timelines, animationProgress = 1.0) {
  // Safety check for empty timelines
  if (!timelines || timelines.length === 0) {
    console.warn('No timelines to render');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', 900);
    svg.setAttribute('height', 600);
    return svg;
  }
  
  const width = 900;
  const height = 600;
  const marginTop = 40;
  const marginRight = 80;
  const marginBottom = 50;
  const marginLeft = 60;
  
  const chartWidth = width - marginLeft - marginRight;
  const chartHeight = height - marginTop - marginBottom;
  
  // Use static max values calculated from baseTimelines (not filtered timelines)
  const maxFab = staticMaxFab;
  const maxWeek = staticMaxWeek;
  
  const xScale = (weekWithProgress) => marginLeft + (weekWithProgress / maxWeek) * chartWidth;
  const yScale = (fab) => marginTop + chartHeight - (fab / maxFab) * chartHeight;
  
  // Create SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('fab-chart');
  
  // Add grid lines
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  gridGroup.classList.add('grid');
  
  // Horizontal grid lines (FAB)
  const fabSteps = 5;
  for (let i = 0; i <= fabSteps; i++) {
    const fab = (maxFab / fabSteps) * i;
    const y = yScale(fab);
    
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', marginLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', marginLeft + chartWidth);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#e0e0e0');
    line.setAttribute('stroke-width', '1');
    gridGroup.appendChild(line);
    
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', marginLeft - 10);
    text.setAttribute('y', y + 4);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('font-size', '12');
    text.setAttribute('fill', '#666');
    text.textContent = `$${Math.round(fab)}`;
    gridGroup.appendChild(text);
  }
  
  // Vertical grid lines (weeks)
  for (let week = 0; week <= maxWeek; week += 2) {
    const x = xScale(week);
    
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', marginTop);
    line.setAttribute('x2', x);
    line.setAttribute('y2', marginTop + chartHeight);
    line.setAttribute('stroke', '#e0e0e0');
    line.setAttribute('stroke-width', '1');
    gridGroup.appendChild(line);
    
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', marginTop + chartHeight + 20);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '12');
    text.setAttribute('fill', '#666');
    text.textContent = `${week}`;
    gridGroup.appendChild(text);
  }
  
  svg.appendChild(gridGroup);
  
  // Add axis labels
  const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  xLabel.setAttribute('x', marginLeft + chartWidth / 2);
  xLabel.setAttribute('y', height - 10);
  xLabel.setAttribute('text-anchor', 'middle');
  xLabel.setAttribute('font-size', '14');
  xLabel.setAttribute('font-weight', 'bold');
  xLabel.setAttribute('fill', '#333');
  xLabel.textContent = 'Week';
  svg.appendChild(xLabel);
  
  const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  yLabel.setAttribute('x', -marginTop - chartHeight / 2);
  yLabel.setAttribute('y', 20);
  yLabel.setAttribute('text-anchor', 'middle');
  yLabel.setAttribute('font-size', '14');
  yLabel.setAttribute('font-weight', 'bold');
  yLabel.setAttribute('fill', '#333');
  yLabel.setAttribute('transform', `rotate(-90)`);
  yLabel.textContent = 'FAB Remaining';
  svg.appendChild(yLabel);
  
  // Sort timelines by current FAB (descending) for z-order
  const sortedTimelines = timelines.map((t, originalIndex) => ({ ...t, originalIndex }));
  sortedTimelines.sort((a, b) => b.currentFab - a.currentFab);
  
  // Store line data for each team
  const lineEndpoints = new Map();
  
  // First pass: calculate visible points for each timeline
  sortedTimelines.forEach(({ originalIndex, ...timeline }) => {
    const index = originalIndex;
    const teamKey = `${timeline.leagueId}-${timeline.rosterId}`;
    const color = teamColorMap.get(teamKey) || CHART_COLORS[0];
    
    // Determine which points to show based on animation progress
    let visiblePoints = timeline.points;
    if (animationProgress < 1.0) {
      const targetWeek = maxWeek * animationProgress;
      visiblePoints = [];
      
      for (let i = 0; i < timeline.points.length; i++) {
        const point = timeline.points[i];
        const pointWeek = point.week + point.weekProgress;
        
        if (pointWeek <= targetWeek) {
          visiblePoints.push(point);
        } else {
          // Interpolate the partial point within the week
          if (i > 0) {
            const prevPoint = timeline.points[i - 1];
            const prevWeek = prevPoint.week + prevPoint.weekProgress;
            const weekDiff = pointWeek - prevWeek;
            const fabDiff = point.fab - prevPoint.fab;
            const progress = (targetWeek - prevWeek) / weekDiff;
            
            visiblePoints.push({
              week: Math.floor(targetWeek),
              weekProgress: targetWeek - Math.floor(targetWeek),
              fab: prevPoint.fab + fabDiff * progress,
              timestamp: prevPoint.timestamp
            });
          }
          break;
        }
      }
      
      if (visiblePoints.length === 0 && timeline.points.length > 0) {
        visiblePoints = [timeline.points[0]];
      }
    }
    
    // At full animation, extend timelines to their end point
    if (animationProgress === 1.0 && visiblePoints.length > 0) {
      const lastVisible = visiblePoints[visiblePoints.length - 1];
      
      if (timeline.isEliminated && timeline.eliminatedWeek) {
        // For eliminated teams, extend to elimination week
        visiblePoints = visiblePoints.filter(p => p.week <= timeline.eliminatedWeek);
        if (visiblePoints.length > 0) {
          const lastFiltered = visiblePoints[visiblePoints.length - 1];
          if (lastFiltered.week < timeline.eliminatedWeek) {
            visiblePoints.push({ 
              week: timeline.eliminatedWeek, 
              weekProgress: 0,
              fab: lastFiltered.fab,
              timestamp: lastFiltered.timestamp
            });
          }
        }
      } else {
        // For non-eliminated teams, extend to current week
        if (lastVisible.week < CURRENT_WEEK) {
          visiblePoints.push({ 
            week: CURRENT_WEEK, 
            weekProgress: 0,
            fab: lastVisible.fab,
            timestamp: lastVisible.timestamp
          });
        }
      }
    }
    
    // Calculate if team should be grayed out at current animation progress
    const currentAnimationWeek = maxWeek * animationProgress;
    const isEliminatedAtCurrentTime = timeline.isEliminated && 
                                       timeline.eliminatedWeek && 
                                       currentAnimationWeek >= timeline.eliminatedWeek;
    
    if (visiblePoints.length === 0) return;
    
    // Store the calculated endpoint (before jitter) and the visible points
    const lastPoint = visiblePoints[visiblePoints.length - 1];
    const currentWeekWithProgress = lastPoint.week + (lastPoint.weekProgress || 0);
    
    // For the avatar position, use the actual last point coordinates directly
    // This ensures the avatar is at the end of the line, even for eliminated teams
    const baseEndpoint = {
      x: xScale(currentWeekWithProgress),
      y: yScale(lastPoint.fab)
    };
    
    lineEndpoints.set(index, { visiblePoints, baseEndpoint, fab: lastPoint.fab, isEliminatedAtCurrentTime });
  });
  
  // Calculate jitter offsets for overlapping avatars using the same visible points
  const avatarPositions = [];
  lineEndpoints.forEach((data, index) => {
    const { visiblePoints, baseEndpoint, fab, isEliminatedAtCurrentTime } = data;
    const timeline = sortedTimelines.find(t => t.originalIndex === index);
    if (!timeline || !baseEndpoint) return;
    
    avatarPositions.push({
      originalIndex: index,
      timeline,
      x: baseEndpoint.x,
      y: baseEndpoint.y,
      fab,
      visiblePoints,
      isEliminatedAtCurrentTime
    });
  });
  
  // Apply jitter to overlapping positions
  const JITTER_THRESHOLD = 5;
  const JITTER_OFFSET = 5; // Increased by 2px
  
  avatarPositions.forEach((pos, i) => {
    let yOffset = 0;
    let xOffset = 0;
    
    for (let j = 0; j < i; j++) {
      const other = avatarPositions[j];
      const dx = Math.abs(pos.x - (other.x + (other.xOffset || 0)));
      const dy = Math.abs(pos.y - (other.y + (other.yOffset || 0)));
      
      if (dx < JITTER_THRESHOLD && dy < JITTER_THRESHOLD) {
        yOffset += JITTER_OFFSET;
        xOffset += JITTER_OFFSET * 0.5;
      }
    }
    
    pos.xOffset = xOffset;
    pos.yOffset = yOffset;
  });
  
  // Create container group for lines
  const linesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  linesGroup.classList.add('lines-group');
  
  // Now draw lines with corrected endpoints
  avatarPositions.forEach(({ originalIndex, x, y, xOffset, yOffset, isEliminatedAtCurrentTime }) => {
    const index = originalIndex;
    const lineData = lineEndpoints.get(index);
    if (!lineData) return;
    
    const { visiblePoints } = lineData;
    const timeline = sortedTimelines.find(t => t.originalIndex === index);
    if (!timeline) return;
    
    const teamKey = `${timeline.leagueId}-${timeline.rosterId}`;
    const teamColor = teamColorMap.get(teamKey) || CHART_COLORS[0];
    const color = isEliminatedAtCurrentTime ? '#999' : teamColor;
    
    // Create path but replace last point with actual avatar position (with jitter)
    const adjustedPoints = [...visiblePoints];
    if (adjustedPoints.length > 0) {
      const lastPoint = adjustedPoints[adjustedPoints.length - 1];
      // Create a modified last point that will render at the avatar position
      adjustedPoints[adjustedPoints.length - 1] = {
        ...lastPoint,
        // Override the position calculation by storing the actual coordinates WITH jitter
        _overrideX: x + xOffset,
        _overrideY: y + yOffset
      };
    }
    
    // Draw line using smooth curves
    const pathData = createSmoothPath(adjustedPoints, xScale, yScale, x, y);
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '3');
    path.setAttribute('fill', 'none');
    path.classList.add('team-line');
    path.dataset.teamIndex = index;
    path.dataset.teamName = timeline.teamName;
    path.dataset.fab = Math.round(timeline.currentFab);
    path.dataset.isEliminated = timeline.isEliminated;
    path.style.cursor = 'pointer';
    
    // Gray out eliminated teams
    if (isEliminatedAtCurrentTime) {
      path.setAttribute('opacity', hoveredTeamIndex === index ? '0.6' : '0.3');
    }
    
    // Apply opacity based on hover state
    if (hoveredTeamIndex !== null && hoveredTeamIndex !== index) {
      path.setAttribute('opacity', '0.4');
    } else {
      path.setAttribute('opacity', '1');
    }
    
    // Add glow filter if hovered
    if (hoveredTeamIndex === index) {
      path.setAttribute('filter', 'url(#glow)');
      path.setAttribute('stroke-width', '4');
    }
    
    linesGroup.appendChild(path);
  });
  
  svg.appendChild(linesGroup);
  
  // Draw avatars and labels on top
  const avatarsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  avatarsGroup.classList.add('avatars-group');
  
  avatarPositions.forEach(({ originalIndex, timeline, x, y, fab, xOffset, yOffset, visiblePoints, isEliminatedAtCurrentTime }) => {
    const index = originalIndex;
    const teamKey = `${timeline.leagueId}-${timeline.rosterId}`;
    const color = teamColorMap.get(teamKey) || CHART_COLORS[0];
    
    // Apply jitter offsets
    const endX = x + xOffset;
    const endY = y + yOffset;
    
    const isGrayedOut = isEliminatedAtCurrentTime;
    
    // Avatar group (for hover and tooltip)
    const avatarGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    avatarGroup.dataset.teamIndex = index;
    avatarGroup.dataset.teamName = timeline.teamName;
    avatarGroup.dataset.fab = Math.round(fab);
    avatarGroup.dataset.isEliminated = isGrayedOut;
    avatarGroup.style.cursor = 'pointer';
    
    // If this team is hovered, increase z-order by moving to front
    if (hoveredTeamIndex === index) {
      avatarGroup.style.zIndex = '1000';
    }
    
    // Avatar circle background
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', endX);
    circle.setAttribute('cy', endY);
    circle.setAttribute('r', '20');
    circle.setAttribute('fill', isGrayedOut ? '#ccc' : color);
    circle.setAttribute('stroke', isGrayedOut ? '#999' : color);
    circle.setAttribute('stroke-width', '2');
    avatarGroup.appendChild(circle);
    
    if (timeline.avatar) {
      const avatarImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      avatarImg.setAttribute('x', endX - 16);
      avatarImg.setAttribute('y', endY - 16);
      avatarImg.setAttribute('width', '32');
      avatarImg.setAttribute('height', '32');
      avatarImg.setAttribute('href', `https://sleepercdn.com/avatars/thumbs/${timeline.avatar}`);
      const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      clipPath.setAttribute('id', `clip-${index}`);
      const clipCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      clipCircle.setAttribute('cx', endX);
      clipCircle.setAttribute('cy', endY);
      clipCircle.setAttribute('r', '16');
      clipPath.appendChild(clipCircle);
      svg.appendChild(clipPath);
      avatarImg.setAttribute('clip-path', `url(#clip-${index})`);
      if (isGrayedOut) {
        avatarImg.setAttribute('opacity', '0.4');
      }
      avatarGroup.appendChild(avatarImg);
    } else {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', endX);
      text.setAttribute('y', endY + 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '12');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('fill', isGrayedOut ? '#666' : '#fff');
      text.textContent = timeline.initials;
      avatarGroup.appendChild(text);
    }
    
    avatarsGroup.appendChild(avatarGroup);
  });
  
  svg.appendChild(avatarsGroup);
  
  // Add glow filter definition
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', 'glow');
  const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  feGaussianBlur.setAttribute('stdDeviation', '3');
  feGaussianBlur.setAttribute('result', 'coloredBlur');
  const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
  const feMergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
  feMergeNode1.setAttribute('in', 'coloredBlur');
  const feMergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
  feMergeNode2.setAttribute('in', 'SourceGraphic');
  feMerge.appendChild(feMergeNode1);
  feMerge.appendChild(feMergeNode2);
  filter.appendChild(feGaussianBlur);
  filter.appendChild(feMerge);
  defs.appendChild(filter);
  svg.insertBefore(defs, svg.firstChild);
  
  // Add hover event listeners (tooltip will be managed at container level)
  svg.querySelectorAll('[data-team-index]').forEach(el => {
    el.addEventListener('mouseenter', (e) => {
      const teamIndex = Number(el.dataset.teamIndex);
      hoveredTeamIndex = teamIndex;
      
      // Move this avatar group to the end (highest z-order)
      const avatarGroup = el;
      avatarGroup.parentNode.appendChild(avatarGroup);
      
      // Get or create tooltip in the chart container (survives SVG replacements)
      const chartContainer = svg.parentNode;
      if (!chartContainer) return;
      
      let tooltip = chartContainer.querySelector('.chart-tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        chartContainer.appendChild(tooltip);
      }
      
      // Show tooltip
      const teamName = el.dataset.teamName;
      const fab = el.dataset.fab;
      const isEliminated = el.dataset.isEliminated === 'true';
      
      const statusText = isEliminated ? 'FAB at Elimination' : 'Current FAB';
      tooltip.innerHTML = `
        <div class="tooltip-team">${teamName}</div>
        <div class="tooltip-fab">${statusText}: $${Number(fab).toLocaleString()}</div>
      `;
      tooltip.style.display = 'block';
      
      // If not animating, re-render to show hover effects
      if (!isAnimating) {
        const chartContainer = svg.parentNode;
        const existingSvg = chartContainer?.querySelector('svg');
        if (existingSvg && chartContainer) {
          const filtered = filterTimelinesForView(baseTimelines);
          const newChart = renderChart(filtered, currentAnimationProgress);
          chartContainer.replaceChild(newChart, existingSvg);
        }
      }
    });
  });
  
  svg.addEventListener('mouseleave', () => {
    if (hoveredTeamIndex !== null) {
      hoveredTeamIndex = null;
      const chartContainer = svg.parentNode;
      if (chartContainer) {
        const tooltip = chartContainer.querySelector('.chart-tooltip');
        if (tooltip) {
          tooltip.style.display = 'none';
        }
        
        // If not animating, re-render to remove hover effects
        if (!isAnimating) {
          const existingSvg = chartContainer.querySelector('svg');
          if (existingSvg) {
            const filtered = filterTimelinesForView(baseTimelines);
            const newChart = renderChart(filtered, currentAnimationProgress);
            chartContainer.replaceChild(newChart, existingSvg);
          }
        }
      }
    }
  });
  
  // Update tooltip position on mouse move
  svg.addEventListener('mousemove', (e) => {
    if (hoveredTeamIndex !== null) {
      const chartContainer = svg.parentNode;
      if (chartContainer) {
        const tooltip = chartContainer.querySelector('.chart-tooltip');
        if (tooltip) {
          const rect = chartContainer.getBoundingClientRect();
          tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
          tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        }
      }
    }
  });
  
  return svg;
}

function filterTimelinesForView(all) {
  if (!all || all.length === 0) {
    return [];
  }
  
  let arr = all;
  // League filter
  if (currentFilter !== 'both') {
    arr = arr.filter(t => t.leagueId === currentFilter);
  }
  // Team status filter
  if (currentTeamStatusFilter === 'remaining') {
    arr = arr.filter(t => !t.isEliminated);
  } else if (currentTeamStatusFilter === 'chopped') {
    arr = arr.filter(t => t.isEliminated);
  }
  // Sort by current FAB (descending, use last point)
  arr = arr.slice().sort((a, b) => {
    const aFab = a.points[a.points.length - 1].fab;
    const bFab = b.points[b.points.length - 1].fab;
    return bFab - aFab;
  });
  return arr;
}

function applyFiltersAndRerender(container) {
  const filtered = filterTimelinesForView(baseTimelines);
  if (isAnimating) {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    isAnimating = false; // we'll restart animation at same progress
    resumeReplay(container, currentAnimationProgress);
  } else if (isPaused) {
    const chart = renderChart(filtered, currentAnimationProgress);
    const replayBtn = el('button', { class: 'btn replay-btn', onclick: () => resumeReplay(container, currentAnimationProgress) }, '▶ Resume');
    const controls = el('div', { class: 'chart-controls' },
      replayBtn,
      buildLeagueSegmentedControl(() => applyFiltersAndRerender(container)),
      buildTeamStatusSegmentedControl(() => applyFiltersAndRerender(container))
    );
    const chartContainer = el('div', { class: 'chart-container' });
    chartContainer.appendChild(chart);
    container.replaceChildren(controls, chartContainer);
  } else {
    // static state
    const chart = renderChart(filtered, 1.0);
    const replayBtn = el('button', { class: 'btn replay-btn', onclick: () => startReplay(container) }, '▶ Replay');
    const controls = el('div', { class: 'chart-controls' },
      replayBtn,
      buildLeagueSegmentedControl(() => applyFiltersAndRerender(container)),
      buildTeamStatusSegmentedControl(() => applyFiltersAndRerender(container))
    );
    const chartContainer = el('div', { class: 'chart-container' });
    chartContainer.appendChild(chart);
    container.replaceChildren(controls, chartContainer);
  }
}

async function renderFABSpendingView(container, filter) {
  container.replaceChildren(el('div', { class: 'loading' }, 'Loading FAB data...'));
  
  try {
    // Fetch all data
    baseTimelines = [];
    for (const leagueCfg of LEAGUE_IDS) {
      await fetchLeagueTransactions(leagueCfg.id);
      const timelines = computeFABTimeline(leagueCfg.id);
      baseTimelines.push(...timelines);
    }

    // Assign stable colors to each team based on their unique identifier
    teamColorMap.clear();
    baseTimelines.forEach((t, index) => {
      const teamKey = `${t.leagueId}-${t.rosterId}`;
      teamColorMap.set(teamKey, CHART_COLORS[index % CHART_COLORS.length]);
    });

    // Calculate static max week from all base timelines
    staticMaxWeek = 0;
    baseTimelines.forEach(t => {
      t.points.forEach(p => {
        const weekPos = p.week + p.weekProgress;
        if (weekPos > staticMaxWeek) staticMaxWeek = weekPos;
      });
    });
    if (staticMaxWeek === 0) staticMaxWeek = MAX_WEEKS;

    // Initialize filters and state
    currentFilter = filter || currentFilter;
    isAnimating = false;
    isPaused = false;
    pausedProgress = 0;
    hoveredTeamIndex = null;
    currentAnimationProgress = 1.0;

    // Initial render
    const filteredTimelines = filterTimelinesForView(baseTimelines);
    const chart = renderChart(filteredTimelines);

    const replayBtn = el('button', { class: 'btn replay-btn', onclick: () => startReplay(container) }, '▶ Replay');

    const controls = el('div', { class: 'chart-controls' },
      replayBtn,
      buildLeagueSegmentedControl(() => applyFiltersAndRerender(container)),
      buildTeamStatusSegmentedControl(() => applyFiltersAndRerender(container))
    );

    const chartContainer = el('div', { class: 'chart-container' });
    chartContainer.appendChild(chart);

    container.replaceChildren(controls, chartContainer);
  } catch (err) {
    container.replaceChildren(
      el('div', { class: 'err' }, 'Failed to load FAB data: ' + err.message)
    );
  }
}

function pauseReplay(container, currentProgress) {
  if (!isAnimating) return;
  isPaused = true;
  isAnimating = false;
  pausedProgress = currentProgress;
  currentAnimationProgress = currentProgress;
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  applyFiltersAndRerender(container);
}

function resumeReplay(container, startProgress) {
  if (isAnimating) return;
  
  isPaused = false;
  isAnimating = true;
  const startTime = Date.now() - (startProgress * REPLAY_DURATION_MS);
  
  // Create controls once before animation starts
  const replayBtn = el('button', {
    class: 'btn replay-btn',
    onclick: () => pauseReplay(container, currentAnimationProgress)
  }, '⏸ Pause');
  
  const controls = el('div', { class: 'chart-controls' },
    replayBtn,
    buildLeagueSegmentedControl(() => applyFiltersAndRerender(container)),
    buildTeamStatusSegmentedControl(() => applyFiltersAndRerender(container))
  );
  
  const chartContainer = el('div', { class: 'chart-container' });
  
  // Create persistent tooltip element
  const tooltip = el('div', { class: 'chart-tooltip', style: 'display: none;' });
  chartContainer.appendChild(tooltip);
  
  // Add controls to container once
  container.replaceChildren(controls, chartContainer);
  
  // Render initial frame
  const initialChart = renderChart(filterTimelinesForView(baseTimelines), startProgress);
  chartContainer.insertBefore(initialChart, tooltip);
  
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / REPLAY_DURATION_MS, 1.0);
    pausedProgress = progress;
    currentAnimationProgress = progress;
    
    const filteredTimelines = filterTimelinesForView(baseTimelines);
    const chart = renderChart(filteredTimelines, progress);
    
    // Replace only the SVG, keep the tooltip
    const existingSvg = chartContainer.querySelector('svg');
    if (existingSvg) {
      chartContainer.replaceChild(chart, existingSvg);
    } else {
      chartContainer.insertBefore(chart, chartContainer.firstChild);
    }
    
    if (progress < 1.0 && !isPaused) {
      animationFrameId = requestAnimationFrame(animate);
    } else if (progress >= 1.0) {
      isAnimating = false;
      isPaused = false;
      pausedProgress = 0;
      // Show replay button again
      renderFinalState(container);
    }
  };
  
  animate();
}

function renderFinalState(container) {
  isAnimating = false;
  isPaused = false;
  currentAnimationProgress = 1.0;
  applyFiltersAndRerender(container);
}

function startReplay(container) {
  if (isAnimating) {
    // If paused, resume from where we left off
    if (isPaused) {
      resumeReplay(container, pausedProgress);
    }
    return;
  }
  
  pausedProgress = 0;
  resumeReplay(container, 0);
}

export async function loadFABSpending() {
  const container = document.getElementById('fab-spending-content');
  await renderFABSpendingView(container, currentFilter);
}
