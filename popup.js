// popup.js

// --- Theme Selection ---
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeDropdown = document.getElementById('themeDropdown');
const themeOptions = themeDropdown.querySelectorAll('.theme-option');

function applyTheme(themeName) {
    document.body.className = '';
    if (themeName && themeName !== 'default') {
        document.body.classList.add('theme-' + themeName);
    }
    themeOptions.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.theme === themeName);
    });
}

// Load saved theme immediately
chrome.storage.sync.get('selectedTheme', (data) => {
    applyTheme(data.selectedTheme || 'default');
});

themeToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    themeDropdown.classList.toggle('open');
});

themeOptions.forEach(opt => {
    opt.addEventListener('click', async (e) => {
        e.stopPropagation();
        const theme = opt.dataset.theme;
        applyTheme(theme);
        await chrome.storage.sync.set({ selectedTheme: theme });
        themeDropdown.classList.remove('open');
    });
});

// Close dropdown when clicking elsewhere
document.addEventListener('click', () => {
    themeDropdown.classList.remove('open');
});

const statusDiv = document.getElementById('status');

// --- Pop Out / Side Panel ---
const popOutBtn = document.getElementById('popOutBtn');
const sidePanelBtn = document.getElementById('sidePanelBtn');

// Detect if we're running inside a popout window (via ?mode=popout query param)
(function detectMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'popout') {
        document.body.classList.add('mode-popout');
    }
})();

// Helper: find the cor3.gg tab across all windows (needed for pop-out window mode)
async function getCor3Tab() {
    // First try the active tab in the current window (works for popup & side panel)
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && (activeTab.url.includes('cor3.gg') || activeTab.url.includes('os.cor3.gg'))) {
        return activeTab;
    }
    // Fallback: search all tabs for a cor3.gg tab (needed for pop-out window)
    const allTabs = await chrome.tabs.query({ url: ['https://cor3.gg/*', 'https://os.cor3.gg/*'] });
    return allTabs.length > 0 ? allTabs[0] : null;
}

if (popOutBtn) {
    popOutBtn.addEventListener('click', () => {
        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?mode=popout'),
            type: 'popup',
            width: 360,
            height: 700
        });
        window.close();
    });
}

if (sidePanelBtn) {
    sidePanelBtn.addEventListener('click', async () => {
        try {
            const tab = await getCor3Tab();
            if (!tab) { statusDiv.textContent = 'No cor3.gg tab found.'; return; }
            await chrome.sidePanel.open({ tabId: tab.id });
            window.close();
        } catch (e) {
            // Fallback: if sidePanel API isn't available, notify user
            statusDiv.textContent = 'Side panel not supported in this browser.';
        }
    });
}

// --- Multi-Alarm System ---
const alarmList = document.getElementById('alarmList');
const alarmForm = document.getElementById('alarmForm');
const alarmFormTitle = document.getElementById('alarmFormTitle');
const addAlarmBtn = document.getElementById('addAlarmBtn');
const saveAlarmBtn = document.getElementById('saveAlarmBtn');
const cancelAlarmBtn = document.getElementById('cancelAlarmBtn');
const testAlarmBtn = document.getElementById('testAlarmBtn');
const stopAllAlarmsBtn = document.getElementById('stopAllAlarmsBtn');
const alarmTimerSelect = document.getElementById('alarmTimerSelect');
const alarmMinutes = document.getElementById('alarmMinutes');
const alarmSeconds = document.getElementById('alarmSeconds');
const alarmContinuous = document.getElementById('alarmContinuous');
const alarmVolumeSlider = document.getElementById('alarmVolume');
const alarmVolumeLabel = document.getElementById('alarmVolumeLabel');

let alarms = []; // array of alarm objects
let editingAlarmId = null; // null = new, string = editing existing

const TIMER_LABELS = {
    daily: 'Daily Ops Timer',
    home_jobs: 'Market-1 Jobs Reset',
    dark_jobs: 'Market-2 Jobs Reset'
};

// Dynamically populate expedition options in alarm timer select
const alarmExpeditionGroup = document.getElementById('alarmExpeditionGroup');

function updateExpeditionAlarmOptions(expeditions) {
    if (!alarmExpeditionGroup) return;
    alarmExpeditionGroup.innerHTML = '';
    if (!expeditions || expeditions.length === 0) return;
    for (const exp of expeditions) {
        if (!exp.endTime) continue;
        const opt = document.createElement('option');
        opt.value = 'exp_' + exp.id;
        const label = (exp.locationName || 'Expedition') + ' — ' + (exp.zoneName || '');
        opt.textContent = label;
        TIMER_LABELS['exp_' + exp.id] = label;
        alarmExpeditionGroup.appendChild(opt);
    }
    // Re-render alarm list to update labels for any existing expedition alarms
    renderAlarmList();
}

alarmVolumeSlider.addEventListener('input', () => {
    alarmVolumeLabel.textContent = alarmVolumeSlider.value + '%';
});

function generateAlarmId() {
    return 'alarm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

async function loadAlarms() {
    const data = await chrome.storage.sync.get('alarms');
    alarms = data.alarms || [];
    renderAlarmList();
    sendAlarmsToContent();
}

async function saveAlarms() {
    await chrome.storage.sync.set({ alarms });
    renderAlarmList();
    sendAlarmsToContent();
}

async function sendAlarmsToContent() {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "updateAlarms",
            alarms: alarms
        }).catch(() => {});
    }
}

function renderAlarmList() {
    if (alarms.length === 0) {
        alarmList.innerHTML = '<div class="no-alarms">No alarms configured. Click ➕ to add one.</div>';
        return;
    }
    alarmList.innerHTML = alarms.map(a => {
        const mins = Math.floor(a.thresholdSeconds / 60);
        const secs = a.thresholdSeconds % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        return `
        <div class="alarm-card ${a.enabled ? '' : 'alarm-off'}" data-id="${a.id}">
            <label class="alarm-toggle-switch">
                <input type="checkbox" ${a.enabled ? 'checked' : ''} data-action="toggle" data-id="${a.id}">
                <span class="slider-track"></span>
            </label>
            <div class="alarm-info">
                <div class="alarm-name">${TIMER_LABELS[a.timerSource] || a.timerSource}</div>
                <div class="alarm-detail">⏱ ${timeStr} · 🔊 ${a.volume}%${a.continuous ? ' · 🔁' : ''}</div>
            </div>
            <div class="alarm-actions">
                <button data-action="edit" data-id="${a.id}" title="Edit">✏️</button>
                <button data-action="delete" data-id="${a.id}" title="Delete">🗑️</button>
            </div>
        </div>`;
    }).join('');

    // Bind events
    alarmList.querySelectorAll('[data-action="toggle"]').forEach(el => {
        el.addEventListener('change', async (e) => {
            const alarm = alarms.find(a => a.id === e.target.dataset.id);
            if (alarm) {
                alarm.enabled = e.target.checked;
                await saveAlarms();
            }
        });
    });
    alarmList.querySelectorAll('[data-action="edit"]').forEach(el => {
        el.addEventListener('click', (e) => {
            const alarm = alarms.find(a => a.id === e.target.dataset.id);
            if (alarm) openAlarmForm(alarm);
        });
    });
    alarmList.querySelectorAll('[data-action="delete"]').forEach(el => {
        el.addEventListener('click', async (e) => {
            alarms = alarms.filter(a => a.id !== e.target.dataset.id);
            await saveAlarms();
        });
    });
}

