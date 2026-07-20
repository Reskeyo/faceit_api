// FACEIT Developer API Key configuration placeholder
// Dieser Platzhalter wird automatisch von GitHub Actions beim Deployment durch das Secret FACEIT_API_KEY ersetzt.
const DEFAULT_API_KEY = "__FACEIT_API_KEY__";

// Application State
let state = {
    config: {
        nickname: ''
    },
    infractions: [], // Array of { id, type, timestamp }
    activeBan: null, // { expiresAt }
    activeHistoryTab: 'active' // 'active' or 'expired'
};

// Global Timers
let banCountdownInterval = null;
let infractionCountdownInterval = null;

// Constants
const ROLLING_WINDOW_DAYS = 30;
const ROLLING_WINDOW_MS = ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const INFRACTION_ESCALATION = [
    { label: "1. Strafe", durationText: "30 Minuten", durationMs: 30 * 60 * 1000 },
    { label: "2. Strafe", durationText: "2 Stunden", durationMs: 2 * 60 * 60 * 1000 },
    { label: "3. Strafe", durationText: "4 Stunden", durationMs: 4 * 60 * 60 * 1000 },
    { label: "4. Strafe", durationText: "8 Stunden", durationMs: 8 * 60 * 60 * 1000 },
    { label: "5. Strafe", durationText: "12 Stunden", durationMs: 12 * 60 * 60 * 1000 },
    { label: "6. Strafe", durationText: "24 Stunden (1 Tag)", durationMs: 24 * 60 * 60 * 1000 },
    { label: "7. Strafe", durationText: "48 Stunden (2 Tage)", durationMs: 48 * 60 * 60 * 1000 },
    { label: "8+ Strafen", durationText: "1 Woche (7 Tage)", durationMs: 7 * 24 * 60 * 60 * 1000 }
];

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
    loadFromLocalStorage();
    setupEventListeners();
    setCurrentTime(); // Set infraction time input to current time
    updateUI();
    
    // Check if Developer key is configured
    checkApiKeySetup();
    
    // Auto-fetch if nickname exists and API key is set
    if (state.config.nickname) {
        document.getElementById('nickname-search').value = state.config.nickname;
        if (DEFAULT_API_KEY && DEFAULT_API_KEY !== "__FACEIT_API_KEY__") {
            fetchStats();
        }
    }
});

// Check if API Key has been configured by the owner
function checkApiKeySetup() {
    const warningCard = document.getElementById('dev-warning-card');
    const isConfigured = DEFAULT_API_KEY && DEFAULT_API_KEY !== "__FACEIT_API_KEY__";
    
    if (!isConfigured) {
        warningCard.style.display = 'block';
        document.getElementById('stats-dashboard').style.display = 'none';
        document.getElementById('matches-section').style.display = 'none';
    } else {
        warningCard.style.display = 'none';
    }
    return isConfigured;
}

// Load state from localStorage
function loadFromLocalStorage() {
    const savedConfig = localStorage.getItem('faceit_config_v2');
    if (savedConfig) state.config = JSON.parse(savedConfig);

    const savedInfractions = localStorage.getItem('faceit_infractions');
    if (savedInfractions) state.infractions = JSON.parse(savedInfractions);

    const savedActiveBan = localStorage.getItem('faceit_active_ban');
    if (savedActiveBan) state.activeBan = JSON.parse(savedActiveBan);

    // Sync HTML Form elements
    document.getElementById('nickname-search').value = state.config.nickname || '';
}

