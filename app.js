// FACEIT Developer API Key configuration placeholder
// This placeholder will be automatically substituted by GitHub Actions if deploying via GitHub Pages.
const DEFAULT_API_KEY = "__FACEIT_API_KEY__";

// Application State
let state = {
    nickname: '',
    player: null,
    stats: null,
    matches: [],
    bans: []
};

// Global Timers
let banCountdownInterval = null;

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

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
    loadFromLocalStorage();
    checkApiKeySetup();
    
    if (state.nickname) {
        document.getElementById('nickname-search').value = state.nickname;
        if (checkApiKeySetup()) {
            fetchStats();
        }
    }
});

// Retrieve API Key: checks GitHub Actions injected key first, then browser local storage
function getApiKey() {
    // Use startsWith check instead of literal comparison —
    // replaceAll in the build would replace a literal "__FACEIT_API_KEY__" here too,
    // causing the check to always fail.
    if (DEFAULT_API_KEY && DEFAULT_API_KEY.length > 0 && !DEFAULT_API_KEY.startsWith('__')) {
        return DEFAULT_API_KEY.trim();
    }
    const saved = localStorage.getItem('faceit_api_key_v1');
    if (saved && saved.trim().length > 0) {
        return saved.trim();
    }
    return null;
}

// Check if API Key has been configured
function checkApiKeySetup() {
    const warningCard = document.getElementById('dev-warning-card');
    const apiKey = getApiKey();
    const isConfigured = apiKey !== null && apiKey.length > 0;
    
    if (!isConfigured) {
        warningCard.style.display = 'block';
        document.getElementById('stats-dashboard').style.display = 'none';
        document.getElementById('matches-section').style.display = 'none';
        document.getElementById('penalty-section').style.display = 'none';
        document.getElementById('ban-history-section').style.display = 'none';
    } else {
        warningCard.style.display = 'none';
    }
    return isConfigured;
}

// Save user entered API Key into local storage
function saveUserApiKey() {
    const input = document.getElementById('user-api-key-input');
    const val = input ? input.value.trim() : '';
    if (!val) {
        alert('Please enter a valid FACEIT API Key.');
        return;
    }
    localStorage.setItem('faceit_api_key_v1', val);
    const configured = checkApiKeySetup();
    if (configured) {
        if (state.nickname) {
            fetchStats();
        } else {
            alert('API Key activated! Enter your FACEIT Nickname above and click Search Player.');
        }
    }
}

// Reset saved API Key
function resetApiKey() {
    localStorage.removeItem('faceit_api_key_v1');
    checkApiKeySetup();
    alert('Saved API Key cleared.');
}

// Load state from localStorage
function loadFromLocalStorage() {
    const savedNickname = localStorage.getItem('faceit_nickname_v3');
    if (savedNickname) state.nickname = savedNickname;
}

// Save state to localStorage
function saveState(key, data) {
    localStorage.setItem(key, data);
}

// Handle nickname search submit
function handleSearchSubmit(event) {
    event.preventDefault();
    const query = document.getElementById('nickname-search').value.trim();
    if (!query) return;

    state.nickname = query;
    saveState('faceit_nickname_v3', state.nickname);
    
    if (checkApiKeySetup()) {
        fetchStats();
    }
}

// Core Fetching Mechanism with Automatic Authorization Format Fallback
async function faceitFetch(endpoint) {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('FACEIT API Key is not configured.');
    }

    const targetUrl = `https://open.faceit.com/data/v4/${endpoint}`;
    
    // Attempt 1: Standard Bearer Token format
    let authHeader = apiKey.trim();
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
        authHeader = `Bearer ${authHeader}`;
    }

    let response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json'
        }
    });

    // Attempt 2: If 401 Unauthorized, retry with raw token (some FACEIT key types require raw string without 'Bearer ')
    if (response.status === 401 && authHeader.toLowerCase().startsWith('bearer ')) {
        const rawKey = apiKey.trim().replace(/^bearer\s+/i, '');
        response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Authorization': rawKey,
                'Accept': 'application/json'
            }
        });
    }

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Unauthorized: The configured FACEIT API Key is invalid.');
        } else if (response.status === 404) {
            throw new Error('Not Found: Player or resource could not be found.');
        } else {
            throw new Error(`FACEIT API Error (Status ${response.status})`);
        }
    }

    return response.json();
}

