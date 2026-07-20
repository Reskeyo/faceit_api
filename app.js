// Cloudflare Worker proxy URL
// This is the public URL of your deployed Worker — the API key lives only in the Worker (server-side).
const WORKER_URL = "https://faceit-proxy.dolinskzyyvictor.workers.dev";

// Application State
let state = {
    nickname: '',
    player: null,
    stats: null,
    detailedMatches: [],
    bans: [],
    matchOffset: 0,
    hasMoreMatches: true,
    matchFilters: {
        map: 'ALL',
        result: 'ALL',
        leaverOnly: false
    },
    activeTab: 'tab-overview'
};

// Global Timers & Chart Instances
let banCountdownInterval = null;
let kdChartInstance = null;
let mapWinrateChartInstance = null;

// Constants
const ROLLING_WINDOW_DAYS = 30;
const ROLLING_WINDOW_MS = ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const INFRACTION_ESCALATION = [
    { label: "1st Infraction", durationText: "30 Minutes", durationMs: 30 * 60 * 1000 },
    { label: "2nd Infraction", durationText: "2 Hours", durationMs: 2 * 60 * 60 * 1000 },
    { label: "3rd Infraction", durationText: "4 Hours", durationMs: 4 * 60 * 60 * 1000 },
    { label: "4th Infraction", durationText: "8 Hours", durationMs: 8 * 60 * 60 * 1000 },
    { label: "5th Infraction", durationText: "12 Hours", durationMs: 12 * 60 * 60 * 1000 },
    { label: "6th Infraction", durationText: "24 Hours (1 Day)", durationMs: 24 * 60 * 60 * 1000 },
    { label: "7th Infraction", durationText: "48 Hours (2 Days)", durationMs: 48 * 60 * 60 * 1000 },
    { label: "8+ Infractions", durationText: "1 Week (7 Days)", durationMs: 7 * 24 * 60 * 60 * 1000 }
];

// Initialize Application (Search box starts completely EMPTY)
window.addEventListener('DOMContentLoaded', () => {
    checkApiKeySetup();
    // Intentionally keep search input empty on page load
    document.getElementById('nickname-search').value = '';
});

// Tab Switching Mechanism
function switchTab(tabId) {
    state.activeTab = tabId;

    // Toggle navigation tab buttons active class
    const tabButtons = document.querySelectorAll('.nav-tab-btn');
    tabButtons.forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Toggle tab content sections
    const tabSections = document.querySelectorAll('.tab-content');
    tabSections.forEach(section => {
        if (section.id === tabId) {
            section.style.display = 'block';
        } else {
            section.style.display = 'none';
        }
    });
}

// Retrieve Worker URL: checks injected constant first, then local storage
function getWorkerUrl() {
    if (WORKER_URL && WORKER_URL.length > 0 && !WORKER_URL.startsWith('__')) {
        return WORKER_URL.trim().replace(/\/$/, '');
    }
    const saved = localStorage.getItem('faceit_worker_url_v1');
    if (saved && saved.trim().length > 0) {
        return saved.trim().replace(/\/$/, '');
    }
    return null;
}

// Check if the Worker URL has been configured
function checkApiKeySetup() {
    const warningCard = document.getElementById('dev-warning-card');
    const workerUrl = getWorkerUrl();
    const isConfigured = workerUrl !== null && workerUrl.length > 0;
    
    if (!isConfigured) {
        warningCard.style.display = 'block';
        document.getElementById('app-nav-tabs').style.display = 'none';
        hideAllTabContents();
    } else {
        warningCard.style.display = 'none';
    }
    return isConfigured;
}

function hideAllTabContents() {
    const tabSections = document.querySelectorAll('.tab-content');
    tabSections.forEach(section => section.style.display = 'none');
}

// Save user entered Worker URL into local storage
function saveUserApiKey() {
    const input = document.getElementById('user-api-key-input');
    const val = input ? input.value.trim() : '';
    if (!val) {
        alert('Please enter a valid Worker URL.');
        return;
    }
    localStorage.setItem('faceit_worker_url_v1', val);
    const configured = checkApiKeySetup();
    if (configured) {
        alert('Worker URL saved! Enter a FACEIT Nickname above and click Search Player.');
    }
}

// Handle nickname search submit
function handleSearchSubmit(event) {
    event.preventDefault();
    const query = document.getElementById('nickname-search').value.trim();
    if (!query) return;

    state.nickname = query;
    state.detailedMatches = [];
    state.matchOffset = 0;
    state.hasMoreMatches = true;
    
    if (checkApiKeySetup()) {
        fetchStats();
    }
}