function openAlarmForm(alarm = null) {
    if (alarm) {
        editingAlarmId = alarm.id;
        alarmFormTitle.textContent = 'Edit Alarm';
        alarmTimerSelect.value = alarm.timerSource;
        alarmMinutes.value = Math.floor(alarm.thresholdSeconds / 60);
        alarmSeconds.value = alarm.thresholdSeconds % 60;
        alarmContinuous.checked = alarm.continuous;
        alarmVolumeSlider.value = alarm.volume;
        alarmVolumeLabel.textContent = alarm.volume + '%';
    } else {
        editingAlarmId = null;
        alarmFormTitle.textContent = 'New Alarm';
        alarmTimerSelect.value = 'daily';
        alarmMinutes.value = 1;
        alarmSeconds.value = 0;
        alarmContinuous.checked = false;
        alarmVolumeSlider.value = 50;
        alarmVolumeLabel.textContent = '50%';
    }
    alarmForm.style.display = '';
}

function closeAlarmForm() {
    alarmForm.style.display = 'none';
    editingAlarmId = null;
}

addAlarmBtn.addEventListener('click', () => openAlarmForm());
cancelAlarmBtn.addEventListener('click', () => closeAlarmForm());

saveAlarmBtn.addEventListener('click', async () => {
    const thresholdSec = (parseInt(alarmMinutes.value) || 0) * 60 + (parseInt(alarmSeconds.value) || 0);
    if (thresholdSec <= 0) return;
    const alarmData = {
        timerSource: alarmTimerSelect.value,
        thresholdSeconds: thresholdSec,
        continuous: alarmContinuous.checked,
        volume: parseInt(alarmVolumeSlider.value),
        enabled: true
    };
    if (editingAlarmId) {
        const idx = alarms.findIndex(a => a.id === editingAlarmId);
        if (idx >= 0) {
            alarms[idx] = { ...alarms[idx], ...alarmData };
        }
    } else {
        alarms.push({ id: generateAlarmId(), ...alarmData });
    }
    await saveAlarms();
    closeAlarmForm();
});

testAlarmBtn.addEventListener('click', async () => {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "testAlarm",
            volume: parseInt(alarmVolumeSlider.value),
            continuous: alarmContinuous.checked
        });
    }
});

stopAllAlarmsBtn.addEventListener('click', async () => {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: "stopAlarm" });
        stopAllAlarmsBtn.style.display = 'none';
    }
});

// Listen for alarm status from content script
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "alarmActiveStatus") {
        stopAllAlarmsBtn.style.display = request.isActive ? '' : 'none';
        statusDiv.textContent = request.isActive ? 'Alarm sounding...' : 'Ready';
    }
});

loadAlarms();

// --- Refresh All ---
const refreshAllBtn = document.getElementById('refreshAllBtn');
const refreshDailyBtn = document.getElementById('refreshDailyBtn');
const refreshExpeditionsBtn = document.getElementById('refreshExpeditionsBtn');

// "Last updated" display elements
const dailyLastUpdated = document.getElementById('dailyLastUpdated');
const coreMarketLastUpdated = document.getElementById('coreMarketLastUpdated');
const darkMarketLastUpdated = document.getElementById('darkMarketLastUpdated');
const expeditionLastUpdated = document.getElementById('expeditionLastUpdated');

function formatTimeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Updated just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `Updated ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `Updated ${hrs}h ${remMins}m ago`;
}

function showLastUpdated(el, tsKey) {
    chrome.storage.local.get(tsKey, (result) => {
        const ts = result[tsKey];
        el.textContent = ts ? formatTimeAgo(ts) : '';
    });
}

// Update all "last updated" labels periodically
function refreshAllTimestamps() {
    showLastUpdated(dailyLastUpdated, 'dailyOpsUpdatedAt');
    showLastUpdated(coreMarketLastUpdated, 'marketDataUpdatedAt');
    showLastUpdated(darkMarketLastUpdated, 'darkMarketDataUpdatedAt');
    showLastUpdated(expeditionLastUpdated, 'expeditionsDataUpdatedAt');
}

// --- Expedition Info + Decisions (inline) ---
const expeditionInfoContainer = document.getElementById('expeditionInfoContainer');
const decisionsContainer = document.getElementById('decisionsContainer');
const decisionsSectionToggle = document.getElementById('decisionsSectionToggle');
const decisionsSectionBody = document.getElementById('decisionsSectionBody');

// Expedition timer end times keyed by expedition id
let expeditionEndTimes = {};

decisionsSectionToggle.addEventListener('click', () => {
    decisionsSectionToggle.classList.toggle('open');
    decisionsSectionBody.classList.toggle('open');
});

function renderExpeditionInfo(expeditions) {
    expeditionInfoContainer.innerHTML = '';

    if (!expeditions || expeditions.length === 0) {
        expeditionInfoContainer.innerHTML = '<div class="no-decisions">No active expeditions.</div>';
        return;
    }

    for (const exp of expeditions) {
        // Store endTime for live timer ticking
        if (exp.endTime) {
            expeditionEndTimes[exp.id] = exp.endTime;
        }

        const card = document.createElement('div');
        card.className = 'expedition-card';

        const statusClass = exp.status === 'RUNNING' ? ' running' : '';
        const mercName = exp.mercenary ? exp.mercenary.callsign : 'Unknown';
        const insurance = exp.hasInsurance ? 'Yes' : 'No';

        let timerHtml = '';
        if (exp.endTime) {
            timerHtml = `
                <div class="exp-timer-row">
                    <span style="font-size:11px;color:var(--accent-orange);">⏳ <span class="exp-timer" data-exp-id="${exp.id}">${formatTimeRemaining(exp.endTime)}</span></span>
                    <button class="refresh-btn-small pin-btn pin-exp-btn" data-exp-id="${exp.id}" title="Pin Expedition Timer">📌</button>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="exp-header">
                <span class="exp-title">📍 ${exp.locationName || 'Unknown'} — ${exp.zoneName || 'Unknown'}</span>
                <span class="exp-status${statusClass}">${exp.status || 'UNKNOWN'}</span>
            </div>
            <div class="detail-row"><span class="label">Mercenary:</span> 🧑 ${mercName}</div>
            <div class="detail-row"><span class="label">Total Cost:</span> 💰 ${exp.totalCost ? exp.totalCost.toLocaleString() : '--'}</div>
            <div class="detail-row"><span class="label">Insurance:</span> ${insurance}</div>
            <div class="detail-row"><span class="label">Risk Score:</span> ${exp.riskScore ?? '--'}</div>
            ${timerHtml}
        `;
        expeditionInfoContainer.appendChild(card);
    }

    // Wire up pin buttons
    expeditionInfoContainer.querySelectorAll('.pin-exp-btn').forEach(btn => {
        const expId = btn.dataset.expId;
        btn.classList.toggle('pinned', !!pinnedTimers['exp_' + expId]);
        btn.addEventListener('click', async () => {
            const key = 'exp_' + expId;
            pinnedTimers[key] = !pinnedTimers[key];
            btn.classList.toggle('pinned', !!pinnedTimers[key]);
            await savePinnedState();
            renderPinnedTimers();
        });
    });
}

function renderDecisions(decisions) {
    decisionsContainer.innerHTML = '';

    if (!decisions || decisions.length === 0) {
        decisionsContainer.innerHTML = '<div class="no-decisions">No pending decisions found.</div>';
        return;
    }

    for (const d of decisions) {
        const card = document.createElement('div');
        card.className = 'decision-card';

        const statusTag = d.isResolved
            ? '<span class="resolved-tag">RESOLVED</span>'
            : '<span class="pending-tag">PENDING</span>';

        let deadlineHtml = '';
        if (d.decisionDeadline) {
            const dl = new Date(d.decisionDeadline);
            const now = new Date();
            const diffMs = dl - now;
            if (diffMs > 0) {
                const mins = Math.floor(diffMs / 60000);
                const hrs = Math.floor(mins / 60);
                const remMins = mins % 60;
                deadlineHtml = `<div class="deadline">⏳ Deadline: ${hrs}h ${remMins}m remaining</div>`;
            } else {
                deadlineHtml = '<div class="deadline">⏳ Deadline: Expired</div>';
            }
        }

        let optionsHtml = '';
        if (Array.isArray(d.decisionOptions)) {
            for (const opt of d.decisionOptions) {
                const isSelected = d.selectedOption === opt.id;
                const selectedClass = isSelected ? ' option-selected' : '';
                const riskSign = opt.riskModifier > 0 ? '+' : '';
                const lootSign = opt.lootModifier > 0 ? '+' : '';
                optionsHtml += `
                    <div class="option-row${selectedClass}">
                        <span class="option-label">${opt.label}${isSelected ? ' ✓' : ''}</span>
                        <span class="option-stats">
                            <span class="stat-risk">Risk: ${riskSign}${opt.riskModifier}</span>
                            <span class="stat-loot">Loot: ${lootSign}${opt.lootModifier}</span>
                        </span>
                    </div>`;
            }
        }

        card.innerHTML = `
            <div class="merc-info">🧑 ${d.mercenaryCallsign} — ${d.locationName} / ${d.zoneName} ${statusTag}</div>
            <div class="msg-content">${d.content}</div>
            ${deadlineHtml}
            ${optionsHtml}
        `;
        decisionsContainer.appendChild(card);
    }
}

async function loadExpeditions() {
    const { expeditionsData, expeditionDecisions } = await chrome.storage.local.get(['expeditionsData', 'expeditionDecisions']);
    renderExpeditionInfo(expeditionsData || []);
    renderDecisions(expeditionDecisions || []);
    updateExpeditionAlarmOptions(expeditionsData || []);
    refreshAllTimestamps();
}

async function requestExpeditions() {
    expeditionInfoContainer.innerHTML = '<div class="no-decisions">Loading expedition data...</div>';
    // Clear old data so poll detects fresh arrival
    await chrome.storage.local.remove(['expeditionsData', 'expeditionDecisions']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
    } catch (e) { /* not reachable */ }
    // Poll for expedition data
    let loaded = false;
    const poll = setInterval(async () => {
        const { expeditionsData } = await chrome.storage.local.get('expeditionsData');
        if (expeditionsData) {
            clearInterval(poll);
            if (loaded) return;
            loaded = true;
            await loadExpeditions();
        }
    }, 300);
    // Safety timeout: show no data after 5s if nothing came
    setTimeout(() => {
        clearInterval(poll);
        if (!loaded) {
            loaded = true;
            expeditionInfoContainer.innerHTML = '<div class="no-decisions">No active expeditions.</div>';
            decisionsContainer.innerHTML = '<div class="no-decisions">No pending decisions found.</div>';
        }
    }, 5000);
}

refreshExpeditionsBtn.addEventListener('click', () => requestExpeditions());

// --- Inventory (inline expandable) ---
const inventoryContainer = document.getElementById('inventoryContainer');
const inventorySectionToggle = document.getElementById('inventorySectionToggle');
const inventorySectionBody = document.getElementById('inventorySectionBody');
const spaceInfo = document.getElementById('spaceInfo');
let inventoryLoaded = false;

inventorySectionToggle.addEventListener('click', async () => {
    inventorySectionToggle.classList.toggle('open');
    inventorySectionBody.classList.toggle('open');
    // Load inventory on first expand
    if (inventorySectionToggle.classList.contains('open') && !inventoryLoaded) {
        inventoryLoaded = true;
        await requestAndLoadInventory();
    }
});

async function requestAndLoadInventory() {
    inventoryContainer.innerHTML = '<div class="no-decisions">Requesting inventory from server...</div>';
    spaceInfo.textContent = '-- / --';
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestStash" });
    } catch (e) { /* not reachable */ }
    // Wait for WS response (leave + rejoin with human delays), then load from storage
    setTimeout(() => loadInventory(), 2500);
}

async function loadInventory() {
    const { stashData } = await chrome.storage.local.get('stashData');
    renderInventory(stashData);
}

function renderInventory(data) {
    inventoryContainer.innerHTML = '';

    if (!data || !data.items || data.items.length === 0) {
        inventoryContainer.innerHTML = '<div class="no-decisions">No items found.<br>Make sure you have the cor3.gg tab open.</div>';
        spaceInfo.textContent = '-- / --';
        return;
    }

    const used = data.currentUsage || data.items.length;
    const max = data.maxCapacity || '?';
    spaceInfo.textContent = `${used} / ${max}`;

    // Calculate total sell value
    let totalSellValue = 0;
    for (const item of data.items) {
        if (item.canSell && item.sellPrice) {
            totalSellValue += item.sellPrice;
        }
    }
    const totalValueEl = document.getElementById('totalValue');
    if (totalValueEl) {
        totalValueEl.textContent = totalSellValue > 0 ? `(💰 ${totalSellValue.toLocaleString()})` : '';
    }

    for (const item of data.items) {
        const card = document.createElement('div');
        const tierClass = 'tier-' + (item.tier || 'common').toLowerCase();
        card.className = 'item-card ' + tierClass;

        const tierTagClass = 'tier-tag tier-tag-' + (item.tier || 'common').toLowerCase();

        let badgesHtml = `<span class="${tierTagClass}">${item.tier || 'COMMON'}</span>`;
        if (item.canSell) badgesHtml += '<span class="badge badge-sell">SELL</span>';
        if (item.canCraft) badgesHtml += '<span class="badge badge-craft">CRAFT</span>';
        if (item.canUse) badgesHtml += '<span class="badge badge-use">USE</span>';
        if (item.canDelete) badgesHtml += '<span class="badge badge-delete">DEL</span>';

        const priceHtml = item.canSell && item.sellPrice
            ? `<div class="item-price">💰 ${item.sellPrice.toLocaleString()}</div>`
            : '';

        const imgSrc = item.imageUrl || '';
        const imgHtml = imgSrc
            ? `<img src="${imgSrc}" alt="${item.name}" loading="lazy">`
            : '';

        card.innerHTML = `
            ${imgHtml}
            <div class="item-details">
                <div class="item-name">${item.name}</div>
                <div class="item-badges">${badgesHtml}</div>
                ${priceHtml}
            </div>
        `;
        inventoryContainer.appendChild(card);
    }
}

// --- Daily Ops Timer ---
const dailyTimerLine = document.getElementById('dailyTimerLine');
const dailyClaimed = document.getElementById('dailyClaimed');
const dailyStreak = document.getElementById('dailyStreak');
const dailyDifficulty = document.getElementById('dailyDifficulty');
const dailyStreakBonus = document.getElementById('dailyStreakBonus');

let dailyNextTaskTime = null;

function updateDailyTimer() {
    if (!dailyNextTaskTime) {
        dailyTimerLine.textContent = '⏳ Next Task: --:--:--';
        return;
    }
    const now = Date.now();
    const diff = dailyNextTaskTime - now;
    if (diff <= 0) {
        dailyTimerLine.textContent = '⏳ Next Task: 0h:0m:0s';
        return;
    }
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    dailyTimerLine.textContent = `⏳ Next Task: ${h}h:${m}m:${s}s`;
}

async function fetchDailyOps() {
    try {
        const tab = await getCor3Tab();
        if (!tab) throw new Error('No cor3.gg tab');
        const response = await chrome.tabs.sendMessage(tab.id, { action: "fetchDailyOps" });
        if (response && response.data) {
            const data = response.data;
            dailyNextTaskTime = data.nextTaskTime ? new Date(data.nextTaskTime).getTime() : null;
            dailyClaimed.textContent = data.hasClaimedToday ? 'Yes' : 'No';
            dailyStreak.textContent = data.currentStreak ?? '--';
            dailyDifficulty.textContent = data.difficulty ?? '--';
            dailyStreakBonus.textContent = data.streakBonus ?? '--';
            updateDailyTimer();
            refreshAllTimestamps();
        } else {
            // Try from cached storage as fallback
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) {
                dailyNextTaskTime = dailyOpsData.nextTaskTime ? new Date(dailyOpsData.nextTaskTime).getTime() : null;
                dailyClaimed.textContent = dailyOpsData.hasClaimedToday ? 'Yes' : 'No';
                dailyStreak.textContent = dailyOpsData.currentStreak ?? '--';
                dailyDifficulty.textContent = dailyOpsData.difficulty ?? '--';
                dailyStreakBonus.textContent = dailyOpsData.streakBonus ?? '--';
                updateDailyTimer();
            }
        }
    } catch (e) {
        // Content script not reachable — try cached data
        try {
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) {
                dailyNextTaskTime = dailyOpsData.nextTaskTime ? new Date(dailyOpsData.nextTaskTime).getTime() : null;
                dailyClaimed.textContent = dailyOpsData.hasClaimedToday ? 'Yes' : 'No';
                dailyStreak.textContent = dailyOpsData.currentStreak ?? '--';
                dailyDifficulty.textContent = dailyOpsData.difficulty ?? '--';
                dailyStreakBonus.textContent = dailyOpsData.streakBonus ?? '--';
                updateDailyTimer();
            } else {
                dailyTimerLine.textContent = '⏳ Next Task: --:--:--';
            }
        } catch (e2) {
            dailyTimerLine.textContent = '⏳ Next Task: --:--:--';
        }
    }
}

// Load cached daily ops on popup open (no WS request)
async function loadCachedDailyOps() {
    try {
        const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
        if (dailyOpsData) {
            dailyNextTaskTime = dailyOpsData.nextTaskTime ? new Date(dailyOpsData.nextTaskTime).getTime() : null;
            dailyClaimed.textContent = dailyOpsData.hasClaimedToday ? 'Yes' : 'No';
            dailyStreak.textContent = dailyOpsData.currentStreak ?? '--';
            dailyDifficulty.textContent = dailyOpsData.difficulty ?? '--';
            dailyStreakBonus.textContent = dailyOpsData.streakBonus ?? '--';
            updateDailyTimer();
        }
    } catch (e) {}
}
loadCachedDailyOps();

refreshDailyBtn.addEventListener('click', () => fetchDailyOps());

// --- Markets ---
const marketContainer = document.getElementById('marketContainer');
const darkMarketContainer = document.getElementById('darkMarketContainer');
const refreshMarketBtn = document.getElementById('refreshMarketBtn');
const refreshDarkMarketBtn = document.getElementById('refreshDarkMarketBtn');
const coreMarketLabel = document.getElementById('coreMarketLabel');
const darkMarketLabel = document.getElementById('darkMarketLabel');

// Market names from WS data
let coreMarketName = null;
let darkMarketName = null;

function formatTimeRemaining(dateStr) {
    if (!dateStr) return '--';
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}h:${m}m:${s}s`;
}