// Save state to localStorage
function saveState(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

// Event Listeners setup
function setupEventListeners() {
    // Search form submissions
}

// Handle nickname search submit
function handleSearchSubmit(event) {
    event.preventDefault();
    const query = document.getElementById('nickname-search').value.trim();
    if (!query) return;

    state.config.nickname = query;
    saveState('faceit_config_v2', state.config);
    
    if (checkApiKeySetup()) {
        fetchStats();
    }
}

// Set datetime-local input value to current timezone-adjusted local time
function setCurrentTime() {
    const now = new Date();
    // Offset local timezone minutes to construct exact local ISO string
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    const localISOTime = new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
    document.getElementById('infraction-time').value = localISOTime;
}

// Core Fetching Mechanism (API calls bypass CORS using corsproxy.io)
async function faceitFetch(endpoint) {
    if (!DEFAULT_API_KEY || DEFAULT_API_KEY === "__FACEIT_API_KEY__") {
        throw new Error('API Key ist nicht konfiguriert.');
    }

    const targetUrl = `https://open.faceit.com/data/v4/${endpoint}`;
    // corsproxy.io handles custom headers and routes directly
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;

    const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${DEFAULT_API_KEY}`,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Unauthorized: Der FACEIT API Key ist ungültig.');
        } else if (response.status === 404) {
            throw new Error('Nicht gefunden: Der Nickname existiert nicht.');
        } else {
            throw new Error(`FACEIT API Fehler (Status ${response.status})`);
        }
    }

    return response.json();
}

// Fetch player statistics live
async function fetchStats() {
    const nickname = state.config.nickname;
    if (!nickname) return;

    // Toggle dashboard views
    document.getElementById('stats-dashboard').style.display = 'grid';
    document.getElementById('matches-section').style.display = 'block';

    // Show loaders
    document.getElementById('profile-loading').style.display = 'flex';
    document.getElementById('profile-display').style.display = 'none';
    document.getElementById('matches-loading').style.display = 'block';
    document.getElementById('matches-table-container').style.display = 'none';

    try {
        // Step 1: Fetch player main info
        const playerProfile = await faceitFetch(`players?nickname=${encodeURIComponent(nickname)}`);
        const player_id = playerProfile.player_id;
        
        // Map profile details
        document.getElementById('user-name').innerText = playerProfile.nickname || nickname;
        document.getElementById('user-country').innerText = playerProfile.country || 'EU';
        if (playerProfile.avatar) {
            document.getElementById('user-avatar').src = playerProfile.avatar;
        } else {
            document.getElementById('user-avatar').src = 'https://images.faceit.com/images/avatars/default_avatar.png';
        }

        const cs2Game = playerProfile.games && playerProfile.games.cs2;
        const skillLevel = cs2Game ? cs2Game.skill_level : 1;
        const elo = cs2Game ? cs2Game.faceit_elo : 1000;

        document.getElementById('elo-value').innerText = elo;
        updateLevelBadge(skillLevel);

        // Step 2: Fetch player CS2 stats
        let cs2Stats = null;
        try {
            cs2Stats = await faceitFetch(`players/${player_id}/stats/cs2`);
        } catch (err) {
            console.warn('Keine spezifischen CS2-Statistiken gefunden.', err);
        }

        if (cs2Stats && cs2Stats.lifetime) {
            const matches = cs2Stats.lifetime.Matches || '0';
            const winRate = cs2Stats.lifetime['Win Rate %'] ? `${cs2Stats.lifetime['Win Rate %']}%` : '0%';
            const kd = cs2Stats.lifetime['Average K/D Ratio'] || '0.00';
            const streak = cs2Stats.lifetime['Current Win Streak'] || '0';

            document.getElementById('stat-matches').innerText = matches;
            document.getElementById('stat-winrate').innerText = winRate;
            document.getElementById('stat-kd').innerText = kd;

            // Highlight win streak colors
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

        // Step 3: Fetch match history & stats details
        await fetchMatchHistory(player_id);

        document.getElementById('profile-loading').style.display = 'none';
        document.getElementById('profile-display').style.display = 'block';

    } catch (error) {
        console.error(error);
        alert(`Fehler beim Laden: ${error.message}`);
        
        document.getElementById('profile-loading').style.display = 'none';
        document.getElementById('profile-display').style.display = 'block';
        document.getElementById('matches-loading').style.display = 'none';
        document.getElementById('matches-table-container').style.display = 'block';
    }
}

// Fetch match history details (Last 5 matches)
async function fetchMatchHistory(player_id) {
    try {
        const historyData = await faceitFetch(`players/${player_id}/history?game=cs2&limit=5`);
        const matches = historyData.items || [];
        
        const listContainer = document.getElementById('matches-list');
        listContainer.innerHTML = '';

        if (matches.length === 0) {
            listContainer.innerHTML = `<tr><td colspan="6" class="text-center muted">Keine Matches in der Historie.</td></tr>`;
            document.getElementById('matches-loading').style.display = 'none';
            document.getElementById('matches-table-container').style.display = 'block';
            return;
        }

        // Fetch detailed stats for each match in parallel
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
                
                // Find our user in the players list
                for (const team of round.teams) {
                    const p = team.players.find(player => player.player_id === player_id);
                    if (p) {
                        kills = p.player_stats.Kills || '0';
                        deaths = p.player_stats.Deaths || '0';
                        kdRatio = p.player_stats['K/D Ratio'] || '0.00';
                        
                        const winFlag = p.player_stats.Result; // "1" for Win, "0" for Loss
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
                <td><span class="result-badge ${result === 'W' ? 'win' : 'loss'}">${result === 'W' ? 'SIEG' : 'NIEDERLAGE'}</span></td>
                <td>${kills} <span class="muted">/</span> ${deaths}</td>
                <td class="font-mono ${parseFloat(kdRatio) >= 1.0 ? 'text-green' : 'text-red'}">${kdRatio}</td>
            `;
            listContainer.appendChild(row);
        });

        // Set Average KD based on history
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
        document.getElementById('matches-list').innerHTML = `<tr><td colspan="6" class="text-center text-red">Fehler beim Laden der Match-Historie.</td></tr>`;
        document.getElementById('matches-loading').style.display = 'none';
        document.getElementById('matches-table-container').style.display = 'block';
    }
}