// Core Fetching Mechanism — routes through Cloudflare Worker proxy
async function faceitFetch(endpoint) {
    const workerUrl = getWorkerUrl();
    if (!workerUrl) {
        throw new Error('Proxy Worker URL is not configured.');
    }

    const targetUrl = `${workerUrl}/faceit/${endpoint}`;

    const response = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Unauthorized: The API Key stored in the Worker is invalid.');
        } else if (response.status === 404) {
            throw new Error('Not Found: Player or resource could not be found.');
        } else {
            throw new Error(`Proxy Error (Status ${response.status})`);
        }
    }

    return response.json();
}

// Robust Stat Value Helper (Searches case-insensitively for key aliases)
function getStat(statsObj, aliases, defaultValue = '-') {
    if (!statsObj) return defaultValue;
    const keys = Object.keys(statsObj);
    for (const alias of aliases) {
        const target = alias.toLowerCase();
        const matchedKey = keys.find(k => k.toLowerCase() === target);
        if (matchedKey && statsObj[matchedKey] !== undefined && statsObj[matchedKey] !== null) {
            let val = String(statsObj[matchedKey]).trim();
            if (val.length > 0) return val;
        }
    }
    return defaultValue;
}

// Main Fetch Statistics Function
async function fetchStats() {
    const nickname = state.nickname;
    if (!nickname) return;

    // Show Global Loader & Tab Bar
    document.getElementById('global-loading').style.display = 'block';
    document.getElementById('loading-text').innerText = `Fetching profile & scanning 30-day match history for ${nickname}...`;
    document.getElementById('app-nav-tabs').style.display = 'flex';
    
    hideAllTabContents();

    try {
        // Step 1: Fetch player main info
        const playerProfile = await faceitFetch(`players?nickname=${encodeURIComponent(nickname)}`);
        state.player = playerProfile;
        const player_id = playerProfile.player_id;
        
        // Map profile details
        document.getElementById('user-name').innerText = playerProfile.nickname || nickname;
        document.getElementById('user-country').innerText = playerProfile.country ? playerProfile.country.toUpperCase() : 'EU';
        if (playerProfile.avatar) {
            document.getElementById('user-avatar').src = playerProfile.avatar;
        }

        const cs2Game = playerProfile.games && playerProfile.games.cs2;
        const skillLevel = cs2Game ? cs2Game.skill_level : 1;
        const elo = cs2Game ? cs2Game.faceit_elo : 1000;

        document.getElementById('elo-value').innerText = elo;
        updateLevelBadge(skillLevel);

        // Step 2: Fetch CS2 Lifetime & Map Stats
        let cs2Stats = null;
        try {
            cs2Stats = await faceitFetch(`players/${player_id}/stats/cs2`);
            state.stats = cs2Stats;
        } catch (err) {
            console.warn('No specific CS2 lifetime stats found.', err);
        }

        if (cs2Stats && cs2Stats.lifetime) {
            const lifetime = cs2Stats.lifetime;
            
            const matches = getStat(lifetime, ['Matches', 'Matches Played', 'Total Matches']);
            const winRateRaw = getStat(lifetime, ['Win Rate %', 'Win Rate', 'Winrate %']);
            const winRate = winRateRaw !== '-' ? (winRateRaw.includes('%') ? winRateRaw : `${winRateRaw}%`) : '-';
            const kd = getStat(lifetime, ['Average K/D Ratio', 'K/D Ratio', 'KD Ratio']);
            const streak = getStat(lifetime, ['Current Win Streak', 'Win Streak', 'Streak'], '0');
            const hsPctRaw = getStat(lifetime, ['Average Headshots %', 'Headshots %', 'Headshot %']);
            const hsPct = hsPctRaw !== '-' ? (hsPctRaw.includes('%') ? hsPctRaw : `${hsPctRaw}%`) : '-';
            
            const totalKills = getStat(lifetime, ['Total Kills', 'Kills']);
            const kr = getStat(lifetime, ['Average K/R Ratio', 'K/R Ratio', 'KR Ratio']);
            const longestStreak = getStat(lifetime, ['Longest Win Streak', 'Max Win Streak']);
            
            const k3 = getStat(lifetime, ['Triple Kills', '3K', '3 Kills'], '0');
            const k4 = getStat(lifetime, ['Quadro Kills', '4K', '4 Kills'], '0');
            const k5 = getStat(lifetime, ['Penta Kills', 'Aces', '5K', '5 Kills'], '0');

            document.getElementById('stat-matches').innerText = matches;
            document.getElementById('stat-winrate').innerText = winRate;
            document.getElementById('stat-kd').innerText = kd;
            document.getElementById('stat-hs-pct').innerText = hsPct;

            document.getElementById('stat-total-kills').innerText = totalKills;
            document.getElementById('stat-kr').innerText = kr;
            document.getElementById('stat-headshots-pct-deep').innerText = hsPct;
            document.getElementById('stat-longest-streak').innerText = longestStreak;

            document.getElementById('stat-3k').innerText = k3;
            document.getElementById('stat-4k').innerText = k4;
            document.getElementById('stat-5k').innerText = k5;

            const streakVal = parseInt(streak) || 0;
            const streakEl = document.getElementById('streak-value');
            if (streakVal > 0) {
                streakEl.className = 'value text-green bold';
                streakEl.innerText = `+${streakVal}`;
            } else if (streakVal < 0) {
                streakEl.className = 'value text-red bold';
                streakEl.innerText = `${streakVal}`;
            } else {
                streakEl.className = 'value muted';
                streakEl.innerText = '0';
            }

            // Render Map Stats Table
            if (cs2Stats.segments) {
                renderMapStatsTable(cs2Stats.segments);
                renderMapWinrateChart(cs2Stats.segments);
            }
        }

        // Step 3: Complete 30-Day Match History Scan (Scans 100% of matches in last 30 days)
        await fetchMatchHistoryComplete30Days(player_id);

        // Step 4: Fetch Bans & Run Combined Infraction Detector
        await fetchPlayerBans(player_id);

        // Hide Global Loader & Show Active Tab
        document.getElementById('global-loading').style.display = 'none';
        switchTab(state.activeTab);

    } catch (error) {
        console.error(error);
        alert(`Error loading data: ${error.message}`);
        document.getElementById('global-loading').style.display = 'none';
        switchTab('tab-overview');
    }
}