function getRemainingSeconds(dateStr) {
    if (!dateStr) return null;
    const diff = new Date(dateStr).getTime() - Date.now();
    return diff > 0 ? Math.floor(diff / 1000) : 0;
}

function updateMarketLabel(labelEl, wsName, placeholder, icon) {
    if (wsName) {
        labelEl.textContent = `${icon} ${wsName}`;
    } else {
        labelEl.textContent = `${icon} ${placeholder}`;
    }
}

function renderMarketInto(container, data, labelPrefix, idPrefix) {
    container.innerHTML = '';

    if (!data || !data.market) {
        container.innerHTML = '<div class="no-decisions">No market data available.<br>Make sure you have the cor3.gg tab open.</div>';
        return;
    }

    const md = data;
    const market = md.market;
    const rep = md.reputation;

    let html = '';

    // Credits
    if (md.userCredits !== undefined) {
        html += `<div style="font-size:11px;color:var(--accent-green);margin-bottom:4px;">💰 Credits: ${md.userCredits.toLocaleString()}</div>`;
    }

    // Reputation section
    if (rep) {
        const pct = rep.requiredReputation > 0 ? Math.min(100, Math.floor((rep.progress / rep.requiredReputation) * 100)) : 0;
        html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Reputation — Level ${rep.level}</div>`;
        html += `<div class="market-rep-bar"><div class="market-rep-fill" style="width:${pct}%"></div></div>`;
        html += `<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">`;
        html += `Progress: ${rep.progress}/${rep.requiredReputation} · `;
        html += `Level Locked: ${rep.isLevelLocked ? 'Yes' : 'No'} · `;
        html += `Max Level: ${rep.isMaxLevel ? 'Yes' : 'No'}`;
        html += `</div>`;
    }

    // Next jobs reset timer
    if (md.nextJobsResetAt) {
        html += `<div class="${idPrefix}-reset-timer" style="font-size:11px;color:var(--accent-orange);margin-bottom:8px;">⏳ Jobs Reset: ${formatTimeRemaining(md.nextJobsResetAt)}</div>`;
    }

    // Items List (expandable)
    html += `<div class="expandable-header" id="${idPrefix}ItemsToggle"><span class="expand-arrow">▶</span><span class="expand-label">Items List (${(md.lots || []).length})</span></div>`;
    html += `<div class="expandable-body" id="${idPrefix}ItemsBody">`;

    if (md.lots && md.lots.length > 0) {
        // Group by category
        const groups = {};
        for (const lot of md.lots) {
            const cat = lot.category || 'OTHER';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(lot);
        }

        for (const [cat, items] of Object.entries(groups)) {
            html += `<div class="market-category-title">${cat.charAt(0) + cat.slice(1).toLowerCase()}</div>`;
            for (const lot of items) {
                const det = lot.details || {};
                const isBought = lot.availableCount === 0;
                const boughtTag = isBought ? '<span class="market-item-bought">BOUGHT</span>' : '';
                const imgHtml = det.image ? `<img src="${det.image}" alt="${det.name || ''}" loading="lazy">` : '';

                html += `<div class="market-item-card">`;
                html += imgHtml;
                html += `<div class="market-item-info">`;
                html += `<div class="market-item-name">${det.name || 'Unknown'}${boughtTag}</div>`;
                html += `<div class="market-item-price">💰 ${lot.price ? lot.price.toLocaleString() : '--'}</div>`;

                // Expandable details per item
                const uid = idPrefix + '_mitem_' + lot.id;
                html += `<div class="expandable-header" data-expand="${uid}"><span class="expand-arrow">▶</span><span class="expand-label">Details</span></div>`;
                html += `<div class="expandable-body" id="${uid}">`;
                html += `<div class="detail-row"><span class="label">Category:</span> ${det.category || lot.category || '--'}</div>`;
                html += `<div class="detail-row"><span class="label">Name:</span> ${det.name || '--'}</div>`;
                html += `<div class="detail-row"><span class="label">Base Price:</span> ${det.price ? det.price.toLocaleString() : '--'}</div>`;
                html += `</div>`;

                html += `</div></div>`;
            }
        }
    } else {
        html += '<div class="no-decisions">No items in market.</div>';
    }
    html += `</div>`;

    container.innerHTML = html;

    // Wire up expandable toggles inside market
    container.querySelectorAll('.expandable-header').forEach(hdr => {
        hdr.addEventListener('click', () => {
            hdr.classList.toggle('open');
            const targetId = hdr.getAttribute('data-expand') || hdr.id.replace('Toggle', 'Body');
            const body = document.getElementById(targetId);
            if (body) body.classList.toggle('open');
        });
    });
}