// Update level badge visual color class
function updateLevelBadge(level) {
    const badge = document.getElementById('level-badge-value');
    badge.innerText = level;
    // Clear previous classes
    badge.className = 'level-badge';
    badge.classList.add(`lvl-${level}`);
}

// Log a new infraction
function logInfraction(event) {
    event.preventDefault();
    const type = document.getElementById('infraction-type').value;
    const timeVal = document.getElementById('infraction-time').value;

    if (!timeVal) {
        alert('Bitte wähle ein gültiges Datum & Uhrzeit.');
        return;
    }

    const timestamp = new Date(timeVal).getTime();
    if (isNaN(timestamp)) {
        alert('Ungültiges Datum.');
        return;
    }

    const newInfraction = {
        id: 'inf_' + Math.random().toString(36).substr(2, 9),
        type: type,
        timestamp: timestamp
    };

    state.infractions.push(newInfraction);
    // Sort infractions descending by time
    state.infractions.sort((a, b) => b.timestamp - a.timestamp);
    
    saveState('faceit_infractions', state.infractions);
    
    // Automatically trigger a predictive cooldown active ban if infraction was set to "now"
    const isNow = Math.abs(Date.now() - timestamp) < 60000;
    if (isNow) {
        const activeCount = getActiveInfractions().length;
        const cooldownIndex = Math.min(activeCount - 1, INFRACTION_ESCALATION.length - 1);
        const cooldownDuration = INFRACTION_ESCALATION[cooldownIndex].durationMs;
        
        state.activeBan = {
            expiresAt: Date.now() + cooldownDuration
        };
        saveState('faceit_active_ban', state.activeBan);
    }

    updateUI();
    setCurrentTime(); // Reset logger time input
}

// Delete a logged infraction
function deleteInfraction(id) {
    state.infractions = state.infractions.filter(inf => inf.id !== id);
    saveState('faceit_infractions', state.infractions);
    updateUI();
}

// Filters active infractions (Rolling 30-day window)
function getActiveInfractions() {
    const now = Date.now();
    const cutoff = now - ROLLING_WINDOW_MS;
    return state.infractions.filter(inf => inf.timestamp >= cutoff);
}

// Filters expired infractions
function getExpiredInfractions() {
    const now = Date.now();
    const cutoff = now - ROLLING_WINDOW_MS;
    return state.infractions.filter(inf => inf.timestamp < cutoff);
}