// Main Fetch Statistics Function
async function fetchStats() {
    const nickname = state.nickname;
    if (!nickname) return;

    // Show containers
    document.getElementById('stats-dashboard').style.display = 'grid';
    document.getElementById('matches-section').style.display = 'block';
    document.getElementById('penalty-section').style.display = 'grid';
    document.getElementById('ban-history-section').style.display = 'block';

    // Show loaders
    document.getElementById('profile-loading').style.display = 'flex';
    document.getElementById('profile-display').style.display = 'none';
    document.getElementById('matches-loading').style.display = 'block';
    document.getElementById('matches-table-container').style.display = 'none';

    try {
        // Step 1: Fetch player main info
        const playerProfile = await faceitFetch(`players?nickname=${encodeURIComponent(nickname)}`);
        state.player = playerProfile;
        const player_id = playerProfile.player_id;
        
        // Map profile details
        document.getElementById('user-name').innerText = playerProfile.nickname || nickname;
        document.getElementById('user-country').innerText = playerProfile.country || 'EU';
        if (playerProfile.avatar) {
            document.getElementById('user-avatar').src = playerProfile.avatar;
        }

        const cs2Game = playerProfile.games && playerProfile.games.cs2;
        const skillLevel = cs2Game ? cs2Game.skill_level : 1;
        const elo = cs2Game ? cs2Game.faceit_elo : 1000;

        document.getElementById('elo-value').innerText = elo;
        updateLevelBadge(skillLevel);

        // Step 2: Fetch CS2 Stats
        let cs2Stats = null;
        try {
            cs2Stats = await faceitFetch(`players/${player_id}/stats/cs2`);
            state.stats = cs2Stats;
        } catch (err) {
            console.warn('No specific CS2 lifetime stats found.', err);
        }

        if (cs2Stats && cs2Stats.lifetime) {
            const matches = cs2Stats.lifetime.Matches || '0';
            const winRate = cs2Stats.lifetime['Win Rate %'] ? `${cs2Stats.lifetime['Win Rate %']}%` : '0%';
            const kd = cs2Stats.lifetime['Average K/D Ratio'] || '0.00';
            const streak = cs2Stats.lifetime['Current Win Streak'] || '0';

            document.getElementById('stat-matches').innerText = matches;
            document.getElementById('stat-winrate').innerText = winRate;
            document.getElementById('stat-kd').innerText = kd;

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
        } else {
            document.getElementById('stat-matches').innerText = '-';
            document.getElementById('stat-winrate').innerText = '-';
            document.getElementById('stat-kd').innerText = '-';
            document.getElementById('streak-value').innerText = '0';
            document.getElementById('streak-value').className = 'value muted';
        }

        // Step 3: Fetch Recent Matches and Player Bans in Parallel
        await Promise.all([
            fetchMatchHistory(player_id),
            fetchPlayerBans(player_id)
        ]);

        document.getElementById('profile-loading').style.display = 'none';
        document.getElementById('profile-display').style.display = 'block';

    } catch (error) {
        console.error(error);
        alert(`Error loading data: ${error.message}`);
        
        document.getElementById('profile-loading').style.display = 'none';
        document.getElementById('profile-display').style.display = 'block';
        document.getElementById('matches-loading').style.display = 'none';
        document.getElementById('matches-table-container').style.display = 'block';
    }
}