// Store static reset timestamps so timers tick independently
let coreNextJobsResetAt = null;
let bmiNextJobsResetAt = null;

function renderMarket(data) {
    if (data && data.nextJobsResetAt) coreNextJobsResetAt = data.nextJobsResetAt;
    // Update market name from WS data
    if (data && data.market && data.market.marketName) {
        coreMarketName = data.market.marketName;
        updateMarketLabel(coreMarketLabel, coreMarketName, 'Market-1', '🏠');
        // Update alarm dropdown option text and alarm list labels
        TIMER_LABELS.home_jobs = coreMarketName + ' Jobs Reset';
        const opt = alarmTimerSelect.querySelector('option[value="home_jobs"]');
        if (opt) opt.textContent = TIMER_LABELS.home_jobs;
        // Re-render pinned timers and alarm list to update labels
        renderPinnedTimers();
        renderAlarmList();
    }
    renderMarketInto(marketContainer, data, 'Market-1', 'home');
}

function renderDarkMarket(data, available) {
    if (available === false) {
        darkMarketContainer.innerHTML = '<div class="no-decisions" style="color:var(--accent-red);">⚠️ Market-2 is currently unavailable.<br>The endpoint server could not be reached.</div>';
        return;
    }
    if (data && data.nextJobsResetAt) bmiNextJobsResetAt = data.nextJobsResetAt;
    // Update market name from WS data
    if (data && data.market && data.market.marketName) {
        darkMarketName = data.market.marketName;
        updateMarketLabel(darkMarketLabel, darkMarketName, 'Market-2', '🌑');
        // Update alarm dropdown option text and alarm list labels
        TIMER_LABELS.dark_jobs = darkMarketName + ' Jobs Reset';
        const opt = alarmTimerSelect.querySelector('option[value="dark_jobs"]');
        if (opt) opt.textContent = TIMER_LABELS.dark_jobs;
        // Re-render pinned timers and alarm list to update labels
        renderPinnedTimers();
        renderAlarmList();
    }
    renderMarketInto(darkMarketContainer, data, 'Market-2', 'dark');
}

async function loadMarket() {
    const { marketData } = await chrome.storage.local.get('marketData');
    renderMarket(marketData);
}