// Core UI Updating Function
function updateUI() {
    const active = getActiveInfractions();

    // Update Predictor values
    const activeCount = active.length;
    document.getElementById('active-infractions-count').innerText = activeCount;

    const nextTimeIndex = Math.min(activeCount, INFRACTION_ESCALATION.length - 1);
    const nextCooldownObj = INFRACTION_ESCALATION[nextTimeIndex];
    document.getElementById('next-cooldown-time').innerText = nextCooldownObj.durationText;

    // Build the Ban Escalation Ladder UI
    buildEscalationLadder(activeCount);

    // Render History table rows
    renderHistoryTable();

    // Setup ban timers
    handleBanTimer();
    
    // Start live countdown refresh for list remaining times
    startInfractionCountdownTimer();
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
            statusText = '<span class="badge next-up-badge">NÄCHSTE</span>';
        } else {
            statusText = `<span class="badge muted">Stufe ${idx+1}</span>`;
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

// Switch between Active and Expired history tabs
function switchHistoryTab(tabType) {
    state.activeHistoryTab = tabType;
    document.getElementById('tab-active').classList.toggle('active', tabType === 'active');
    document.getElementById('tab-expired').classList.toggle('active', tabType === 'expired');
    renderHistoryTable();
}

// Render History Table rows based on selected tab
function renderHistoryTable() {
    const listContainer = document.getElementById('infraction-log-rows');
    listContainer.innerHTML = '';

    const list = state.activeHistoryTab === 'active' ? getActiveInfractions() : getExpiredInfractions();

    if (list.length === 0) {
        listContainer.innerHTML = `
            <tr>
                <td colspan="5" class="text-center muted">Keine Strafen in dieser Kategorie verzeichnet.</td>
            </tr>
        `;
        return;
    }

    list.forEach(inf => {
        const dateText = new Date(inf.timestamp).toLocaleString();
        const expirationTime = inf.timestamp + ROLLING_WINDOW_MS;
        const cleanDateText = new Date(expirationTime).toLocaleString();
        
        // Time remaining formatting
        let timeRemainingText = 'Abgelaufen';
        if (state.activeHistoryTab === 'active') {
            timeRemainingText = formatTimeRemaining(expirationTime - Date.now());
        }

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong class="text-red" style="text-transform: uppercase;">${inf.type}</strong></td>
            <td>${dateText}</td>
            <td>${cleanDateText}</td>
            <td class="font-mono text-green">${timeRemainingText}</td>
            <td>
                <button class="action-icon-btn" onclick="deleteInfraction('${inf.id}')" title="Eintrag löschen">
                    <svg style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
                    </svg>
                </button>
            </td>
        `;
        listContainer.appendChild(row);
    });
}

// Format duration in milliseconds to clean format
function formatTimeRemaining(durationMs) {
    if (durationMs <= 0) return 'Verfällt...';

    const seconds = Math.floor((durationMs / 1000) % 60);
    const minutes = Math.floor((durationMs / (1000 * 60)) % 60);
    const hours = Math.floor((durationMs / (1000 * 60 * 60)) % 24);
    const days = Math.floor(durationMs / (1000 * 60 * 60 * 24));

    let output = '';
    if (days > 0) output += `${days}d `;
    if (hours > 0 || days > 0) output += `${hours}h `;
    output += `${minutes}m`;

    return output;
}

// Start active ban timers
function showBanSetter() {
    document.getElementById('ban-setter-form').style.display = 'block';
}

function hideBanSetter() {
    document.getElementById('ban-setter-form').style.display = 'none';
}

// Start custom countdown active ban
function startCustomBan() {
    const value = parseInt(document.getElementById('ban-set-value').value) || 0;
    const unit = document.getElementById('ban-set-unit').value;

    if (value <= 0) {
        alert('Bitte wähle eine gültige Dauer.');
        return;
    }

    let multiplier = 60 * 1000; // default minutes
    if (unit === 'hours') multiplier = 60 * 60 * 1000;
    if (unit === 'days') multiplier = 24 * 60 * 60 * 1000;

    const expiresAt = Date.now() + (value * multiplier);

    state.activeBan = { expiresAt: expiresAt };
    saveState('faceit_active_ban', state.activeBan);
    hideBanSetter();
    updateUI();
}

// Clear currently active timer ban
function clearActiveBan() {
    state.activeBan = null;
    saveState('faceit_active_ban', null);
    if (banCountdownInterval) clearInterval(banCountdownInterval);
    document.getElementById('active-ban-card').style.display = 'none';
}

// Handle Active Ban ticking timer
function handleBanTimer() {
    if (banCountdownInterval) clearInterval(banCountdownInterval);

    if (!state.activeBan) {
        document.getElementById('active-ban-card').style.display = 'none';
        return;
    }

    const expiresAt = state.activeBan.expiresAt;
    const updateTimer = () => {
        const diff = expiresAt - Date.now();
        if (diff <= 0) {
            clearInterval(banCountdownInterval);
            document.getElementById('active-ban-card').style.display = 'none';
            state.activeBan = null;
            saveState('faceit_active_ban', null);
            alert('Deine FACEIT Queue-Sperre ist abgelaufen! Du kannst wieder spielen.');
            return;
        }

        document.getElementById('active-ban-card').style.display = 'block';
        document.getElementById('ban-timer-meta').innerText = `Gesperrt bis: ${new Date(expiresAt).toLocaleTimeString()}`;

        // Format countdown string
        const secs = Math.floor((diff / 1000) % 60);
        const mins = Math.floor((diff / (1000 * 60)) % 60);
        const hrs = Math.floor(diff / (1000 * 60 * 60));

        const pad = (num) => String(num).padStart(2, '0');
        document.getElementById('ban-timer-countdown').innerText = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    };

    updateTimer();
    banCountdownInterval = setInterval(updateTimer, 1000);
}

// Live update countdown remaining times in the infraction list
function startInfractionCountdownTimer() {
    if (infractionCountdownInterval) clearInterval(infractionCountdownInterval);

    infractionCountdownInterval = setInterval(() => {
        if (state.activeHistoryTab === 'active') {
            renderHistoryTable();
        }
    }, 15000); // Update every 15 seconds to save rendering cycles
}

// Export data to JSON file
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `faceit_stats_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

// Trigger input click for importing data
function triggerImport() {
    document.getElementById('import-file').click();
}

// Import data from JSON file
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsedData = JSON.parse(e.target.result);
            if (parsedData.config && parsedData.infractions) {
                state = { ...state, ...parsedData };
                saveState('faceit_config_v2', state.config);
                saveState('faceit_infractions', state.infractions);
                saveState('faceit_active_ban', state.activeBan);
                
                // Refresh inputs in HTML Form
                document.getElementById('nickname-search').value = state.config.nickname || '';

                updateUI();
                if (checkApiKeySetup() && state.config.nickname) {
                    fetchStats();
                }
                alert('Sicherungsdaten erfolgreich importiert!');
            } else {
                alert('Ungültige Backup-Datei.');
            }
        } catch (err) {
            alert('Fehler beim Lesen der Datei.');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

// Reset localStorage data
function clearAllData() {
    if (confirm('Bist du sicher, dass du alle Daten zurücksetzen möchtest? Dies löscht deine Suchhistorie und alle eingetragenen Strafen.')) {
        localStorage.clear();
        state = {
            config: { nickname: '' },
            infractions: [],
            activeBan: null,
            activeHistoryTab: 'active'
        };
        
        document.getElementById('nickname-search').value = '';
        
        // Hide dashboard
        document.getElementById('stats-dashboard').style.display = 'none';
        document.getElementById('matches-section').style.display = 'none';

        updateUI();
        
        if (banCountdownInterval) clearInterval(banCountdownInterval);
        if (infractionCountdownInterval) clearInterval(infractionCountdownInterval);
        
        alert('Alle Daten wurden zurückgesetzt.');
    }
}