// Algorithmic Leaver / Disconnect Inspector
function checkPlayerLeaverStatus(pStats, roundStats, matchResults) {
    if (!pStats) return { isLeaver: false, reason: '' };

    // Check direct known properties
    if (pStats.Leaver === '1' || pStats.leaver === '1' || pStats.Leaver === 'true') {
        return { isLeaver: true, reason: 'Flagged as Leaver' };
    }
    if (pStats.AFK === '1' || pStats.afk === '1' || pStats.AFK === 'true') {
        return { isLeaver: true, reason: 'Flagged as AFK / Warmup Disconnect' };
    }
    if (pStats.DNFFlag === '1' || pStats.dnf === '1' || pStats.Status === 'DNF') {
        return { isLeaver: true, reason: 'Did Not Finish (DNF)' };
    }

    // Inspect ALL key-value pairs in player_stats case-insensitively
    for (const [key, val] of Object.entries(pStats)) {
        const kLow = key.toLowerCase();
        const vLow = String(val).toLowerCase();
        
        if (kLow.includes('leaver') || kLow.includes('afk') || kLow.includes('noshow') || kLow.includes('dnf') || kLow.includes('abandon')) {
            if (vLow === '1' || vLow === 'true' || vLow.includes('yes') || vLow.includes('leaver') || vLow.includes('afk')) {
                return { isLeaver: true, reason: `Match Flag: ${key}` };
            }
        }
        if (vLow.includes('leaver') || vLow.includes('afk') || vLow.includes('noshow') || vLow.includes('abandoned')) {
            return { isLeaver: true, reason: `Status: ${val}` };
        }
    }

    // Check zero stats in a full match (> 5 rounds) where team played but player did not connect
    const kills = parseInt(pStats.Kills) || 0;
    const deaths = parseInt(pStats.Deaths) || 0;
    const krRatio = parseFloat(pStats['K/R Ratio']) || 0;
    const adr = parseFloat(pStats.ADR) || 0;
    const totalRounds = roundStats ? (parseInt(roundStats.Rounds) || 16) : 16;

    if (kills === 0 && deaths === 0 && totalRounds > 5) {
        return { isLeaver: true, reason: 'Warmup Disconnect / DNF' };
    }

    // Check for matches where player disconnected early (e.g. K/R < 0.38 AND ADR < 45 on a 18+ round match with low deaths)
    if (totalRounds >= 18 && krRatio > 0 && krRatio < 0.38 && adr < 45.0 && deaths < (totalRounds - 2)) {
        return { isLeaver: true, reason: 'Early Disconnect / Abandoned' };
    }

    return { isLeaver: false, reason: '' };
}