async function loadDarkMarket() {
    const { darkMarketData, darkMarketAvailable } = await chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable']);
    renderDarkMarket(darkMarketData, darkMarketAvailable);
}

// Request both markets — just sends get.options, no room joins needed
async function requestMarketData() {
    marketContainer.innerHTML = '<div class="no-decisions">Requesting market data...</div>';
    darkMarketContainer.innerHTML = '<div class="no-decisions">Requesting market data...</div>';
    await chrome.storage.local.remove(['marketData', 'darkMarketData', 'darkMarketAvailable']);
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "requestMarket" });
            await chrome.tabs.sendMessage(tab.id, { action: "requestDarkMarket" });
        }
    } catch (e) { /* content script not reachable */ }
    // Poll for both markets to arrive
    return new Promise((resolve) => {
        let coreLoaded = false, darkLoaded = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['marketData', 'darkMarketData']);
            if (!coreLoaded && data.marketData && data.marketData.market) {
                coreLoaded = true;
                renderMarket(data.marketData);
                refreshAllTimestamps();
            }
            if (!darkLoaded && data.darkMarketData && data.darkMarketData.market) {
                darkLoaded = true;
                renderDarkMarket(data.darkMarketData, true);
                refreshAllTimestamps();
            }
            if (coreLoaded && darkLoaded) {
                clearInterval(poll);
                resolve();
            }
        }, 500);
        // Safety timeout: 10s
        setTimeout(() => {
            clearInterval(poll);
            if (!coreLoaded) loadMarket();
            if (!darkLoaded) loadDarkMarket();
            refreshAllTimestamps();
            resolve();
        }, 10000);
    });
}

async function refreshMarketData() {
    marketContainer.innerHTML = '<div class="no-decisions">Refreshing market data...</div>';
    try {
        const tab = await getCor3Tab();
        if (!tab) throw new Error('No cor3.gg tab');
        await chrome.tabs.sendMessage(tab.id, { action: "refreshMarket" });
        setTimeout(() => { loadMarket(); refreshAllTimestamps(); }, 3000);
    } catch (e) {
        setTimeout(() => { loadMarket(); refreshAllTimestamps(); }, 500);
    }
}

refreshMarketBtn.addEventListener('click', () => refreshMarketData());

async function refreshDarkMarketData() {
    darkMarketContainer.innerHTML = '<div class="no-decisions">Refreshing market data...</div>';
    try {
        const tab = await getCor3Tab();
        if (!tab) throw new Error('No cor3.gg tab');
        await chrome.tabs.sendMessage(tab.id, { action: "refreshDarkMarket" });
        setTimeout(() => { loadDarkMarket(); refreshAllTimestamps(); }, 3000);
    } catch (e) {
        setTimeout(() => { loadDarkMarket(); refreshAllTimestamps(); }, 500);
    }
}

refreshDarkMarketBtn.addEventListener('click', () => refreshDarkMarketData());

// On popup open: load cached market data (no WS requests)
chrome.storage.local.get(['marketData', 'darkMarketData', 'darkMarketAvailable'], (result) => {
    if (result.marketData) {
        if (result.marketData.nextJobsResetAt) coreNextJobsResetAt = result.marketData.nextJobsResetAt;
        if (result.marketData.market && result.marketData.market.marketName) {
            coreMarketName = result.marketData.market.marketName;
            updateMarketLabel(coreMarketLabel, coreMarketName, 'Market-1', '🏠');
            TIMER_LABELS.home_jobs = coreMarketName + ' Jobs Reset';
            const opt = alarmTimerSelect.querySelector('option[value="home_jobs"]');
            if (opt) opt.textContent = TIMER_LABELS.home_jobs;
        }
        renderMarket(result.marketData);
    } else {
        marketContainer.innerHTML = '<div class="no-decisions">No market data cached. Click 🔄 to refresh.</div>';
    }
    if (result.darkMarketData) {
        if (result.darkMarketData.nextJobsResetAt) bmiNextJobsResetAt = result.darkMarketData.nextJobsResetAt;
        if (result.darkMarketData.market && result.darkMarketData.market.marketName) {
            darkMarketName = result.darkMarketData.market.marketName;
            updateMarketLabel(darkMarketLabel, darkMarketName, 'Market-2', '🌑');
            TIMER_LABELS.dark_jobs = darkMarketName + ' Jobs Reset';
            const opt = alarmTimerSelect.querySelector('option[value="dark_jobs"]');
            if (opt) opt.textContent = TIMER_LABELS.dark_jobs;
        }
        renderDarkMarket(result.darkMarketData, result.darkMarketAvailable);
    } else {
        darkMarketContainer.innerHTML = '<div class="no-decisions">No market data cached. Click 🔄 to refresh.</div>';
    }
});

// On popup open: load cached expeditions (no WS requests)
loadExpeditions();

// Show all "last updated" timestamps
refreshAllTimestamps();

// --- Refresh All Button ---
let isRefreshing = false;
refreshAllBtn.addEventListener('click', async () => {
    if (isRefreshing) return;
    isRefreshing = true;
    refreshAllBtn.classList.add('spinning');
    try {
        // 1. Daily ops
        await fetchDailyOps();
        // 2. Markets (core then dark sequentially)
        await requestMarketData();
        // 3. Expeditions (after markets done)
        await requestExpeditions();
    } catch (e) {}
    refreshAllBtn.classList.remove('spinning');
    isRefreshing = false;
    refreshAllTimestamps();
});

// --- Pinned Timers ---
const pinnedTimersSection = document.getElementById('pinnedTimersSection');
const pinnedTimersContainer = document.getElementById('pinnedTimersContainer');
const pinDailyBtn = document.getElementById('pinDailyBtn');
const pinCoreMarketBtn = document.getElementById('pinCoreMarketBtn');
const pinDarkMarketBtn = document.getElementById('pinDarkMarketBtn');

// State: which timers are pinned
let pinnedTimers = { daily: false, home_jobs: false, dark_jobs: false };
// State: auto-refresh for market job timers
let autoRefresh = { home_jobs: false, dark_jobs: false };
// Track if auto-refresh retry is pending
let autoRefreshRetry = { home_jobs: null, dark_jobs: null };
// Track last known timer values for zero-detection
let lastTimerSeconds = { home_jobs: null, dark_jobs: null };

async function loadPinnedState() {
    const data = await chrome.storage.sync.get(['pinnedTimers', 'autoRefresh']);
    if (data.pinnedTimers) pinnedTimers = data.pinnedTimers;
    if (data.autoRefresh) autoRefresh = data.autoRefresh;
    updatePinButtons();
    renderPinnedTimers();
}

