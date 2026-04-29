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
    daily: 'Daily Ops',
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
const decisionLastUpdated = document.getElementById('decisionLastUpdated');
const inventoryLastUpdated = document.getElementById('inventoryLastUpdated');
const archivedExpLastUpdated = document.getElementById('archivedExpLastUpdated');
const mercenariesLastUpdated = document.getElementById('mercenariesLastUpdated');

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
    showLastUpdated(decisionLastUpdated, 'expeditionsDataUpdatedAt');
    if (inventoryLastUpdated) showLastUpdated(inventoryLastUpdated, 'stashDataUpdatedAt');
    if (archivedExpLastUpdated) showLastUpdated(archivedExpLastUpdated, 'archivedExpeditionsUpdatedAt');
    if (mercenariesLastUpdated) showLastUpdated(mercenariesLastUpdated, 'mercenariesUpdatedAt');
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

    // Check for expedition launch errors
    chrome.storage.local.get('expeditionLaunchError', (result) => {
        if (result.expeditionLaunchError) {
            const error = result.expeditionLaunchError;
            const now = Date.now();
            const retryAfter = error.retryAfter || 120000;
            const timeUntilRetry = Math.max(0, retryAfter - (now - error.timestamp));

            if (timeUntilRetry > 0) {
                const retryMinutes = Math.ceil(timeUntilRetry / 60000);
                const errorHtml = `
                    <div class="warning-banner" style="background:rgba(255,165,0,0.15);border-color:var(--accent-orange);color:var(--accent-orange);">
                        <div style="font-weight:bold;margin-bottom:4px;">⚠️ Expedition Launch Failed</div>
                        <div style="font-size:10px;">${error.error}</div>
                        <div style="font-size:10px;margin-top:4px;">Retrying in ${retryMinutes} minute${retryMinutes !== 1 ? 's' : ''}...</div>
                    </div>
                `;
                expeditionInfoContainer.innerHTML = errorHtml;
            } else {
                // Clear expired error
                chrome.storage.local.remove('expeditionLaunchError');
            }
        }
    });

    if (!expeditions || expeditions.length === 0) {
        if (!expeditionInfoContainer.innerHTML) {
            expeditionInfoContainer.innerHTML = '<div class="no-decisions">No active expeditions.</div>';
        }
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

// Get modifier values (defaults: loot=3, risk=-2)
let modifiersEnabled = true;
let savedLootMod = 3;
let savedRiskMod = -2;

function getLootModifier() {
    return modifiersEnabled ? savedLootMod : 1;
}
function getRiskModifier() {
    return modifiersEnabled ? savedRiskMod : -1;
}
function calcOptionScore(opt, expeditionRiskScore) {
    const lootMod = getLootModifier();
    const riskMod = getRiskModifier();
    return Math.round((opt.lootModifier * lootMod) + ((opt.riskModifier * riskMod) * (((expeditionRiskScore + Math.abs(opt.riskModifier)) / 10) || 1))) ;
}
function updateModifierDisplayValues() {
    const lootDisp = document.getElementById('modLootDisplay');
    const riskDisp = document.getElementById('modRiskDisplay');
    const defaultsNote = document.getElementById('modDefaultsNote');
    if (lootDisp) lootDisp.textContent = savedLootMod;
    if (riskDisp) riskDisp.textContent = savedRiskMod;
    if (defaultsNote) defaultsNote.style.display = (savedLootMod === 3 && savedRiskMod === -2) ? '' : 'none';
}

function renderDecisions(decisions) {
    decisionsContainer.innerHTML = '';
    const countEl = document.getElementById('decisionsCount');

    if (!decisions || decisions.length === 0) {
        decisionsContainer.innerHTML = '<div class="no-decisions">No pending decisions found.</div>';
        if (countEl) countEl.textContent = '';
        return;
    }

    const pending = decisions.filter(d => !d.isResolved);
    if (countEl) countEl.textContent = pending.length > 0 ? `(${pending.length} pending)` : '';

    let baseRisk = decisions[0].riskScore;
    for (const d of decisions) {
        const card = document.createElement('div');
        card.className = 'decision-card';

        let statusTag;
        if (d.isResolved && d.isAutoResolved) {
            statusTag = '<span class="auto-resolved-tag">AUTO-RESOLVED</span>';
        } else if (d.isResolved) {
            statusTag = '<span class="resolved-tag">RESOLVED</span>';
        } else {
            statusTag = '<span class="pending-tag">PENDING</span>';
        }

        let deadlineHtml = '';
        const isExpired = d.decisionDeadline && new Date(d.decisionDeadline) <= new Date();
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

        const autoChooseOn = autoChooseCheckbox && autoChooseCheckbox.checked;
        const canClick = !d.isResolved && !isExpired && !autoChooseOn;
        let optionsHtml = '';
        if (Array.isArray(d.decisionOptions)) {
            // Find default option (first option is typically the default)
            const defaultOptId = d.decisionOptions.length > 0 ? d.decisionOptions[0].id : null;

            // For resolved decisions, the selected option's risk is already baked into
            // d.riskScore. Subtract it to recover the base risk at decision time.
            if (d.isResolved && d.selectedOption) {
                const selectedOpt = d.decisionOptions.find(o => o.id === d.selectedOption);
                if (selectedOpt) {
                    baseRisk -= selectedOpt.riskModifier;
                }
            }

            for (const opt of d.decisionOptions) {
                const isSelected = d.selectedOption === opt.id;
                const isDefault = (d.isAutoResolved && d.selectedOption === opt.id);
                const selectedClass = isSelected ? ' option-selected' : '';
                const clickClass = canClick ? ' clickable' : '';
                const riskSign = opt.riskModifier > 0 ? '+' : '';
                const lootSign = opt.lootModifier > 0 ? '+' : '';
                const score = calcOptionScore(opt, d.isResolved ? baseRisk : d.riskScore);
                const scoreHtml = `<span class="option-score">Score: ${score >= 0 ? '+' : ''}${score}</span>`;
                const selectedLabel = isSelected ? (isDefault ? " (⏳Expired⏳)" : ' ✓') : '';
                optionsHtml += `
                    <div class="option-row${selectedClass}${clickClass}" data-opt-id="${opt.id}" data-exp-id="${d.expeditionId}" data-msg-id="${d.messageId}">
                        <span class="option-label">${opt.label}${selectedLabel}</span>
                        <span class="option-stats">
                            ${scoreHtml}
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

    // Wire up clickable option rows
    decisionsContainer.querySelectorAll('.option-row.clickable').forEach(el => {
        el.addEventListener('click', async () => {
            const optId = el.dataset.optId;
            const expId = el.dataset.expId;
            const msgId = el.dataset.msgId;
            if (!optId || !expId || !msgId) return;
            el.style.opacity = '0.5';
            try {
                const tab = await getCor3Tab();
                if (tab) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'respondDecision',
                        expeditionId: expId,
                        messageId: msgId,
                        selectedOption: optId
                    });
                    // Refresh expedition data after a short delay
                    setTimeout(() => requestExpeditions(), 2000);
                }
            } catch (e) { /* not reachable */ }
        });
    });
}

// Auto-choose logic — track decisions we already auto-chose to avoid re-sending
const autoChosenDecisions = new Set();
var counter = 0;
async function checkAutoChoose(decisions) {
    const autoChoose = document.getElementById('autoChooseCheckbox');
    if (!autoChoose || !autoChoose.checked) return;
    if (!decisions || decisions.length === 0) return;

    for (const d of decisions) {
        if (d.isResolved || !d.decisionDeadline || !Array.isArray(d.decisionOptions)) continue;
        if (autoChosenDecisions.has(d.messageId)) continue; // already sent
        const dl = new Date(d.decisionDeadline);
        const remaining = dl - Date.now();
        chrome.storage.local.set({ popupConsoleLog: "remaining time for decision -> " + remaining + " Counter: " + counter });
        if (remaining <= 0) continue; // expired
        if (remaining > 60000) continue; // wait until < 1 minute remaining

        // Pick highest score
        let bestOpt = null;
        let bestScore = -Infinity;
        for (const opt of d.decisionOptions) {
            const score = calcOptionScore(opt, d.riskScore);
            if (score > bestScore) {
                bestScore = score;
                bestOpt = opt;
            }
        }
        if (bestOpt) {
            autoChosenDecisions.add(d.messageId);
            try {
                const tab = await getCor3Tab();
                if (tab) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'respondDecision',
                        expeditionId: d.expeditionId,
                        messageId: d.messageId,
                        selectedOption: bestOpt.id
                    });
                    console.log(`[COR3 Helper] Auto-chose "${bestOpt.label}" (score: ${bestScore})`);
                    // Confirm by refreshing expedition data after a delay
                    setTimeout(() => requestExpeditions(), 3000);
                }
            } catch (e) { /* silent */ }
        }
    }
}

async function loadExpeditions() {
    const { expeditionsData, expeditionDecisions } = await chrome.storage.local.get(['expeditionsData', 'expeditionDecisions']);
    renderExpeditionInfo(expeditionsData || []);
    renderDecisions(expeditionDecisions || []);
    updateExpeditionAlarmOptions(expeditionsData || []);
    refreshAllTimestamps();
    // check auto-choose
    checkAutoChoose(expeditionDecisions || []);

    // Refresh expedition error display every 30 seconds
    setInterval(() => {
        chrome.storage.local.get('expeditionLaunchError', (result) => {
            if (result.expeditionLaunchError) {
                const error = result.expeditionLaunchError;
                const now = Date.now();
                const retryAfter = error.retryAfter || 120000;
                const timeUntilRetry = Math.max(0, retryAfter - (now - error.timestamp));

                if (timeUntilRetry <= 0) {
                    // Clear expired error and refresh display
                    chrome.storage.local.remove('expeditionLaunchError');
                    loadExpeditions();
                }
            }
        });
    }, 30000);
}

// --- Modifier edit/save/cancel/toggle ---
const lootModInput = document.getElementById('lootModifier');
const riskModInput = document.getElementById('riskModifier');
const autoChooseCheckbox = document.getElementById('autoChooseCheckbox');
const editModifiersBtn = document.getElementById('editModifiersBtn');
const saveModifiersBtn = document.getElementById('saveModifiersBtn');
const cancelModifiersBtn = document.getElementById('cancelModifiersBtn');
const modifierEditRow = document.getElementById('modifierEditRow');
const modifierDisplay = document.getElementById('modifierDisplay');
const modifiersEnabledToggle = document.getElementById('modifiersEnabledToggle');

function reRenderDecisions() {
    chrome.storage.local.get('expeditionDecisions', (result) => {
        renderDecisions(result.expeditionDecisions || []);
    });
}

editModifiersBtn.addEventListener('click', () => {
    lootModInput.value = savedLootMod;
    riskModInput.value = savedRiskMod;
    modifierEditRow.style.display = '';
    modifierDisplay.style.display = 'none';
});

saveModifiersBtn.addEventListener('click', () => {
    savedLootMod = parseInt(lootModInput.value) || 3;
    savedRiskMod = parseInt(riskModInput.value) || -2;
    modifierEditRow.style.display = 'none';
    modifierDisplay.style.display = '';
    updateModifierDisplayValues();
    chrome.storage.sync.set({
        decisionModifiers: {
            loot: savedLootMod,
            risk: savedRiskMod,
            enabled: modifiersEnabled,
            autoChoose: autoChooseCheckbox.checked
        }
    });
    reRenderDecisions();
});

cancelModifiersBtn.addEventListener('click', () => {
    modifierEditRow.style.display = 'none';
    modifierDisplay.style.display = '';
});

modifiersEnabledToggle.addEventListener('change', () => {
    modifiersEnabled = modifiersEnabledToggle.checked;
    chrome.storage.sync.set({
        decisionModifiers: {
            loot: savedLootMod,
            risk: savedRiskMod,
            enabled: modifiersEnabled,
            autoChoose: autoChooseCheckbox.checked
        }
    });
    reRenderDecisions();
});

autoChooseCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({
        decisionModifiers: {
            loot: savedLootMod,
            risk: savedRiskMod,
            enabled: modifiersEnabled,
            autoChoose: autoChooseCheckbox.checked
        }
    });
    // Re-render decisions to update clickability and run auto-choose
    reRenderDecisions();
    if (autoChooseCheckbox.checked) {
        chrome.storage.local.get('expeditionDecisions', (result) => {
            checkAutoChoose(result.expeditionDecisions || []);
        });
    }
});

// Load saved modifier settings
chrome.storage.sync.get('decisionModifiers', (data) => {
    if (data.decisionModifiers) {
        savedLootMod = data.decisionModifiers.loot ?? 3;
        savedRiskMod = data.decisionModifiers.risk ?? -2;
        modifiersEnabled = data.decisionModifiers.enabled !== false;
        autoChooseCheckbox.checked = !!data.decisionModifiers.autoChoose;
    }
    modifiersEnabledToggle.checked = modifiersEnabled;
    updateModifierDisplayValues();
});

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
const refreshInventoryBtn = document.getElementById('refreshInventoryBtn');

inventorySectionToggle.addEventListener('click', async () => {
    inventorySectionToggle.classList.toggle('open');
    inventorySectionBody.classList.toggle('open');
});

refreshInventoryBtn.addEventListener('click', () => requestAndLoadInventory());

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

// Load cached inventory on popup open
loadInventory();

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

    // Sort items: rarest first, then most expensive first within same rarity
    const RARITY_ORDER = { legendary: 0, quest: 1, epic: 2, rare: 3, common: 4 };
    const sortedItems = [...data.items].sort((a, b) => {
        const ra = RARITY_ORDER[(a.tier || 'common').toLowerCase()] ?? 5;
        const rb = RARITY_ORDER[(b.tier || 'common').toLowerCase()] ?? 5;
        if (ra !== rb) return ra - rb;
        const pa = (a.canSell && a.sellPrice) ? a.sellPrice : 0;
        const pb = (b.canSell && b.sellPrice) ? b.sellPrice : 0;
        return pb - pa;
    });

    for (const item of sortedItems) {
        const card = document.createElement('div');
        const tierClass = 'tier-' + (item.tier || 'common').toLowerCase();
        card.className = 'item-card ' + tierClass;

        const tierTagClass = 'tier-tag tier-tag-' + (item.tier || 'common').toLowerCase();

        let badgesHtml = `<span class="${tierTagClass}">${item.tier || 'COMMON'}</span>`;
        if (item.canCraft) badgesHtml += '<span class="badge badge-craft">CRAFT</span>';
        if (item.canUse) badgesHtml += '<span class="badge badge-use">USE</span>';

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
const dailyStatusLine = document.getElementById('dailyStatusLine');
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

// Calculate streak bonus from rewards API data
function calcStreakBonus(streak, rewardsData) {
    if (!rewardsData || !Array.isArray(rewardsData) || streak === undefined || streak === null) return '--';
    // Rewards array contains day entries with amount; find the entry matching current streak day
    const dayEntry = rewardsData.find(r => r.day === streak);
    if (dayEntry && dayEntry.amount !== undefined) return (dayEntry.amount / 100).toFixed(2);
    // Fallback: try closest lower day
    const sorted = rewardsData.filter(r => r.day <= streak).sort((a, b) => b.day - a.day);
    if (sorted.length > 0 && sorted[0].amount !== undefined) return (sorted[0].amount / 100).toFixed(2);
    return '--';
}

// Shared helper to display daily ops info
async function displayDailyOpsData(data) {
    if (!data) return;
    dailyNextTaskTime = data.nextTaskTime ? new Date(data.nextTaskTime).getTime() : null;
    dailyClaimed.textContent = data.hasClaimedToday ? 'Yes' : 'No';
    dailyStreak.textContent = data.currentStreak ?? '--';
    dailyDifficulty.textContent = data.difficulty ?? '--';
    // Use rewards API for streak bonus if available
    const { dailyRewardsData } = await chrome.storage.local.get('dailyRewardsData');
    const bonus = calcStreakBonus(data.currentStreak, dailyRewardsData);
    dailyStreakBonus.textContent = bonus;
    updateDailyTimer();
}

async function fetchDailyOps() {
""    // Show loading state in status line (don't overwrite timer)
    dailyStatusLine.style.display = '';
    dailyStatusLine.innerHTML = '<span style="color:var(--accent-cyan);">⏳ Refreshing daily ops...</span>';

    try {
        const tab = await getCor3Tab();
        if (!tab) {
            dailyStatusLine.style.display = '';
            dailyStatusLine.innerHTML = '<span style="color:var(--accent-red);">⚠️ No cor3.gg tab found</span>';
            return;
        }

        console.log('[COR3 Helper] Sending fetchDailyOps message to content script');
        const response = await chrome.tabs.sendMessage(tab.id, { action: "fetchDailyOps" });

        if (response && response.error && (response.error === 'token_expired' || response.error.includes('Invalid access token'))) {
            dailyStatusLine.style.display = '';
            dailyStatusLine.innerHTML = '<span style="color:var(--accent-red);">⚠️ Access token expired. Page refresh required.</span>';
            return;
        }

        if (response && response.data) {
            console.log('[COR3 Helper] Daily ops data received:', response.data);
            await displayDailyOpsData(response.data);
            dailyStatusLine.style.display = 'none';
            refreshAllTimestamps();
        } else if (response === undefined) {
            // Content script didn't respond - likely not loaded
            console.log('[COR3 Helper] No response from content script, trying cached data');
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) {
                await displayDailyOpsData(dailyOpsData);
                dailyStatusLine.style.display = '';
                dailyStatusLine.innerHTML = '<span style="color:var(--accent-orange);">⚠️ Using cached data (content script not responding)</span>';
            } else {
                dailyStatusLine.style.display = '';
                dailyStatusLine.innerHTML = '<span style="color:var(--accent-red);">⚠️ No data available. Refresh the page.</span>';
            }
        } else {
            // Response was empty or null
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) await displayDailyOpsData(dailyOpsData);
        }
    } catch (e) {
        console.error('[COR3 Helper] Daily ops fetch error:', e);
        cor3LogError('popup.js', e, { action: 'fetchDailyOps' });
        try {
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) {
                await displayDailyOpsData(dailyOpsData);
                dailyStatusLine.style.display = '';
                dailyStatusLine.innerHTML = '<span style="color:var(--accent-orange);">⚠️ Using cached data (error occurred)</span>';
            } else {
                dailyStatusLine.style.display = '';
                dailyStatusLine.innerHTML = '<span style="color:var(--accent-red);">⚠️ Failed to load daily ops</span>';
            }
        } catch (e2) {
            dailyStatusLine.style.display = '';
            dailyStatusLine.innerHTML = '<span style="color:var(--accent-red);">⚠️ Failed to load daily ops</span>';
        }
    }
}

// Load cached daily ops on popup open (no WS request)
async function loadCachedDailyOps() {
    try {
        const { dailyOpsData, dailyOpsError } = await chrome.storage.local.get(['dailyOpsData', 'dailyOpsError']);
        if (dailyOpsError === 'token_expired') {
            dailyStatusLine.style.display = '';
            dailyStatusLine.innerHTML = '<span style="color:var(--accent-red);">⚠️ Access token expired. Page refresh required.</span>';
        }
        if (dailyOpsData) await displayDailyOpsData(dailyOpsData);
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

    const jobCount = md.jobs ? md.jobs.length : 0;
    const availableJobs = md.jobs ? md.jobs.filter(j => !j.isCompleted && !j.isExpired).length : 0;

    // Next jobs reset timer
    if (md.nextJobsResetAt) {
        html += `<div class="${idPrefix}-reset-timer" style="font-size:11px;color:var(--accent-orange);margin-bottom:8px;">⏳ Jobs Reset: ${formatTimeRemaining(md.nextJobsResetAt)}</div>`;
    } else if (jobCount > 0) {
        html += `<div style="font-size:11px;color:var(--accent-orange);margin-bottom:8px;">Jobs: ${availableJobs}/${jobCount}</div>`;
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
                if (det.manufacturer) html += `<div class="detail-row"><span class="label">Manufacturer:</span> ${det.manufacturer}</div>`;
                if (det.tier) html += `<div class="detail-row"><span class="label">Tier:</span> ${det.tier}</div>`;
                if (det.itemVulnerability !== undefined) html += `<div class="detail-row"><span class="label">Vulnerability:</span> ${det.itemVulnerability}%</div>`;
                if (det.price) html += `<div class="detail-row"><span class="label">Base Price:</span> 💰 ${det.price.toLocaleString()}</div>`;
                if (lot.priceModifier) html += `<div class="detail-row"><span class="label">Price Modifier:</span> ${lot.priceModifier > 0 ? '+' : ''}${lot.priceModifier}</div>`;
                if (lot.accessLevel) html += `<div class="detail-row"><span class="label">Access Level:</span> ${lot.accessLevel}</div>`;
                // Specs data
                if (det.specs && typeof det.specs === 'object') {
                    // Handle specs that is an array of software objects
                    if (Array.isArray(det.specs)) {
                        for (const spec of det.specs) {
                            if (spec && typeof spec === 'object') {
                                if (spec.type) html += `<div class="detail-row"><span class="label">Type:</span> ${spec.type}</div>`;
                                if (spec.power && Array.isArray(spec.power)) html += `<div class="detail-row"><span class="label">Power:</span> ${spec.power[0]} – ${spec.power[1]}</div>`;
                                if (spec.fileTypes && Array.isArray(spec.fileTypes)) html += `<div class="detail-row"><span class="label">File Types:</span> ${spec.fileTypes.join(', ')}</div>`;
                                if (spec.serverTypes && Array.isArray(spec.serverTypes)) html += `<div class="detail-row"><span class="label">Server Types:</span> ${spec.serverTypes.join(', ')}</div>`;
                                if (spec.remote !== undefined) html += `<div class="detail-row"><span class="label">Remote:</span> ${spec.remote ? 'Yes' : 'No'}</div>`;
                            }
                        }
                    } else {
                        for (const [specKey, specVal] of Object.entries(det.specs)) {
                            const label = specKey.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                            let displayVal;
                            if (Array.isArray(specVal)) {
                                displayVal = specVal.join(', ');
                            } else if (specVal !== null && typeof specVal === 'object') {
                                displayVal = JSON.stringify(specVal);
                            } else {
                                displayVal = specVal;
                            }
                            html += `<div class="detail-row"><span class="label">${label}:</span> ${displayVal}</div>`;
                        }
                    }
                }
                if (det.description) html += `<div class="detail-row" style="color:var(--text-dim);font-style:italic;margin-top:2px;">${det.description}</div>`;
                html += `</div>`;

                html += `</div></div>`;
            }
        }
    } else {
        html += '<div class="no-decisions">No items in market.</div>';
    }
    html += `</div>`;

    // Jobs List (expandable) - 3 columns: Category, Server, Reward — sorted by server
    html += `<div class="expandable-header" id="${idPrefix}JobsToggle"><span class="expand-arrow">▶</span><span class="expand-label">Jobs List (${availableJobs}/${jobCount})</span></div>`;
    html += `<div class="expandable-body" id="${idPrefix}JobsBody">`;
    if (md.jobs && md.jobs.length > 0) {
        // Sort jobs by server name
        const sortedJobs = [...md.jobs].sort((a, b) => {
            const sA = (a.relatedServers && a.relatedServers[0] ? a.relatedServers[0].serverName : '') || '';
            const sB = (b.relatedServers && b.relatedServers[0] ? b.relatedServers[0].serverName : '') || '';
            return sA.localeCompare(sB);
        });
        html += `<table style="width:100%;font-size:10px;border-collapse:collapse;margin-bottom:4px;">`;
        html += `<tr style="color:var(--text-dim);border-bottom:1px solid var(--border);"><th style="text-align:left;padding:3px 4px;">Job</th><th style="text-align:left;padding:3px 4px;">Server</th><th style="text-align:right;padding:3px 4px;">Reward</th></tr>`;
        for (const job of sortedJobs) {
            const jobStatus = job.isCompleted ? '✅' : job.isExpired ? '❌' : '🔹';
            const dimStyle = (job.isCompleted || job.isExpired) ? 'opacity:0.5;' : '';
            const jobName = job.name || job.id || 'Unknown';
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'N/A';
            let rewardStr = '--';
            if (job.rewardCredits) {
                rewardStr = `💰 ${job.rewardCredits.toLocaleString()}`;
            }
            if (job.rewardReputation) {
                rewardStr += ` · ⭐ ${job.rewardReputation}`;
            }
            html += `<tr style="${dimStyle}border-bottom:1px solid var(--border);">`;
            html += `<td style="padding:3px 4px;color:var(--text-secondary);">${jobStatus} ${jobName}</td>`;
            html += `<td style="padding:3px 4px;color:var(--text-muted);">${serverName}</td>`;
            html += `<td style="padding:3px 4px;text-align:right;color:var(--accent-green);">${rewardStr}</td>`;
            html += `</tr>`;
        }
        html += `</table>`;
    } else {
        html += '<div class="no-decisions">No jobs available.</div>';
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
        // Show warning but keep cached data visible below
        let warningHtml = '<div class="warning-banner">⚠️ D4RK market server is currently unreachable (no-path-to-server).</div>';
        if (data && data.market) {
            // Render cached data below the warning
            if (data.nextJobsResetAt) bmiNextJobsResetAt = data.nextJobsResetAt;
            if (data.market.marketName) {
                darkMarketName = data.market.marketName;
                updateMarketLabel(darkMarketLabel, darkMarketName, 'Market-2', '🌑');
            }
            renderMarketInto(darkMarketContainer, data, 'Market-2 (cached)', 'dark');
            darkMarketContainer.insertAdjacentHTML('afterbegin', warningHtml);
        } else {
            darkMarketContainer.innerHTML = warningHtml + '<div class="no-decisions">No cached market data available.</div>';
        }
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
let refreshQueue = [];
let isProcessingQueue = false;

// Human-like delay helper
function humanDelay(min = 400, max = 900) {
    return new Promise(r => setTimeout(r, min + Math.floor(Math.random() * (max - min))));
}

// Wait for a storage key to appear (polling), with timeout
function waitForStorageKey(key, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(key);
            if (data[key]) { clearInterval(poll); if (!done) { done = true; resolve(true); } }
        }, 400);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(false); } }, timeoutMs);
    });
}

// Individual refresh helpers that return promises resolving when done
async function refreshMarket1Only() {
    marketContainer.innerHTML = '<div class="no-decisions">Refreshing Market-1...</div>';
    await chrome.storage.local.remove('marketData');
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "refreshMarket" });
    } catch (e) {}
    await waitForStorageKey('marketData', 8000);
    await loadMarket();
    refreshAllTimestamps();
}

async function setDarkMarketEndpoint() {
    // Set endpoint is part of requestDarkMarket, but we split: first just set the endpoint
    // The content-early.js __cor3RequestDarkMarket sets endpoint then sends get.options after 1.5s
    // We trigger the full dark market request and wait
    darkMarketContainer.innerHTML = '<div class="no-decisions">Setting Market-2 endpoint...</div>';
}

async function refreshMarket2Only() {
    darkMarketContainer.innerHTML = '<div class="no-decisions">Refreshing Market-2...</div>';
    await chrome.storage.local.remove(['darkMarketData', 'darkMarketAvailable']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "refreshDarkMarket" });
    } catch (e) {}
    await waitForStorageKey('darkMarketData', 10000);
    await loadDarkMarket();
    refreshAllTimestamps();
}

async function refreshExpeditionsOnly() {
    expeditionInfoContainer.innerHTML = '<div class="no-decisions">Loading expedition data...</div>';
    await chrome.storage.local.remove(['expeditionsData', 'expeditionDecisions']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
    } catch (e) {}
    await waitForStorageKey('expeditionsData', 8000);
    await loadExpeditions();
    refreshAllTimestamps();
    resetExpeditionUpdateTimer();
}

async function refreshInventoryOnly() {
    inventoryContainer.innerHTML = '<div class="no-decisions">Requesting inventory...</div>';
    spaceInfo.textContent = '-- / --';
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestStash" });
    } catch (e) {}
    await waitForStorageKey('stashData', 5000);
    await loadInventory();
    refreshAllTimestamps();
}

async function refreshArchivedOnly() {
    archivedExpContainer.innerHTML = '<div class="no-decisions">Loading archived expeditions...</div>';
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestArchivedExpeditions" });
    } catch (e) {}
    await waitForStorageKey('archivedExpeditionsData', 5000);
    await loadArchivedExpeditions();
    refreshAllTimestamps();
}

async function refreshMercenariesOnly() {
    mercenariesContainer.innerHTML = '<div class="no-decisions">Loading mercenaries...</div>';
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestMercenaries" });
    } catch (e) {}
    await waitForStorageKey('mercenariesData', 5000);
    await loadMercenaries();
    refreshAllTimestamps();
}

refreshAllBtn.addEventListener('click', async () => {
    if (isRefreshing) return;
    isRefreshing = true;
    refreshAllBtn.classList.add('spinning');

    try {
        // 1. Daily ops
        await executeRefreshStep('dailyOps', fetchDailyOps);
        await humanDelay();

        // 2. Market-1
        await executeRefreshStep('market1', refreshMarket1Only);
        await humanDelay();

        // 3. Set endpoint for Market-2
        await executeRefreshStep('setDarkEndpoint', setDarkMarketEndpoint);
        await humanDelay();

        // 4. Market-2
        await executeRefreshStep('market2', refreshMarket2Only);
        await humanDelay();

        // 5. Expeditions
        await executeRefreshStep('expeditions', refreshExpeditionsOnly);
        await humanDelay();

        // 6. Decisions (already updated with expedition data from step 5)
        // Decisions are loaded as part of loadExpeditions, just ensure they are re-rendered
        await executeRefreshStep('decisions', async () => {
            const { expeditionDecisions } = await chrome.storage.local.get('expeditionDecisions');
            renderDecisions(expeditionDecisions || []);
        });
        await humanDelay();

        // 7. Inventory
        await executeRefreshStep('inventory', refreshInventoryOnly);
        await humanDelay();

        // 8. Archived Expeditions
        await executeRefreshStep('archived', refreshArchivedOnly);
        await humanDelay();

        // 9. Mercenary data
        await executeRefreshStep('mercenaries', refreshMercenariesOnly);

    } catch (e) {
        console.error('[COR3 Helper] Refresh All error:', e);
        cor3LogError('popup.js', e, { action: 'refreshAll' });
    }

    refreshAllBtn.classList.remove('spinning');
    isRefreshing = false;
    refreshAllTimestamps();
});

async function executeRefreshStep(name, operation) {
    try {
        console.log(`[COR3 Helper] Refresh All: Starting ${name}`);
        await operation();
        console.log(`[COR3 Helper] Refresh All: Completed ${name}`);
    } catch (error) {
        console.error(`[COR3 Helper] Refresh All: Failed ${name}:`, error);
    }
}

function resetExpeditionUpdateTimer() {
    // Reset the 30-second expedition data pull timer
    const now = Date.now();
    chrome.storage.local.set({ expeditionsDataUpdatedAt: now });
    console.log('[COR3 Helper] Expedition update timer reset');
}

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

// Expedition polling is now handled by background.js (works even when popup is closed)

// --- Real-time auto-update: listen for storage changes from WS data arriving ---
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.expeditionsData) {
        loadExpeditions();
        refreshAllTimestamps();
    }
    if (changes.stashData) {
        loadInventory();
        refreshAllTimestamps();
    }
    if (changes.archivedExpeditionsData) {
        loadArchivedExpeditions();
    }
    if (changes.mercenariesData || changes.mercConfigData) {
        loadMercenaries();
    }
});

// Listen for autoSendMerc changes from content script (e.g. stash full disabling auto-send)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.autoSendMerc && changes.autoSendMerc.newValue) {
        const settings = changes.autoSendMerc.newValue;
        updateMercStashWarning(settings);
        // Sync toggle state if content script disabled auto-send
        if (autoSendMercenaryToggle) {
            autoSendMercenaryToggle.checked = !!settings.enabled;
        }
    }
});

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

// --- Auto Daily Hacking ---
const autoDailyHackToggle = document.getElementById('autoDailyHackToggle');
const dailyHackStatus = document.getElementById('dailyHackStatus');
const dailyHackLogEl = document.getElementById('dailyHackLog');

function updateDailyHackStatusLabel(enabled) {
    dailyHackStatus.textContent = enabled ? 'Active' : 'Off';
    dailyHackStatus.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

// Load saved state and show persisted daily hack log
chrome.storage.sync.get('autoDailyHackEnabled', (data) => {
    const enabled = !!data.autoDailyHackEnabled;
    autoDailyHackToggle.checked = enabled;
    updateDailyHackStatusLabel(enabled);
});
// Always show the last daily hack result from storage until a new hack updates it
chrome.storage.local.get(['dailyHackLog', 'dailyHackLogUpdatedAt'], (data) => {
    if (data.dailyHackLog && dailyHackLogEl && autoDailyHackToggle.checked) {
        dailyHackLogEl.textContent = data.dailyHackLog;
        dailyHackLogEl.style.display = '';
    }
});

autoDailyHackToggle.addEventListener('change', async () => {
    const enabled = autoDailyHackToggle.checked;
    await chrome.storage.sync.set({ autoDailyHackEnabled: enabled });
    updateDailyHackStatusLabel(enabled);

    // Don't clear the log when toggling — keep showing old result until new hack

    // Send toggle to content script
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "toggleDailyHackSolver",
            enabled: enabled
        }).catch(() => {});
    }
});

// Listen for daily hack log updates (Signal Hack console output)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.dailyHackLog) {
        const msg = changes.dailyHackLog.newValue;
        if (msg && dailyHackLogEl && autoDailyHackToggle.checked) {
            dailyHackLogEl.textContent = msg;
            dailyHackLogEl.style.display = '';
        }
    }
});

// Version Info ---
async function displayVersionInfo(retryCount) {
    retryCount = retryCount || 0;
    const versionSection = document.getElementById('versionInfoSection');
    if (!versionSection) return;
    const extVersion = chrome.runtime.getManifest().version;
    const { webVersion, systemVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion']);

    // Fallback: try to get versions from content script globals if storage fails
    let finalWebVersion = webVersion;
    let finalSystemVersion = systemVersion;

    if (!webVersion || !systemVersion) {
        try {
            const tab = await getCor3Tab();
            if (tab) {
                const response = await chrome.tabs.sendMessage(tab.id, { action: "getVersionFallbacks" });
                if (response) {
                    if (!finalWebVersion && response.webVersion) {
                        finalWebVersion = response.webVersion;
                        chrome.storage.local.set({ webVersion: response.webVersion });
                    }
                    if (!finalSystemVersion && response.systemVersion) {
                        finalSystemVersion = response.systemVersion;
                        chrome.storage.local.set({ systemVersion: response.systemVersion });
                    }
                }
            }
        } catch (e) {
            console.log('[COR3 Helper] Could not get version fallbacks:', e);
        }
    }

    let parts = [`Extension: v${extVersion}`];
    if (finalWebVersion) parts.push(`Web: ${finalWebVersion}`);
    if (finalSystemVersion) parts.push(`System: ${finalSystemVersion}`);
    versionSection.innerHTML = parts.join(' · ');
    versionSection.style.display = 'block';

    // Retry a few times if versions are missing (data may arrive after popup opens)
    if ((!finalWebVersion || !finalSystemVersion) && retryCount < 5) {
        setTimeout(() => displayVersionInfo(retryCount + 1), 2000);
    }
}
displayVersionInfo(0);

// Helper function to compare version strings (e.g., "1.17.0" < "1.17.5")
// Handles suffixes like "v1.17.23-spin" — a suffix (e.g. "-spin") means a higher
// version than the same numeric part without a suffix.
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;

    // Strip leading "v" and split numeric part from suffix
    const parse = (v) => {
        const stripped = String(v).replace(/^v/, '');
        const match = stripped.match(/^([\d.]+)(.*)$/);
        if (!match) return { parts: [0], suffix: stripped };
        return {
            parts: match[1].split('.').map(n => parseInt(n) || 0),
            suffix: match[2] || '' // e.g. "-spin", "" if none
        };
    };

    const a = parse(v1);
    const b = parse(v2);

    const maxLength = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < maxLength; i++) {
        const num1 = a.parts[i] || 0;
        const num2 = b.parts[i] || 0;
        if (num1 < num2) return -1;
        if (num1 > num2) return 1;
    }

    // Numeric parts are equal — a suffix means higher than no suffix
    const hasSuffix1 = a.suffix.length > 0;
    const hasSuffix2 = b.suffix.length > 0;
    if (!hasSuffix1 && hasSuffix2) return -1; // v1 < v2
    if (hasSuffix1 && !hasSuffix2) return 1;  // v1 > v2
    if (hasSuffix1 && hasSuffix2) return a.suffix.localeCompare(b.suffix);

    return 0;
}

// Auto-check GitHub for web/system version differences on popup load
async function autoCheckWebsiteUpdated() {
    const webVersionNotice = document.getElementById('webVersionNotice');
    const webVersionData = document.getElementById('webVersionData');
    const systemVersionNotice = document.getElementById('systemVersionNotice');
    const systemVersionData = document.getElementById('systemVersionData');
    if (!webVersionNotice || !webVersionData || !systemVersionNotice || !systemVersionData) return;
    try {
        const resp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/versions.json', { cache: 'no-store' });
        if (!resp.ok) return;
        const remote = await resp.json();
        const { webVersion, systemVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion']);

        // Check web version - only warn if local is less than remote
        if (webVersion && remote.web) {
            const comparison = compareVersions(webVersion, remote.web);
            if (comparison > 0) {
                webVersionNotice.innerHTML = '⚠️ Website is recently updated';
                webVersionNotice.style.display = 'block';
                webVersionData.innerHTML = "Old version -> " + remote.web;
                webVersionData.style.display = 'block';
            }
        }

        // Check system version - only warn if local is less than remote
        if (systemVersion && remote.system) {
            const comparison = compareVersions(systemVersion, remote.system);
            if (comparison < 0) {
                systemVersionNotice.innerHTML = '⚠️ You are lagging behind in progress!';
                systemVersionNotice.style.display = 'block';
                webVersionData.innerHTML = "Aim for " + remote.system + " system version!";
                webVersionData.style.display = 'block';
            }
        }
    } catch (e) { /* silent */ }
}
autoCheckWebsiteUpdated();

// Auto-update version display when web/system version arrives
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.webVersion || changes.systemVersion) {
        displayVersionInfo();
        autoCheckWebsiteUpdated();
    }
});

// Archived Expeditions ---
const archivedExpSectionToggle = document.getElementById('archivedExpSectionToggle');
const archivedExpSectionBody = document.getElementById('archivedExpSectionBody');
const archivedExpContainer = document.getElementById('archivedExpContainer');
const refreshArchivedBtn = document.getElementById('refreshArchivedBtn');

archivedExpSectionToggle.addEventListener('click', () => {
    archivedExpSectionToggle.classList.toggle('open');
    archivedExpSectionBody.classList.toggle('open');
});

async function requestArchivedExpeditions() {
    archivedExpContainer.innerHTML = '<div class="no-decisions">Loading archived expeditions...</div>';
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestArchivedExpeditions" });
    } catch (e) { /* not reachable */ }
    setTimeout(() => loadArchivedExpeditions(), 3000);
}

if (refreshArchivedBtn) {
    refreshArchivedBtn.addEventListener('click', () => requestArchivedExpeditions());
}

async function loadArchivedExpeditions() {
    const { archivedExpeditionsData } = await chrome.storage.local.get('archivedExpeditionsData');
    renderArchivedExpeditions(archivedExpeditionsData);
    refreshAllTimestamps();
}

function renderArchivedExpeditions(data) {
    if (!archivedExpContainer) return;
    archivedExpContainer.innerHTML = '';

    // Handle both array and object with items array
    let items = data;
    if (data && !Array.isArray(data) && data.items) items = data.items;
    if (data && !Array.isArray(data) && data.data) items = data.data;

    if (!items || !Array.isArray(items) || items.length === 0) {
        archivedExpContainer.innerHTML = '<div class="no-decisions">No archived expeditions found.</div>';
        return;
    }
    for (const exp of items) {
        const card = document.createElement('div');
        card.className = 'archived-exp-card';

        const mercName = exp.mercenary ? exp.mercenary.callsign : 'Unknown';
        const outcome = (exp.outcome || exp.status || 'COMPLETED').toUpperCase();
        let outcomeClass = 'outcome-full';
        if (outcome.includes('PARTIAL')) outcomeClass = 'outcome-partial';
        else if (outcome.includes('FAIL')) outcomeClass = 'outcome-fail';
        else if (outcome.includes('DEATH')) outcomeClass = 'outcome-death';

        let html = `<div class="archived-exp-header">`;
        html += `<span class="archived-exp-merc">🧑 ${mercName}</span>`;
        html += `<span class="outcome-tag ${outcomeClass}">${outcome}</span>`;
        html += `</div>`;
        html += `<div class="archived-exp-info">`;
        html += `📍 ${exp.locationName || '--'} / ${exp.zoneName || '--'}`;
        if (exp.objectiveName) html += ` — ${exp.objectiveName}`;
        html += `<br>`;
        if (exp.totalCost !== undefined) html += `💰 Cost: ${exp.totalCost.toLocaleString()} · `;
        if (exp.riskScore !== undefined) html += `⚠️ Risk: ${exp.riskScore}`;
        html += `</div>`;

        // Container items with images — containerData can be flat array or object with .items
        const rawContainer = exp.containerData || exp.container;
        const containerItems = Array.isArray(rawContainer) ? rawContainer
            : (rawContainer && Array.isArray(rawContainer.items) ? rawContainer.items : null);
        if (containerItems && containerItems.length > 0) {
            const uid = 'archived_' + exp.id;
            html += `<div class="container-items">`;
            html += `<div class="expandable-header" data-expand="${uid}"><span class="expand-arrow">▶</span><span class="expand-label">Loot (${containerItems.length} items)</span></div>`;
            html += `<div class="expandable-body" id="${uid}">`;
            for (const ci of containerItems) {
                const det = ci.item || ci;
                const imgSrc = det.imageUrl || det.image || '';
                const imgTag = imgSrc ? `<img src="${imgSrc}" style="width:24px;height:24px;border-radius:4px;vertical-align:middle;margin-right:4px;" loading="lazy">` : '';
                const tierTag = det.tier ? ` <span class="tier-tag tier-tag-${det.tier.toLowerCase()}">${det.tier}</span>` : '';
                let statusTag = '';
                if (det.isCollected) statusTag = ' <span style="color:var(--accent-green);font-size:9px;">✓ Collected</span>';
                else if (det.isDeleted) statusTag = ' <span style="color:var(--accent-red);font-size:9px;">✗ Deleted</span>';
                html += `<div style="font-size:10px;margin:2px 0;">${imgTag}${det.name || det.id || '?'}${tierTag}${statusTag}</div>`;
            }
            html += `</div></div>`;
        }

        card.innerHTML = html;
        archivedExpContainer.appendChild(card);
    }
    // Wire expandable toggles
    archivedExpContainer.querySelectorAll('.expandable-header').forEach(hdr => {
        hdr.addEventListener('click', () => {
            hdr.classList.toggle('open');
            const targetId = hdr.getAttribute('data-expand');
            const body = document.getElementById(targetId);
            if (body) body.classList.toggle('open');
        });
    });
}

// Auto-load archived expeditions from cache on popup open
loadArchivedExpeditions();

// --- Mercenaries ---
const mercenariesSectionToggle = document.getElementById('mercenariesSectionToggle');
const mercenariesSectionBody = document.getElementById('mercenariesSectionBody');
const mercenariesContainer = document.getElementById('mercenariesContainer');
const refreshMercenariesBtn = document.getElementById('refreshMercenariesBtn');
const autoSendMercenaryToggle = document.getElementById('autoSendMercenaryToggle');
const autoChooseMercToggle = document.getElementById('autoChooseMercToggle');
const mercenaryConfigRow = document.getElementById('mercenaryConfigRow');
const selectedMercenaryName = document.getElementById('selectedMercenaryName');
const mercStashWarning = document.getElementById('mercStashWarning');

let selectedMercenaryId = null;
let mercRestTimers = {};

function updateMercStashWarning(settings) {
    if (!mercStashWarning) return;
    if (settings && settings.disabledReason === 'stash_full' && !settings.enabled) {
        mercStashWarning.style.display = '';
    } else {
        mercStashWarning.style.display = 'none';
    }
}

mercenariesSectionToggle.addEventListener('click', () => {
    mercenariesSectionToggle.classList.toggle('open');
    mercenariesSectionBody.classList.toggle('open');
});

async function requestMercenaries() {
    mercenariesContainer.innerHTML = '<div class="no-decisions">Loading mercenaries...</div>';
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestMercenaries" });
    } catch (e) { /* not reachable */ }
    setTimeout(() => loadMercenaries(), 3000);
}

if (refreshMercenariesBtn) {
    refreshMercenariesBtn.addEventListener('click', () => requestMercenaries());
}

// Load/save auto-send settings
chrome.storage.sync.get('autoSendMerc', (data) => {
    if (data.autoSendMerc) {
        autoSendMercenaryToggle.checked = !!data.autoSendMerc.enabled;
        if (autoChooseMercToggle) autoChooseMercToggle.checked = !!data.autoSendMerc.autoChooseMerc;
        selectedMercenaryId = data.autoSendMerc.mercenaryId || null;
        if (selectedMercenaryId && mercenaryConfigRow) {
            mercenaryConfigRow.style.display = '';
            if (selectedMercenaryName) selectedMercenaryName.textContent = data.autoSendMerc.mercenaryName || selectedMercenaryId;
        }
        updateMercStashWarning(data.autoSendMerc);
    }
});

function saveAutoSendMercSettings() {
    // Read existing settings first to preserve disabledReason
    chrome.storage.sync.get('autoSendMerc', (data) => {
        const existing = data.autoSendMerc || {};
        const isEnabling = autoSendMercenaryToggle.checked;
        chrome.storage.sync.set({
            autoSendMerc: {
                enabled: isEnabling,
                autoChooseMerc: autoChooseMercToggle ? autoChooseMercToggle.checked : false,
                mercenaryId: selectedMercenaryId,
                mercenaryName: selectedMercenaryName ? selectedMercenaryName.textContent : '',
                // Clear disabledReason only when user re-enables; otherwise preserve it
                disabledReason: isEnabling ? null : (existing.disabledReason || null)
            }
        });
    });
}

autoSendMercenaryToggle.addEventListener('change', () => {
    saveAutoSendMercSettings();
    // If user re-enables, clear stash warning
    if (autoSendMercenaryToggle.checked) {
        updateMercStashWarning(null); // hide warning
    }
});

if (autoChooseMercToggle) {
    autoChooseMercToggle.addEventListener('change', () => {
        saveAutoSendMercSettings();
        // Re-render mercenaries to update clickability
        loadMercenaries();
    });
}

async function loadMercenaries() {
    const { mercenariesData, mercConfigData } = await chrome.storage.local.get(['mercenariesData', 'mercConfigData']);
    // Attach expedition config data to each mercenary if available
    if (mercenariesData && mercConfigData) {
        let mercs = mercenariesData;
        if (mercs && !Array.isArray(mercs) && mercs.mercenaries) mercs = mercs.mercenaries;
        if (mercs && !Array.isArray(mercs) && mercs.data) mercs = mercs.data;
        if (Array.isArray(mercs)) {
            for (const merc of mercs) {
                if (mercConfigData[merc.id]) {
                    merc._expeditionConfig = mercConfigData[merc.id];
                }
            }
        }
    }
    renderMercenaries(mercenariesData);
    refreshAllTimestamps();
}

function renderMercenaries(data) {
    if (!mercenariesContainer) return;
    mercenariesContainer.innerHTML = '';

    let mercs = data;
    if (data && !Array.isArray(data) && data.mercenaries) mercs = data.mercenaries;
    if (data && !Array.isArray(data) && data.data) mercs = data.data;

    if (!mercs || !Array.isArray(mercs) || mercs.length === 0) {
        mercenariesContainer.innerHTML = '<div class="no-decisions">No mercenaries found.</div>';
        return;
    }

    // Auto-choose: select cheapest AVAILABLE mercenary (least risk on tie)
    if (autoChooseMercToggle && autoChooseMercToggle.checked) {
        const available = mercs.filter(m => m.status === 'AVAILABLE' && m._expeditionConfig);
        if (available.length > 0) {
            available.sort((a, b) => {
                const costA = (a._expeditionConfig && a._expeditionConfig.totalCost) || Infinity;
                const costB = (b._expeditionConfig && b._expeditionConfig.totalCost) || Infinity;
                if (costA !== costB) return costA - costB;
                const riskA = (a._expeditionConfig && a._expeditionConfig.riskScore) || 0;
                const riskB = (b._expeditionConfig && b._expeditionConfig.riskScore) || 0;
                return riskA - riskB;
            });
            selectedMercenaryId = available[0].id;
            if (selectedMercenaryName) selectedMercenaryName.textContent = available[0].callsign || available[0].name || available[0].id;
            if (mercenaryConfigRow) mercenaryConfigRow.style.display = '';
            saveAutoSendMercSettings();
        }
    }

    for (const merc of mercs) {
        const card = document.createElement('div');
        card.className = 'merc-card' + (selectedMercenaryId === merc.id ? ' selected' : '');
        card.dataset.mercId = merc.id;

        const status = (merc.status || 'AVAILABLE').toUpperCase();
        let statusClass = 'available';
        if (status === 'RESTING') statusClass = 'resting';
        else if (status === 'CONTRACTED') statusClass = 'contracted';

        let restTimer = '';
        if (status === 'RESTING' && merc.restUntil) {
            const restEnd = new Date(merc.restUntil).getTime();
            const now = Date.now();
            const diff = restEnd - now;
            if (diff > 0) {
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                restTimer = `<span class="merc-rest-timer">⏳ ${h}h ${m}m</span>`;
                mercRestTimers[merc.id] = merc.restUntil;
            }
        }

        const specName = merc.specializationName || merc.specialization || '--';
        const specDesc = merc.specializationDescription || '';
        const traitName = merc.traitName || merc.trait || '--';
        const traitDesc = merc.traitDescription || '';

        let html = `<div class="merc-details">`;
        html += `<div class="merc-name">${merc.callsign || merc.name || 'Unknown'}</div>`;
        html += `<div style="margin-bottom:4px;"><span class="merc-status ${statusClass}">${status}</span>${restTimer}</div>`;
        html += `<div class="merc-info">`;
        html += `Rank: ${merc.rank || '--'} · Missions: ${merc.missionsCompleted ?? '--'}<br>`;
        html += `Spec: <b>${specName}</b>`;
        if (specDesc) html += ` <span style="color:var(--text-dim);font-size:9px;">— ${specDesc}</span>`;
        html += `<br>Trait: <b>${traitName}</b>`;
        if (traitDesc) html += ` <span style="color:var(--text-dim);font-size:9px;">— ${traitDesc}</span>`;
        if (merc.reputationRequirement) html += `<br>Rep Required: ${merc.reputationRequirement}`;
        // Extended expedition config info (from configure call)
        const cfg = merc._expeditionConfig;
        if (cfg) {
            html += `<br><span style="color:var(--accent-orange);">Cost: 💰 ${(cfg.totalCost || 0).toLocaleString()}</span>`;
            html += ` · <span style="color:var(--accent-cyan);">Risk: ${cfg.riskScore ?? '--'}</span>`;
            if (cfg.outcomeChances) {
                html += `<br>Failed-Survive: ${cfg.outcomeChances.failureSurviveChance ?? '--'}%`;
                html += ` · Death: ${cfg.outcomeChances.deathChance ?? '--'}%`;
            }
        }
        html += `</div></div>`;

        card.innerHTML = html;

        // Click to select mercenary for auto-send (disabled when auto-choose merc is on)
        card.addEventListener('click', () => {
            if (autoChooseMercToggle && autoChooseMercToggle.checked) return;
            selectedMercenaryId = merc.id;
            if (selectedMercenaryName) selectedMercenaryName.textContent = merc.callsign || merc.name || merc.id;
            if (mercenaryConfigRow) mercenaryConfigRow.style.display = '';
            // Update visual selection
            mercenariesContainer.querySelectorAll('.merc-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            // Save
            saveAutoSendMercSettings();
        });

        mercenariesContainer.appendChild(card);
    }
}

// Auto-load mercenaries from cache on popup open; if empty, fetch fresh
(async () => {
    const { mercenariesData } = await chrome.storage.local.get('mercenariesData');
    if (mercenariesData) {
        loadMercenaries();
    } else {
        // No cached data — request fresh mercenary data
        requestMercenaries();
    }
})();

// Update mercenary rest timers every second
setInterval(() => {
    for (const [mercId, restUntil] of Object.entries(mercRestTimers)) {
        const diff = new Date(restUntil).getTime() - Date.now();
        const el = mercenariesContainer.querySelector(`.merc-card[data-merc-id="${mercId}"] .merc-rest-timer`);
        if (el) {
            if (diff > 0) {
                const h = Math.floor(diff / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                el.textContent = `⏳ ${h}h ${m}m`;
            } else {
                el.textContent = 'Ready!';
                el.style.color = 'var(--accent-green)';
                delete mercRestTimers[mercId];
            }
        }
    }
}, 1000);

// --- Check for Updates ---
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const updateResult = document.getElementById('updateResult');

checkUpdateBtn.addEventListener('click', async () => {
    updateResult.textContent = 'Checking...';
    updateResult.style.color = 'var(--text-dim)';
    try {
        const localManifest = chrome.runtime.getManifest();
        const localExtVersion = localManifest.version;

        // Fetch remote versions.json for web/system version comparisons
        const versionsResp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/versions.json', { cache: 'no-store' });
        if (!versionsResp.ok) throw new Error('Failed to fetch remote versions');
        const remote = await versionsResp.json();

        // Fetch remote manifest.json for extension version comparison
        let remoteExtVersion = null;
        try {
            const manifestResp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/manifest.json', { cache: 'no-store' });
            if (manifestResp.ok) {
                const remoteManifest = await manifestResp.json();
                remoteExtVersion = remoteManifest.version || null;
            }
        } catch (e) { /* silent — extension update check will be skipped */ }

        const { webVersion, systemVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion']);

        let messages = [];
        let extBehind = false;

        // Compare extension version — only report if local is behind remote
        if (remoteExtVersion && compareVersions(localExtVersion, remoteExtVersion) < 0) {
            messages.push(`Extension: <b>v${localExtVersion}</b> → <b>v${remoteExtVersion}</b>`);
            extBehind = true;
        }

        if (messages.length > 0) {
            let html = `Updates detected:<br>${messages.join('<br>')}`;
            // Only show install instructions if extension is behind
            if (extBehind) {
                html += `<br><a href="https://github.com/Femtoce11/cor3-helper" target="_blank" style="color:var(--accent-cyan);">Download from GitHub</a><br><span style="font-size:9px;color:var(--text-muted);">Download ZIP, extract, and reload on chrome://extensions</span>`;
            }
            updateResult.innerHTML = html;
            updateResult.style.color = 'var(--accent-orange)';
        } else {
            const localWeb = webVersion || null;
            const localSys = systemVersion || null;
            updateResult.textContent = `You're up to date!`;
            updateResult.style.color = 'var(--accent-green)';
        }
    } catch (e) {
        console.error('[COR3 Helper] Check for updates error:', e);
        cor3LogError('popup.js', e, { action: 'checkForUpdates' });
        updateResult.textContent = 'Could not check for updates. Check your connection.';
        updateResult.style.color = 'var(--accent-red)';
    }
});