// Complete 30-Day Match History Scanner (Fetches 100% of matches in last 30 days)
async function fetchMatchHistoryComplete30Days(player_id) {
    state.detailedMatches = [];
    state.matchOffset = 0;
    state.hasMoreMatches = true;

    const cutoff30Days = Date.now() - ROLLING_WINDOW_MS;
    let offset = 0;
    const limit = 100;
    let reachedCutoff = false;

    while (!reachedCutoff) {
        try {
            const historyData = await faceitFetch(`players/${player_id}/history?game=cs2&limit=${limit}&offset=${offset}`);
            const items = historyData.items || [];

            if (items.length === 0) {
                state.hasMoreMatches = false;
                break;
            }

            // Check if we reached older matches beyond 30 days
            const oldestInBatch = items[items.length - 1].finished_at * 1000;
            if (oldestInBatch < cutoff30Days) {
                reachedCutoff = true;
            }

            // Process batch details
            const detailPromises = items.map(match => {
                return faceitFetch(`matches/${match.match_id}/stats`)
                    .then(details => ({ match, details }))
                    .catch(err => {
                        console.error(`Error loading stats for match ${match.match_id}:`, err);
                        return { match, details: null };
                    });
            });

            const batchDetailed = await Promise.all(detailPromises);
            const parsedBatch = parseMatchBatch(batchDetailed, player_id);

            state.detailedMatches.push(...parsedBatch);
            offset += items.length;
            state.matchOffset = offset;

            if (items.length < limit) {
                state.hasMoreMatches = false;
                break;
            }

        } catch (err) {
            console.error('Error fetching match history batch:', err);
            break;
        }
    }

    // Render Overview & Full Matches
    renderMatchHistoryTables(state.detailedMatches);
    renderKdTrendChart(state.detailedMatches.slice(0, 20));
    
    // Toggle Load More button visibility
    const loadMoreContainer = document.getElementById('load-more-container');
    if (loadMoreContainer) {
        loadMoreContainer.style.display = state.hasMoreMatches ? 'block' : 'none';
    }
}

// Load More Historical Matches (beyond 30 days)
async function loadMoreMatches() {
    if (!state.player || !state.hasMoreMatches) return;
    
    const btn = document.getElementById('load-more-btn');
    if (btn) btn.innerText = 'Loading older matches...';

    const player_id = state.player.player_id;
    const limit = 50;
    const offset = state.matchOffset;

    try {
        const historyData = await faceitFetch(`players/${player_id}/history?game=cs2&limit=${limit}&offset=${offset}`);
        const items = historyData.items || [];

        if (items.length === 0) {
            state.hasMoreMatches = false;
            document.getElementById('load-more-container').style.display = 'none';
            return;
        }

        const detailPromises = items.map(match => {
            return faceitFetch(`matches/${match.match_id}/stats`)
                .then(details => ({ match, details }))
                .catch(err => ({ match, details: null }));
        });

        const batchDetailed = await Promise.all(detailPromises);
        const parsedBatch = parseMatchBatch(batchDetailed, player_id);

        state.detailedMatches.push(...parsedBatch);
        state.matchOffset += items.length;

        if (items.length < limit) {
            state.hasMoreMatches = false;
            document.getElementById('load-more-container').style.display = 'none';
        }

        applyMatchFilters();

    } catch (err) {
        console.error('Error loading more matches:', err);
    } finally {
        if (btn) btn.innerText = 'Load Older Historical Matches';
    }
}

// Parse Raw Match Array into Unified Match Objects
function parseMatchBatch(batchDetailed, player_id) {
    return batchDetailed.map(({ match, details }) => {
        const dateObj = new Date(match.finished_at * 1000);
        const date = dateObj.toLocaleDateString();
        const time = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let mapName = 'Unknown';
        let score = '-';
        let result = 'L';
        let kills = 0;
        let deaths = 0;
        let kdRatio = '0.00';
        let isLeaverOrDnf = false;
        let dnfReason = '';

        if (details && details.rounds && details.rounds.length > 0) {
            const round = details.rounds[0];
            mapName = round.round_stats.Map ? round.round_stats.Map.replace('de_', '').toUpperCase() : 'UNKNOWN';
            score = round.round_stats.Score || '-';
            
            let foundPlayer = false;
            for (const team of round.teams) {
                const p = team.players.find(player => player.player_id === player_id);
                if (p) {
                    foundPlayer = true;
                    kills = parseInt(p.player_stats.Kills) || 0;
                    deaths = parseInt(p.player_stats.Deaths) || 0;
                    kdRatio = p.player_stats['K/D Ratio'] || (deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2));
                    
                    const winFlag = p.player_stats.Result;
                    result = winFlag === '1' ? 'W' : 'L';

                    // Run Deep Algorithmic Leaver Inspector
                    const leaverCheck = checkPlayerLeaverStatus(p.player_stats, round.round_stats, match.results);
                    if (leaverCheck.isLeaver) {
                        isLeaverOrDnf = true;
                        dnfReason = leaverCheck.reason;
                    }
                    break;
                }
            }

            if (!foundPlayer) {
                isLeaverOrDnf = true;
                dnfReason = 'Player Left Match';
            }
        } else {
            // If round details are unavailable, pull basic score from match results and mark as Completed
            const f1Score = (match.results && match.results.score) ? match.results.score.faction1 : 0;
            const f2Score = (match.results && match.results.score) ? match.results.score.faction2 : 0;
            score = `${f1Score} - ${f2Score}`;
            result = (match.results && match.results.winner === 'faction1') ? 'W' : 'L';
            isLeaverOrDnf = false;
            dnfReason = '';
        }

        return {
            match_id: match.match_id,
            timestamp: match.finished_at * 1000,
            date,
            time,
            mapName,
            rawMap: (details && details.rounds && details.rounds[0] && details.rounds[0].round_stats.Map) || 'de_unknown',
            score,
            result,
            kills,
            deaths,
            kdRatio: parseFloat(kdRatio),
            isLeaverOrDnf,
            dnfReason,
            rawDetails: details
        };
    });
}