async function savePinnedState() {
    await chrome.storage.sync.set({ pinnedTimers, autoRefresh });
}

function updatePinButtons() {
    pinDailyBtn.classList.toggle('pinned', !!pinnedTimers.daily);
    pinCoreMarketBtn.classList.toggle('pinned', !!pinnedTimers.home_jobs);
    pinDarkMarketBtn.classList.toggle('pinned', !!pinnedTimers.dark_jobs);
}

function renderPinnedTimers() {
    // Check if any timer is pinned (including expedition timers)
    let anyPinned = pinnedTimers.daily || pinnedTimers.home_jobs || pinnedTimers.dark_jobs;
    if (!anyPinned) {
        for (const key of Object.keys(pinnedTimers)) {
            if (key.startsWith('exp_') && pinnedTimers[key]) { anyPinned = true; break; }
        }
    }
    pinnedTimersSection.style.display = anyPinned ? '' : 'none';
    pinnedTimersContainer.innerHTML = '';

    if (pinnedTimers.daily) {
        const row = document.createElement('div');
        row.className = 'pinned-timer-row';
        row.innerHTML = `
            <span class="pinned-timer-label">📅 Daily Ops</span>
            <span class="pinned-timer-value" id="pinnedDailyValue">--:--:--</span>
        `;
        pinnedTimersContainer.appendChild(row);
    }
    if (pinnedTimers.home_jobs) {
        const name = coreMarketName || 'Market-1';
        const row = document.createElement('div');
        row.className = 'pinned-timer-row';
        row.innerHTML = `
            <span class="pinned-timer-label">🏠 ${name} Jobs</span>
            <span class="pinned-timer-value" id="pinnedCoreJobsValue">--:--:--</span>
            <label class="pinned-auto-refresh" title="Auto-refresh jobs when timer hits 0">
                <input type="checkbox" id="autoRefreshCore" ${autoRefresh.home_jobs ? 'checked' : ''}> Auto
            </label>
        `;
        pinnedTimersContainer.appendChild(row);
        row.querySelector('#autoRefreshCore').addEventListener('change', async (e) => {
            autoRefresh.home_jobs = e.target.checked;
            await savePinnedState();
            sendAutoRefreshToContent();
        });
    }
    if (pinnedTimers.dark_jobs) {
        const name = darkMarketName || 'Market-2';
        const row = document.createElement('div');
        row.className = 'pinned-timer-row';
        row.innerHTML = `
            <span class="pinned-timer-label">🌑 ${name} Jobs</span>
            <span class="pinned-timer-value" id="pinnedDarkJobsValue">--:--:--</span>
            <label class="pinned-auto-refresh" title="Auto-refresh jobs when timer hits 0">
                <input type="checkbox" id="autoRefreshDark" ${autoRefresh.dark_jobs ? 'checked' : ''}> Auto
            </label>
        `;
        pinnedTimersContainer.appendChild(row);
        row.querySelector('#autoRefreshDark').addEventListener('change', async (e) => {
            autoRefresh.dark_jobs = e.target.checked;
            await savePinnedState();
            sendAutoRefreshToContent();
        });
    }

    // Expedition pinned timers
    for (const key of Object.keys(pinnedTimers)) {
        if (!key.startsWith('exp_') || !pinnedTimers[key]) continue;
        const expId = key.substring(4);
        const endTime = expeditionEndTimes[expId];
        // Try to get expedition name from stored data
        let expLabel = 'Expedition';
        // We'll resolve the name asynchronously, but for now use cached data
        const row = document.createElement('div');
        row.className = 'pinned-timer-row';
        row.innerHTML = `
            <span class="pinned-timer-label">🎯 <span class="pinned-exp-label" data-exp-id="${expId}">${expLabel}</span></span>
            <span class="pinned-timer-value pinned-exp-timer" data-exp-id="${expId}">${endTime ? formatTimeRemaining(endTime) : '--:--:--'}</span>
        `;
        pinnedTimersContainer.appendChild(row);
    }

    // Resolve expedition names from storage and clean up stale pins
    chrome.storage.local.get('expeditionsData', async (result) => {
        const exps = result.expeditionsData || [];
        const activeExpIds = new Set(exps.map(e => e.id));
        let staleRemoved = false;

        // Remove pins for expeditions that no longer exist
        for (const key of Object.keys(pinnedTimers)) {
            if (key.startsWith('exp_') && pinnedTimers[key]) {
                const expId = key.substring(4);
                if (!activeExpIds.has(expId)) {
                    delete pinnedTimers[key];
                    delete expeditionEndTimes[expId];
                    staleRemoved = true;
                }
            }
        }

        if (staleRemoved) {
            await savePinnedState();
            renderPinnedTimers();
            return; // re-render will re-enter this block with clean state
        }

        for (const exp of exps) {
            if (exp.endTime) expeditionEndTimes[exp.id] = exp.endTime;
            const labelEl = pinnedTimersContainer.querySelector(`.pinned-exp-label[data-exp-id="${exp.id}"]`);
            if (labelEl) {
                labelEl.textContent = `${exp.locationName || 'Expedition'} — ${exp.zoneName || ''}`;
            }
        }
    });
}

function updatePinnedTimerValues() {
    const pinnedDaily = document.getElementById('pinnedDailyValue');
    if (pinnedDaily) {
        if (!dailyNextTaskTime) {
            pinnedDaily.textContent = '--:--:--';
        } else {
            const diff = dailyNextTaskTime - Date.now();
            if (diff <= 0) {
                pinnedDaily.textContent = '0h:0m:0s';
            } else {
                const totalSec = Math.floor(diff / 1000);
                const h = Math.floor(totalSec / 3600);
                const m = Math.floor((totalSec % 3600) / 60);
                const s = totalSec % 60;
                pinnedDaily.textContent = `${h}h:${m}m:${s}s`;
            }
        }
    }
    const pinnedCore = document.getElementById('pinnedCoreJobsValue');
    if (pinnedCore) {
        pinnedCore.textContent = coreNextJobsResetAt ? formatTimeRemaining(coreNextJobsResetAt) : '--:--:--';
    }
    const pinnedDark = document.getElementById('pinnedDarkJobsValue');
    if (pinnedDark) {
        pinnedDark.textContent = bmiNextJobsResetAt ? formatTimeRemaining(bmiNextJobsResetAt) : '--:--:--';
    }
    // Expedition pinned timers
    document.querySelectorAll('.pinned-exp-timer').forEach(el => {
        const expId = el.dataset.expId;
        const endTime = expeditionEndTimes[expId];
        el.textContent = endTime ? formatTimeRemaining(endTime) : '--:--:--';
    });
}