// --- System Message Notifications Toggle ---
const disableSystemMessagesToggle = document.getElementById('disableSystemMessagesToggle');
const systemMessageStatus = document.getElementById('systemMessageStatus');

// --- Background Elements Toggle ---
const disableBackgroundToggle = document.getElementById('disableBackgroundToggle');
const backgroundStatus = document.getElementById('backgroundStatus');

// --- Network Fog Toggle ---
const disableNetworkFogToggle = document.getElementById('disableNetworkFogToggle');
const networkFogStatus = document.getElementById('networkFogStatus');

function updateNetworkFogStatus() {
    if (!disableNetworkFogToggle || !networkFogStatus) return;
    const isEnabled = disableNetworkFogToggle.checked;
    networkFogStatus.textContent = isEnabled ? 'Active' : 'Off';
    networkFogStatus.style.color = isEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

// Load saved settings
chrome.storage.sync.get(['disableSystemMessages', 'disableBackground', 'disableNetworkFog'], (result) => {
    if (disableSystemMessagesToggle) {
        disableSystemMessagesToggle.checked = result.disableSystemMessages || false;
        updateSystemMessageStatus();
    }
    if (disableBackgroundToggle) {
        disableBackgroundToggle.checked = result.disableBackground || false;
        updateBackgroundStatus();
    }
    if (disableNetworkFogToggle) {
        disableNetworkFogToggle.checked = result.disableNetworkFog || false;
        updateNetworkFogStatus();
    }
});

// Handle system message toggle changes
if (disableSystemMessagesToggle) {
    disableSystemMessagesToggle.addEventListener('change', async () => {
        const isEnabled = disableSystemMessagesToggle.checked;

        // Save setting
        chrome.storage.sync.set({ disableSystemMessages: isEnabled });

        // Update status
        updateSystemMessageStatus();

        // Apply change immediately
        if (isEnabled) {
            // Disable system messages
            try {
                const tab = await getCor3Tab();
                if (tab) {
                    await chrome.tabs.sendMessage(tab.id, { action: "disableSystemMessages" });
                    console.log('[COR3 Helper] System messages disabled');
                }
            } catch (e) {
                console.error('[COR3 Helper] Failed to disable system messages:', e);
                cor3LogError('popup.js', e, { action: 'disableSystemMessages' });
            }
        } else {
            // Re-enable system messages - may require page restart
            systemMessageStatus.textContent = 'System messages re-enabled. Page restart may be required.';
            systemMessageStatus.style.color = 'var(--accent-orange)';

            try {
                const tab = await getCor3Tab();
                if (tab) {
                    await chrome.tabs.sendMessage(tab.id, { action: "enableSystemMessages" });
                    console.log('[COR3 Helper] System messages re-enabled');
                }
            } catch (e) {
                console.error('[COR3 Helper] Failed to re-enable system messages:', e);
                cor3LogError('popup.js', e, { action: 'enableSystemMessages' });
                systemMessageStatus.textContent = 'System messages re-enabled. Page restart required to apply changes.';
                systemMessageStatus.style.color = 'var(--accent-orange)';
            }
        }
    });
}

// Handle background toggle changes
if (disableBackgroundToggle) {
    disableBackgroundToggle.addEventListener('change', async () => {
        const isEnabled = disableBackgroundToggle.checked;

        // Save setting
        chrome.storage.sync.set({ disableBackground: isEnabled });

        // Update status
        updateBackgroundStatus();

        // Apply change immediately
        try {
            const tab = await getCor3Tab();
            if (tab) {
                if (isEnabled) {
                    // Delete background elements immediately when enabled
                    await chrome.tabs.sendMessage(tab.id, { action: "disableBackground" });
                    console.log('[COR3 Helper] Background elements deleted immediately');
                } else {
                    // Just clear the setting for disable - elements will be restored on reload
                    await chrome.tabs.sendMessage(tab.id, { action: "enableBackground" });
                    console.log('[COR3 Helper] Background elements will be restored on reload');
                }
            }
        } catch (e) {
            console.error('[COR3 Helper] Failed to toggle background elements:', e);
            cor3LogError('popup.js', e, { action: 'toggleBackground' });
        }
    });
}

function updateSystemMessageStatus() {
    if (!disableSystemMessagesToggle || !systemMessageStatus) return;

    const isEnabled = disableSystemMessagesToggle.checked;
    systemMessageStatus.textContent = isEnabled ? 'Active' : 'Off';
    systemMessageStatus.style.color = isEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

function updateBackgroundStatus() {
    if (!disableBackgroundToggle || !backgroundStatus) return;

    const isEnabled = disableBackgroundToggle.checked;
    backgroundStatus.textContent = isEnabled ? 'Active' : 'Off';
    backgroundStatus.style.color = isEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

// Handle network fog toggle changes
if (disableNetworkFogToggle) {
    disableNetworkFogToggle.addEventListener('change', async () => {
        const isEnabled = disableNetworkFogToggle.checked;
        chrome.storage.sync.set({ disableNetworkFog: isEnabled });
        updateNetworkFogStatus();
        try {
            const tab = await getCor3Tab();
            if (tab) {
                if (isEnabled) {
                    await chrome.tabs.sendMessage(tab.id, { action: "disableNetworkFog" });
                } else {
                    await chrome.tabs.sendMessage(tab.id, { action: "enableNetworkFog" });
                }
            }
        } catch (e) {
            console.error('[COR3 Helper] Failed to toggle network fog:', e);
            cor3LogError('popup.js', e, { action: 'toggleNetworkFog' });
        }
    });
}

// Initialize status on load
updateSystemMessageStatus();
updateBackgroundStatus();
updateNetworkFogStatus();