// Render Overview Quick Matches & Full Filterable Match History Table
function renderMatchHistoryTables(matches) {
    // 1. Overview Table (Top 5)
    const overviewList = document.getElementById('overview-matches-list');
    overviewList.innerHTML = '';

    const top5 = matches.slice(0, 5);
    if (top5.length === 0) {
        overviewList.innerHTML = `<tr><td colspan="6" class="text-center muted">No matches available.</td></tr>`;
    } else {
        top5.forEach(m => {
            const row = document.createElement('tr');
            row.onclick = () => openMatchModal(m.match_id);
            row.title = "Click to inspect match details";
            row.innerHTML = `
                <td>${m.date}</td>
                <td><span class="map-badge">${m.mapName}</span></td>
                <td>${m.score}</td>
                <td><span class="result-badge ${m.result === 'W' ? 'win' : 'loss'}">${m.result === 'W' ? 'WIN' : 'LOSS'}</span></td>
                <td class="font-mono ${m.kdRatio >= 1.0 ? 'text-green' : 'text-red'}">${m.kdRatio.toFixed(2)}</td>
                <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openMatchModal('${m.match_id}')">Inspect</button></td>
            `;
            overviewList.appendChild(row);
        });
    }

    // 2. Full Match History Table
    applyMatchFilters();
}