pinDailyBtn.addEventListener('click', async () => {
    pinnedTimers.daily = !pinnedTimers.daily;
    await savePinnedState();
    updatePinButtons();
    renderPinnedTimers();
});
pinCoreMarketBtn.addEventListener('click', async () => {
    pinnedTimers.home_jobs = !pinnedTimers.home_jobs;
    await savePinnedState();
    updatePinButtons();
    renderPinnedTimers();
});
pinDarkMarketBtn.addEventListener('click', async () => {
    pinnedTimers.dark_jobs = !pinnedTimers.dark_jobs;
    await savePinnedState();
    updatePinButtons();
    renderPinnedTimers();
});

loadPinnedState();

// --- Auto-Refresh Logic ---
// Send auto-refresh settings to the content script so it can run even when popup is closed
async function sendAutoRefreshToContent() {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "updateAutoRefresh",
            autoRefresh: autoRefresh
        }).catch(() => {});
    }
}

// On popup open, sync auto-refresh settings to content script
chrome.storage.sync.get('autoRefresh', (data) => {
    if (data.autoRefresh) autoRefresh = data.autoRefresh;
    sendAutoRefreshToContent();
});

// Auto-refresh check in popup: when pinned market timer hits 0, trigger refresh
function checkAutoRefreshFromPopup() {
    if (autoRefresh.home_jobs && coreNextJobsResetAt) {
        const sec = getRemainingSeconds(coreNextJobsResetAt);
        if (sec !== null && sec <= 0) {
            triggerAutoRefreshForMarket('home');
        }
    }
    if (autoRefresh.dark_jobs && bmiNextJobsResetAt) {
        const sec = getRemainingSeconds(bmiNextJobsResetAt);
        if (sec !== null && sec <= 0) {
            triggerAutoRefreshForMarket('dark');
        }
    }
}

function triggerAutoRefreshForMarket(which) {
    const retryKey = which === 'home' ? 'home_jobs' : 'dark_jobs';
    // Prevent multiple concurrent retries
    if (autoRefreshRetry[retryKey]) return;

    autoRefreshRetry[retryKey] = true;

    // First attempt: refresh immediately
    doMarketRefreshAction(which);

    // Then after 10s, check if timer is still 0 and retry if needed
    setTimeout(() => {
        autoRefreshRetry[retryKey] = false;
        const resetAt = which === 'home' ? coreNextJobsResetAt : bmiNextJobsResetAt;
        const sec = getRemainingSeconds(resetAt);
        if (sec !== null && sec <= 0) {
            // Timer is still 0 — retry
            triggerAutoRefreshForMarket(which);
        }
    }, 10000);
}

async function doMarketRefreshAction(which) {
    try {
        const tab = await getCor3Tab();
        if (!tab) return;
        if (which === 'home') {
            await chrome.tabs.sendMessage(tab.id, { action: "refreshMarket" });
            setTimeout(() => loadMarket(), 4000);
        } else {
            await chrome.tabs.sendMessage(tab.id, { action: "refreshDarkMarket" });
            setTimeout(() => loadDarkMarket(), 4000);
        }
    } catch (e) { /* not reachable */ }
}

// Update market timers + daily timer + pinned timers + expedition timers periodically
setInterval(() => {
    // Daily timer
    updateDailyTimer();

    // Market timers inside market containers
    if (coreNextJobsResetAt) {
        const homeResetEl = marketContainer.querySelector('.home-reset-timer');
        if (homeResetEl) {
            homeResetEl.textContent = `⏳ Jobs Reset: ${formatTimeRemaining(coreNextJobsResetAt)}`;
        }
    }
    if (bmiNextJobsResetAt) {
        const darkResetEl = darkMarketContainer.querySelector('.dark-reset-timer');
        if (darkResetEl) {
            darkResetEl.textContent = `⏳ Jobs Reset: ${formatTimeRemaining(bmiNextJobsResetAt)}`;
        }
    }

    // Expedition timers inside expedition info cards
    document.querySelectorAll('.exp-timer').forEach(el => {
        const expId = el.dataset.expId;
        const endTime = expeditionEndTimes[expId];
        if (endTime) el.textContent = formatTimeRemaining(endTime);
    });

    // Pinned timer values
    updatePinnedTimerValues();

    // Auto-refresh check
    checkAutoRefreshFromPopup();
}, 1000);

// Refresh "last updated" labels every 30s
setInterval(() => refreshAllTimestamps(), 30000);

// --- Auto Decrypt Hacking ---
const autoDecryptToggle = document.getElementById('autoDecryptToggle');
const decryptStatus = document.getElementById('decryptStatus');

function updateDecryptStatusLabel(enabled) {
    decryptStatus.textContent = enabled ? 'Active' : 'Off';
    decryptStatus.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

// Load saved state on popup open
chrome.storage.sync.get('autoDecryptEnabled', (data) => {
    const enabled = !!data.autoDecryptEnabled;
    autoDecryptToggle.checked = enabled;
    updateDecryptStatusLabel(enabled);
});

autoDecryptToggle.addEventListener('change', async () => {
    const enabled = autoDecryptToggle.checked;
    await chrome.storage.sync.set({ autoDecryptEnabled: enabled });
    updateDecryptStatusLabel(enabled);

    // Send toggle message to content script
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "toggleDecryptSolver",
            enabled: enabled
        }).catch(() => {});
    }
});

// --- Check for Updates ---
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const updateResult = document.getElementById('updateResult');

checkUpdateBtn.addEventListener('click', async () => {
    updateResult.textContent = 'Checking...';
    updateResult.style.color = 'var(--text-dim)';
    try {
        const localManifest = chrome.runtime.getManifest();
        const localVersion = localManifest.version;
        const resp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/manifest.json', { cache: 'no-store' });
        if (!resp.ok) throw new Error('Failed to fetch remote manifest');
        const remoteManifest = await resp.json();
        const remoteVersion = remoteManifest.version;

        if (remoteVersion !== localVersion) {
            updateResult.innerHTML = `Update available! <b>v${localVersion}</b> → <b>v${remoteVersion}</b><br><a href="https://github.com/Femtoce11/cor3-helper" target="_blank" style="color:var(--accent-cyan);">Download from GitHub</a><br><span style="font-size:9px;color:var(--text-muted);">Download ZIP, extract, and reload on chrome://extensions</span>`;
            updateResult.style.color = 'var(--accent-orange)';
        } else {
            updateResult.textContent = `You're up to date! (v${localVersion})`;
            updateResult.style.color = 'var(--accent-green)';
        }
    } catch (e) {
        updateResult.textContent = 'Could not check for updates. Check your connection.';
        updateResult.style.color = 'var(--accent-red)';
    }
});