// Fetch Match History (Last 5 matches)
async function fetchMatchHistory(player_id) {
    try {
        const historyData = await faceitFetch(`players/${player_id}/history?game=cs2&limit=5`);
        const matches = historyData.items || [];
        state.matches = matches;
        
        const listContainer = document.getElementById('matches-list');
        listContainer.innerHTML = '';

        if (matches.length === 0) {
            listContainer.innerHTML = `<tr><td colspan="6" class="text-center muted">No CS2 matches recorded in history.</td></tr>`;
            document.getElementById('matches-loading').style.display = 'none';
            document.getElementById('matches-table-container').style.display = 'block';
            return;
        }

        const detailPromises = matches.map(match => {
            return faceitFetch(`matches/${match.match_id}/stats`)
                .then(details => ({ match, details }))
                .catch(err => {
                    console.error(`Error loading stats for match ${match.match_id}:`, err);
                    return { match, details: null };
                });
        });

        const detailedMatches = await Promise.all(detailPromises);
        let firstAvgKd = 0;
        let validKdCount = 0;

        detailedMatches.forEach(({ match, details }) => {
            const date = new Date(match.finished_at * 1000).toLocaleDateString();
            let mapName = 'Unknown';
            let score = '-';
            let result = 'L';
            let kills = '-';
            let deaths = '-';
            let kdRatio = '-';

            if (details && details.rounds && details.rounds.length > 0) {
                const round = details.rounds[0];
                mapName = round.round_stats.Map.replace('de_', '').toUpperCase();
                score = round.round_stats.Score || '-';
                
                for (const team of round.teams) {
                    const p = team.players.find(player => player.player_id === player_id);
                    if (p) {
                        kills = p.player_stats.Kills || '0';
                        deaths = p.player_stats.Deaths || '0';
                        kdRatio = p.player_stats['K/D Ratio'] || '0.00';
                        
                        const winFlag = p.player_stats.Result;
                        result = winFlag === '1' ? 'W' : 'L';
                        
                        const parsedKd = parseFloat(kdRatio);
                        if (!isNaN(parsedKd)) {
                            firstAvgKd += parsedKd;
                            validKdCount++;
                        }
                        break;
                    }
                }
            } else {
                const f1Score = match.results.score.faction1;
                const f2Score = match.results.score.faction2;
                score = `${f1Score} - ${f2Score}`;
                result = 'L'; 
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${date}</td>
                <td><span class="map-badge">${mapName}</span></td>
                <td>${score}</td>
                <td><span class="result-badge ${result === 'W' ? 'win' : 'loss'}">${result === 'W' ? 'WIN' : 'LOSS'}</span></td>
                <td>${kills} <span class="muted">/</span> ${deaths}</td>
                <td class="font-mono ${parseFloat(kdRatio) >= 1.0 ? 'text-green' : 'text-red'}">${kdRatio}</td>
            `;
            listContainer.appendChild(row);
        });

        if (validKdCount > 0) {
            const calculatedAvg = (firstAvgKd / validKdCount).toFixed(2);
            document.getElementById('stat-avg-kd').innerText = calculatedAvg;
        } else {
            document.getElementById('stat-avg-kd').innerText = '-';
        }

        document.getElementById('matches-loading').style.display = 'none';
        document.getElementById('matches-table-container').style.display = 'block';

    } catch (err) {
        console.error('Error fetching match history details:', err);
        document.getElementById('matches-list').innerHTML = `<tr><td colspan="6" class="text-center text-red">Failed to load match history details.</td></tr>`;
        document.getElementById('matches-loading').style.display = 'none';
        document.getElementById('matches-table-container').style.display = 'block';
    }
}

// Fetch Player Ban History from FACEIT API
async function fetchPlayerBans(player_id) {
    try {
        const banData = await faceitFetch(`players/${player_id}/bans`);
        const bans = banData.items || [];
        state.bans = bans;

        renderBansAndPredictor(bans);
    } catch (err) {
        console.error('Error fetching player ban history:', err);
        renderBansAndPredictor([]);
    }
}

// Render Bans, Calculate Active Window & Escalation Ladder
function renderBansAndPredictor(bans) {
    const now = Date.now();
    const cutoff30Days = now - ROLLING_WINDOW_MS;

    const activeWindowBans = bans.filter(b => {
        const banStart = parseTimestamp(b.starts_at || b.created_at);
        return banStart >= cutoff30Days;
    });

    const activeCount = activeWindowBans.length;
    document.getElementById('active-infractions-count').innerText = activeCount;

    const nextTimeIndex = Math.min(activeCount, INFRACTION_ESCALATION.length - 1);
    const nextCooldownObj = INFRACTION_ESCALATION[nextTimeIndex];
    document.getElementById('next-cooldown-time').innerText = nextCooldownObj.durationText;

    buildEscalationLadder(activeCount);

    let currentActiveBan = null;
    bans.forEach(b => {
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

    renderBanHistoryTable(bans);
}

// Render Official Ban History Table Rows
function renderBanHistoryTable(bans) {
    const listContainer = document.getElementById('ban-log-rows');
    const badge = document.getElementById('total-bans-badge');
    listContainer.innerHTML = '';

    badge.innerText = `${bans.length} Total Record${bans.length === 1 ? '' : 's'}`;

    if (bans.length === 0) {
        listContainer.innerHTML = `
            <tr>
                <td colspan="4" class="text-center muted">No ban history found for this player. Clean record!</td>
            </tr>
        `;
        return;
    }

    const now = Date.now();

    bans.forEach(b => {
        const reason = b.reason || b.type || 'Queuing Infraction';
        const startMs = parseTimestamp(b.starts_at || b.created_at);
        const endMs = parseTimestamp(b.ends_at);

        const startDateText = startMs ? new Date(startMs).toLocaleString() : 'Unknown';
        const endDateText = endMs ? new Date(endMs).toLocaleString() : 'Permanent';

        let statusHtml = '';
        if (endMs && endMs > now) {
            statusHtml = `<span class="result-badge loss">ACTIVE BAN</span>`;
        } else {
            statusHtml = `<span class="badge grey">Expired</span>`;
        }

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong class="text-red" style="text-transform: capitalize;">${reason}</strong></td>
            <td>${startDateText}</td>
            <td>${endDateText}</td>
            <td>${statusHtml}</td>
        `;
        listContainer.appendChild(row);
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

// Update level badge visual color class
function updateLevelBadge(level) {
    const badge = document.getElementById('level-badge-value');
    badge.innerText = level;
    badge.className = 'level-badge';
    badge.classList.add(`lvl-${level}`);
}