// Apply Filters to Full Match History Table
function applyMatchFilters() {
    const fullList = document.getElementById('matches-list-full');
    fullList.innerHTML = '';

    const mapFilter = document.getElementById('filter-map').value;
    const resultFilter = document.getElementById('filter-result').value;
    const leaverOnly = state.matchFilters.leaverOnly;

    let filtered = state.detailedMatches.filter(m => {
        if (mapFilter !== 'ALL' && !m.rawMap.toLowerCase().includes(mapFilter.toLowerCase())) {
            return false;
        }
        if (resultFilter !== 'ALL' && m.result !== (resultFilter === 'WIN' ? 'W' : 'L')) {
            return false;
        }
        if (leaverOnly && !m.isLeaverOrDnf) {
            return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        fullList.innerHTML = `<tr><td colspan="8" class="text-center muted">No matches match the selected filters.</td></tr>`;
        return;
    }

    filtered.forEach(m => {
        const row = document.createElement('tr');
        row.onclick = () => openMatchModal(m.match_id);
        row.title = "Click to inspect match details";
        
        let statusHtml = '<span class="badge grey">Completed</span>';
        if (m.isLeaverOrDnf) {
            statusHtml = `<span class="status-tag-dnf">⚠️ ${m.dnfReason || 'Leaver / DNF'}</span>`;
        }

        row.innerHTML = `
            <td>${m.date} <span class="muted text-sm">${m.time}</span></td>
            <td><span class="map-badge">${m.mapName}</span></td>
            <td>${m.score}</td>
            <td><span class="result-badge ${m.result === 'W' ? 'win' : 'loss'}">${m.result === 'W' ? 'WIN' : 'LOSS'}</span></td>
            <td>${m.kills} <span class="muted">/</span> ${m.deaths}</td>
            <td class="font-mono ${m.kdRatio >= 1.0 ? 'text-green' : 'text-red'}">${m.kdRatio.toFixed(2)}</td>
            <td>${statusHtml}</td>
            <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openMatchModal('${m.match_id}')">Inspect</button></td>
        `;
        fullList.appendChild(row);
    });
}

// Toggle Leaver Only Filter Button
function toggleLeaverFilter() {
    state.matchFilters.leaverOnly = !state.matchFilters.leaverOnly;
    const btn = document.getElementById('filter-leaver-btn');
    if (state.matchFilters.leaverOnly) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
    applyMatchFilters();
}

// Render Map Statistics Table
function renderMapStatsTable(segments) {
    const container = document.getElementById('map-stats-rows');
    container.innerHTML = '';

    const mapSegments = segments.filter(s => s.type === 'Map' || s.mode === '5v5');
    if (mapSegments.length === 0) {
        container.innerHTML = `<tr><td colspan="6" class="text-center muted">No map statistics available.</td></tr>`;
        return;
    }

    mapSegments.forEach(seg => {
        const mapName = seg.label ? seg.label.replace('de_', '').toUpperCase() : 'UNKNOWN';
        const matches = seg.stats.Matches || '0';
        const winRate = seg.stats['Win Rate %'] ? `${seg.stats['Win Rate %']}%` : '0%';
        const kd = seg.stats['Average K/D Ratio'] || '0.00';
        const kr = seg.stats['Average K/R Ratio'] || '0.00';
        const hs = seg.stats['Average Headshots %'] ? `${seg.stats['Average Headshots %']}%` : '0%';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong class="text-orange">${mapName}</strong></td>
            <td>${matches}</td>
            <td class="text-green font-mono">${winRate}</td>
            <td class="font-mono ${parseFloat(kd) >= 1.0 ? 'text-green' : 'text-red'}">${kd}</td>
            <td class="font-mono">${kr}</td>
            <td>${hs}</td>
        `;
        container.appendChild(row);
    });
}

// Open Detailed Match Inspection Modal
async function openMatchModal(match_id) {
    const modal = document.getElementById('match-modal');
    const body = document.getElementById('modal-match-body');
    const faceitLink = document.getElementById('modal-faceit-link');
    
    modal.style.display = 'flex';
    faceitLink.href = `https://www.faceit.com/en/cs2/room/${match_id}`;
    
    body.innerHTML = `
        <div class="loading-container text-center spacer-y-md">
            <div class="spinner"></div>
            <p>Fetching team rosters and player stats...</p>
        </div>
    `;

    const matchObj = state.detailedMatches.find(m => m.match_id === match_id);
    if (matchObj) {
        document.getElementById('modal-match-map').innerText = `${matchObj.mapName} (${matchObj.score})`;
        document.getElementById('modal-match-date').innerText = `${matchObj.date} at ${matchObj.time}`;
    }

    try {
        let details = matchObj ? matchObj.rawDetails : null;
        if (!details) {
            details = await faceitFetch(`matches/${match_id}/stats`);
        }

        if (!details || !details.rounds || details.rounds.length === 0) {
            body.innerHTML = `<p class="text-center text-red">Failed to load detailed round statistics for this match.</p>`;
            return;
        }

        const round = details.rounds[0];
        let html = '';

        round.teams.forEach(team => {
            const teamName = team.team_stats.Team || 'Team';
            const winFlag = team.team_stats['Second Half Score'] !== undefined ? (team.team_stats.TeamWin === '1' ? 'WINNER' : '') : '';

            html += `
                <div class="team-roster-section">
                    <div class="team-header-title">
                        <span>${teamName}</span>
                        ${winFlag ? `<span class="result-badge win">${winFlag}</span>` : ''}
                    </div>
                    <div class="table-responsive">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Player</th>
                                    <th>Kills</th>
                                    <th>Deaths</th>
                                    <th>Headshots %</th>
                                    <th>K/D Ratio</th>
                                    <th>K/R Ratio</th>
                                </tr>
                            </thead>
                            <tbody>
            `;

            team.players.forEach(p => {
                const name = p.nickname;
                const kills = p.player_stats.Kills || '0';
                const deaths = p.player_stats.Deaths || '0';
                const hs = p.player_stats['Headshots %'] ? `${p.player_stats['Headshots %']}%` : '0%';
                const kd = p.player_stats['K/D Ratio'] || '0.00';
                const kr = p.player_stats['K/R Ratio'] || '0.00';
                
                const isTargetPlayer = state.player && p.player_id === state.player.player_id;

                html += `
                    <tr ${isTargetPlayer ? 'style="background: rgba(255,85,0,0.15); font-weight: bold;"' : ''}>
                        <td><strong>${name}</strong> ${isTargetPlayer ? '(Searched Player)' : ''}</td>
                        <td>${kills}</td>
                        <td>${deaths}</td>
                        <td>${hs}</td>
                        <td class="font-mono ${parseFloat(kd) >= 1.0 ? 'text-green' : 'text-red'}">${kd}</td>
                        <td class="font-mono">${kr}</td>
                    </tr>
                `;
            });

            html += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });

        body.innerHTML = html;

    } catch (err) {
        console.error('Error fetching modal details:', err);
        body.innerHTML = `<p class="text-center text-red">Error loading match details: ${err.message}</p>`;
    }
}

// Close Match Modal
function closeMatchModal(event) {
    if (event && event.target !== document.getElementById('match-modal') && !event.target.classList.contains('modal-close-btn')) {
        return;
    }
    document.getElementById('match-modal').style.display = 'none';
}

// Fetch Player Ban History & Run Combined Infraction Detector
async function fetchPlayerBans(player_id) {
    let bans = [];
    try {
        const banData = await faceitFetch(`players/${player_id}/bans`);
        bans = banData.items || [];
        state.bans = bans;
    } catch (err) {
        console.error('Error fetching official bans:', err);
    }

    // Run combined infraction detector
    renderBansAndPredictor(bans);
}

// Render Combined Infraction Escalation & 30-Day Window Predictor
function renderBansAndPredictor(officialBans) {
    const now = Date.now();
    const cutoff30Days = now - ROLLING_WINDOW_MS;

    // 1. Official FACEIT bans in rolling 30-day window
    const activeOfficialBans = officialBans.filter(b => {
        const start = parseTimestamp(b.starts_at || b.created_at);
        return start >= cutoff30Days;
    });

    // 2. Algorithmically Detected Match Abandonments / Leavers from recent match history in rolling 30-day window
    const activeLeaverMatches = state.detailedMatches.filter(m => {
        return m.isLeaverOrDnf && m.timestamp >= cutoff30Days;
    });

    // Combined active infractions count
    const totalInfractions = activeOfficialBans.length + activeLeaverMatches.length;

    // Update UI counters
    document.getElementById('active-infractions-count').innerText = totalInfractions;
    document.getElementById('overview-infraction-badge').innerText = `${totalInfractions} Infractions (30d)`;

    const nextIndex = Math.min(totalInfractions, INFRACTION_ESCALATION.length - 1);
    const nextCooldownObj = INFRACTION_ESCALATION[nextIndex];

    document.getElementById('next-cooldown-time').innerText = nextCooldownObj.durationText;
    document.getElementById('overview-next-cooldown').innerText = nextCooldownObj.durationText;

    buildEscalationLadder(totalInfractions);

    // Active Ban Live Timer Check
    let currentActiveBan = null;
    officialBans.forEach(b => {
        const endMs = parseTimestamp(b.ends_at);
        if (endMs > now) {
            if (!currentActiveBan || endMs > parseTimestamp(currentActiveBan.ends_at)) {
                currentActiveBan = b;
            }
        }
    });

    if (currentActiveBan) {
        startActiveBanTimer(currentActiveBan);
    } else {
        if (banCountdownInterval) clearInterval(banCountdownInterval);
        document.getElementById('active-ban-card').style.display = 'none';
    }

    renderBanHistoryTable(officialBans, activeLeaverMatches);
}

// Render Ban & Infractions Log Table
function renderBanHistoryTable(officialBans, activeLeaverMatches) {
    const listContainer = document.getElementById('ban-log-rows');
    const badge = document.getElementById('total-bans-badge');
    listContainer.innerHTML = '';

    const combinedList = [];

    // Add official bans
    officialBans.forEach(b => {
        combinedList.push({
            type: 'Official FACEIT Ban',
            reason: b.reason || b.type || 'Platform Infraction',
            startMs: parseTimestamp(b.starts_at || b.created_at),
            endMs: parseTimestamp(b.ends_at),
            isOfficial: true
        });
    });

    // Add detected leaver matches
    activeLeaverMatches.forEach(m => {
        combinedList.push({
            type: 'Detected Match Abandonment',
            reason: `${m.dnfReason} on ${m.mapName} (${m.score})`,
            startMs: m.timestamp,
            endMs: m.timestamp + (30 * 60 * 1000), // estimated cooldown start
            isOfficial: false
        });
    });

    // Sort descending by date
    combinedList.sort((a, b) => b.startMs - a.startMs);

    badge.innerText = `${combinedList.length} Total Record${combinedList.length === 1 ? '' : 's'}`;

    if (combinedList.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="4" class="text-center muted">No ban history or detected infractions found. Clean record!</td></tr>`;
        return;
    }

    const now = Date.now();

    combinedList.forEach(item => {
        const startDateText = item.startMs ? new Date(item.startMs).toLocaleString() : 'Unknown';
        const endDateText = item.endMs ? new Date(item.endMs).toLocaleString() : 'Permanent';

        let statusHtml = '';
        if (item.isOfficial && item.endMs && item.endMs > now) {
            statusHtml = `<span class="result-badge loss">ACTIVE BAN</span>`;
        } else if (item.isOfficial) {
            statusHtml = `<span class="badge grey">Expired</span>`;
        } else {
            statusHtml = `<span class="status-tag-dnf">Detected Infraction</span>`;
        }

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong class="text-red">${item.reason}</strong> <br><span class="muted text-sm">${item.type}</span></td>
            <td>${startDateText}</td>
            <td>${endDateText}</td>
            <td>${statusHtml}</td>
        `;
        listContainer.appendChild(row);
    });
}

// Chart 1: K/D Trend Line Chart (Chart.js)
function renderKdTrendChart(matches) {
    const ctx = document.getElementById('chart-kd-trend');
    if (!ctx) return;

    if (kdChartInstance) kdChartInstance.destroy();

    const chronological = [...matches].reverse();
    const labels = chronological.map(m => m.date);
    const dataPoints = chronological.map(m => m.kdRatio);

    kdChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'K/D Ratio',
                data: dataPoints,
                borderColor: '#FF5500',
                backgroundColor: 'rgba(255, 85, 0, 0.15)',
                borderWidth: 3,
                fill: true,
                tension: 0.35,
                pointRadius: 4,
                pointBackgroundColor: '#FF5500'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9ca3af' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9ca3af' },
                    suggestedMin: 0.5,
                    suggestedMax: 2.0
                }
            }
        }
    });
}

// Chart 2: Map Win Rate Comparison Bar Chart (Chart.js)
function renderMapWinrateChart(segments) {
    const ctx = document.getElementById('chart-map-winrate');
    if (!ctx) return;

    if (mapWinrateChartInstance) mapWinrateChartInstance.destroy();

    const mapSegments = segments.filter(s => s.type === 'Map' || s.mode === '5v5');
    const labels = mapSegments.map(s => s.label ? s.label.replace('de_', '').toUpperCase() : 'UNKNOWN');
    const winRates = mapSegments.map(s => parseFloat(s.stats['Win Rate %'] || 0));

    mapWinrateChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Win Rate (%)',
                data: winRates,
                backgroundColor: winRates.map(w => w >= 50 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'),
                borderColor: winRates.map(w => w >= 50 ? '#10b981' : '#ef4444'),
                borderWidth: 1.5,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#9ca3af' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9ca3af' },
                    min: 0,
                    max: 100
                }
            }
        }
    });
}

// Parse ISO date string or epoch timestamp to milliseconds
function parseTimestamp(val) {
    if (!val) return 0;
    if (typeof val === 'number') {
        return val > 1e11 ? val : val * 1000;
    }
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? 0 : parsed;
}

// Start live countdown timer for active queue ban
function startActiveBanTimer(banObj) {
    if (banCountdownInterval) clearInterval(banCountdownInterval);

    const endMs = parseTimestamp(banObj.ends_at);
    const reason = banObj.reason || 'Active Cooldown';
    document.getElementById('ban-reason-text').innerText = reason;

    const updateTimer = () => {
        const diff = endMs - Date.now();
        if (diff <= 0) {
            clearInterval(banCountdownInterval);
            document.getElementById('active-ban-card').style.display = 'none';
            return;
        }

        document.getElementById('active-ban-card').style.display = 'block';
        document.getElementById('ban-timer-meta').innerText = `Banned until: ${new Date(endMs).toLocaleTimeString()} (${new Date(endMs).toLocaleDateString()})`;

        const secs = Math.floor((diff / 1000) % 60);
        const mins = Math.floor((diff / (1000 * 60)) % 60);
        const hrs = Math.floor(diff / (1000 * 60 * 60));

        const pad = (num) => String(num).padStart(2, '0');
        document.getElementById('ban-timer-countdown').innerText = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    };

    updateTimer();
    banCountdownInterval = setInterval(updateTimer, 1000);
}

// Build visual representation of the escalation ladder
function buildEscalationLadder(activeCount) {
    const ladderContainer = document.getElementById('escalation-ladder');
    ladderContainer.innerHTML = '';

    INFRACTION_ESCALATION.forEach((step, idx) => {
        const stepEl = document.createElement('div');
        stepEl.className = 'ladder-step';

        let statusText = '';
        if (idx < activeCount) {
            stepEl.classList.add('completed');
            statusText = '✔️';
        } else if (idx === activeCount) {
            stepEl.classList.add('next-up');
            statusText = '<span class="badge next-up-badge">NEXT</span>';
        } else {
            statusText = `<span class="badge muted">Tier ${idx+1}</span>`;
        }

        stepEl.innerHTML = `
            <div class="step-info">
                <span class="step-num">${idx + 1}</span>
                <span class="step-label">${step.label}</span>
            </div>
            <div class="space-between gap-sm">
                <span class="step-duration">${step.durationText}</span>
                ${statusText}
            </div>
        `;
        
        ladderContainer.appendChild(stepEl);
    });
}

// Update level badge with official FACEIT CDN SVG icons
function updateLevelBadge(level) {
    const container = document.getElementById('faceit-level-badge-container');
    const safeLevel = Math.max(1, Math.min(10, parseInt(level) || 1));
    
    // Official FACEIT CDN SVG Badge URL
    const faceitCdnSvg = `https://cdn-frontend.faceit.com/web/960/src/app/assets/images-e/skill-icons/skill_level_${safeLevel}_svg.svg`;
    
    container.innerHTML = `
        <img src="${faceitCdnSvg}" alt="FACEIT Level ${safeLevel}" class="faceit-level-svg" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'faceit-badge lvl-${safeLevel}\\'>${safeLevel}</div>';">
    `;
}
