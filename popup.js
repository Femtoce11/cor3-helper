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
    dark_jobs: 'Market-2 Jobs Reset',
    soyuz_jobs: 'Market-3 Jobs Reset'
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
const soyuzMarketLastUpdated = document.getElementById('soyuzMarketLastUpdated');
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
    showLastUpdated(soyuzMarketLastUpdated, 'soyuzMarketDataUpdatedAt');
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

            if (error.noRetry) {
                // Permanent error — no retry, user must re-enable
                const errorHtml = `
                    <div class="warning-banner" style="background:rgba(255,80,80,0.15);border-color:var(--accent-red);color:var(--accent-red);">
                        <div style="font-weight:bold;margin-bottom:4px;">❌ Expedition Error</div>
                        <div style="font-size:10px;">${error.error}</div>
                        <div style="font-size:10px;margin-top:4px;">Re-enable auto-send mercenary to retry.</div>
                    </div>
                `;
                expeditionInfoContainer.innerHTML = errorHtml;
            } else {
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

        const canClick = !d.isResolved && !isExpired;
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

    // Wire up clickable option rows with two-click confirm pattern
    let activeConfirmEl = null;
    let confirmTimeout = null;
    decisionsContainer.querySelectorAll('.option-row.clickable').forEach(el => {
        el.addEventListener('click', async () => {
            const optId = el.dataset.optId;
            const expId = el.dataset.expId;
            const msgId = el.dataset.msgId;
            if (!optId || !expId || !msgId) return;

            // First click: show confirm state
            if (!el.classList.contains('confirming')) {
                // Clear any other active confirm
                if (activeConfirmEl && activeConfirmEl !== el) {
                    activeConfirmEl.classList.remove('confirming');
                }
                if (confirmTimeout) clearTimeout(confirmTimeout);
                el.classList.add('confirming');
                activeConfirmEl = el;
                // Auto-reset after 3 seconds
                confirmTimeout = setTimeout(() => {
                    el.classList.remove('confirming');
                    activeConfirmEl = null;
                }, 3000);
                return;
            }

            // Second click: execute
            if (confirmTimeout) clearTimeout(confirmTimeout);
            el.classList.remove('confirming');
            activeConfirmEl = null;
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
        const noWaitCb = document.getElementById('noWaitAutoChooseCheckbox');
        const noWait = noWaitCb && noWaitCb.checked;
        if (!noWait && remaining > 60000) continue; // wait until < 1 minute remaining

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
const noWaitAutoChooseCheckbox = document.getElementById('noWaitAutoChooseCheckbox');
const noWaitRow = document.getElementById('noWaitRow');
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
            autoChoose: autoChooseCheckbox.checked,
            noWaitAutoChoose: noWaitAutoChooseCheckbox ? noWaitAutoChooseCheckbox.checked : false
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
            autoChoose: autoChooseCheckbox.checked,
            noWaitAutoChoose: noWaitAutoChooseCheckbox ? noWaitAutoChooseCheckbox.checked : false
        }
    });
    reRenderDecisions();
});

autoChooseCheckbox.addEventListener('change', () => {
    // Show/hide noWait row
    if (noWaitRow) noWaitRow.style.display = autoChooseCheckbox.checked ? '' : 'none';
    chrome.storage.sync.set({
        decisionModifiers: {
            loot: savedLootMod,
            risk: savedRiskMod,
            enabled: modifiersEnabled,
            autoChoose: autoChooseCheckbox.checked,
            noWaitAutoChoose: noWaitAutoChooseCheckbox ? noWaitAutoChooseCheckbox.checked : false
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

if (noWaitAutoChooseCheckbox) {
    noWaitAutoChooseCheckbox.addEventListener('change', () => {
        chrome.storage.sync.set({
            decisionModifiers: {
                loot: savedLootMod,
                risk: savedRiskMod,
                enabled: modifiersEnabled,
                autoChoose: autoChooseCheckbox.checked,
                noWaitAutoChoose: noWaitAutoChooseCheckbox.checked
            }
        });
        // Re-run auto-choose immediately if enabled
        if (autoChooseCheckbox.checked && noWaitAutoChooseCheckbox.checked) {
            chrome.storage.local.get('expeditionDecisions', (result) => {
                checkAutoChoose(result.expeditionDecisions || []);
            });
        }
    });
}

// Load saved modifier settings
chrome.storage.sync.get('decisionModifiers', (data) => {
    if (data.decisionModifiers) {
        savedLootMod = data.decisionModifiers.loot ?? 3;
        savedRiskMod = data.decisionModifiers.risk ?? -2;
        modifiersEnabled = data.decisionModifiers.enabled !== false;
        autoChooseCheckbox.checked = !!data.decisionModifiers.autoChoose;
        if (noWaitAutoChooseCheckbox) noWaitAutoChooseCheckbox.checked = !!data.decisionModifiers.noWaitAutoChoose;
        if (noWaitRow) noWaitRow.style.display = autoChooseCheckbox.checked ? '' : 'none';
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
    setTimeout(() => {
        loadInventory();
        refreshAllTimestamps();
    }, 2500);
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
            ? `<div class="item-action-row">
                    <div class="item-price">💰 ${item.sellPrice.toLocaleString()}</div>
                    <button class="sell-btn" data-item-id="${item.id}" data-item-name="${item.name}" title="Sell 1x ${item.name}">💰 Sell</button>
               </div>`
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

    // Wire up sell buttons with two-click confirm pattern
    inventoryContainer.querySelectorAll('.sell-btn').forEach(btn => {
        let confirmTimeout = null;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;

            // First click: switch to confirm state
            if (!btn.classList.contains('sell-confirm')) {
                btn.classList.add('sell-confirm');
                btn.textContent = '✓ Confirm';
                // Auto-reset after 3 seconds if user doesn't confirm
                confirmTimeout = setTimeout(() => {
                    btn.classList.remove('sell-confirm');
                    btn.textContent = '💰 Sell';
                }, 3000);
                return;
            }

            // Second click: execute sell
            if (confirmTimeout) clearTimeout(confirmTimeout);
            btn.classList.remove('sell-confirm');
            btn.disabled = true;
            btn.textContent = '⏳';
            try {
                const tab = await getCor3Tab();
                if (tab) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'sellItem',
                        itemId: itemId,
                        quantity: 1
                    });
                }
            } catch (err) {
                console.error('[COR3 Helper] Sell item error:', err);
            }
        });
    });
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
    dailyDifficulty.textContent = data.difficulty ? ((data.difficulty).charAt(0).toUpperCase() + (data.difficulty).slice(1)) : '--';
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
const soyuzMarketContainer = document.getElementById('soyuzMarketContainer');
const refreshMarketBtn = document.getElementById('refreshMarketBtn');
const refreshDarkMarketBtn = document.getElementById('refreshDarkMarketBtn');
const refreshSoyuzMarketBtn = document.getElementById('refreshSoyuzMarketBtn');
const coreMarketLabel = document.getElementById('coreMarketLabel');
const darkMarketLabel = document.getElementById('darkMarketLabel');
const soyuzMarketLabel = document.getElementById('soyuzMarketLabel');

// Market names from WS data
let coreMarketName = null;
let darkMarketName = null;
let soyuzMarketName = null;

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
    const img = labelEl.querySelector('img.faction-icon');
    const text = wsName || placeholder;
    if (img) {
        // Preserve the faction image, replace only text nodes
        labelEl.childNodes.forEach(n => { if (n.nodeType === 3) n.remove(); });
        labelEl.appendChild(document.createTextNode(' ' + text));
    } else {
        if (icon == '☭') {
            labelEl.innerHTML = `<span style="color:#c33b3b;">☭</span> ${text}`;
        } else {
            labelEl.textContent = `${icon} ${text}`;
        }
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

    if (idPrefix == 'home') {
        html += '<img src="factions/core_faction-96x96.png" class="faction-icon" alt="">';
    } else if (idPrefix == 'dark') {
        html += '<img src="factions/bmi_faction-96x96.png" class="faction-icon" alt="">';
    } else if (idPrefix == 'soyuz') {
        html += '<img src="factions/soyuz_faction-96x96.png" class="faction-icon" alt="">';
    }

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
let soyuzNextJobsResetAt = null;

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

function renderSoyuzMarket(data, available) {
    if (available === false) {
        let warningHtml = '<div class="warning-banner">⚠️ SOYUZ market server is currently unreachable.</div>';
        if (data && data.market) {
            if (data.nextJobsResetAt) soyuzNextJobsResetAt = data.nextJobsResetAt;
            if (data.market.marketName) {
                soyuzMarketName = data.market.marketName;
                updateMarketLabel(soyuzMarketLabel, soyuzMarketName, 'Market-3', '☭');
            }
            renderMarketInto(soyuzMarketContainer, data, 'Market-3 (cached)', 'soyuz');
            soyuzMarketContainer.insertAdjacentHTML('afterbegin', warningHtml);
        } else {
            soyuzMarketContainer.innerHTML = warningHtml + '<div class="no-decisions">No cached market data available.</div>';
        }
        return;
    }
    if (data && data.nextJobsResetAt) soyuzNextJobsResetAt = data.nextJobsResetAt;
    if (data && data.market && data.market.marketName) {
        soyuzMarketName = data.market.marketName;
        updateMarketLabel(soyuzMarketLabel, soyuzMarketName, 'Market-3', '☭');
        TIMER_LABELS.soyuz_jobs = soyuzMarketName + ' Jobs Reset';
        const opt = alarmTimerSelect.querySelector('option[value="soyuz_jobs"]');
        if (opt) opt.textContent = TIMER_LABELS.soyuz_jobs;
        renderPinnedTimers();
        renderAlarmList();
    }
    renderMarketInto(soyuzMarketContainer, data, 'Market-3', 'soyuz');
}

async function loadSoyuzMarket() {
    const { soyuzMarketData, soyuzMarketAvailable } = await chrome.storage.local.get(['soyuzMarketData', 'soyuzMarketAvailable']);
    renderSoyuzMarket(soyuzMarketData, soyuzMarketAvailable);
}

// Request all markets — sequential to avoid get.lots/get.jobs confusion
// content-early.js chains HOME → D4RK → SOYUZ internally via callbacks
async function requestMarketData() {
    marketContainer.innerHTML = '<div class="no-decisions">Requesting market data...</div>';
    darkMarketContainer.innerHTML = '<div class="no-decisions">Requesting market data...</div>';
    soyuzMarketContainer.innerHTML = '<div class="no-decisions">Requesting market data...</div>';
    await chrome.storage.local.remove(['marketData', 'darkMarketData', 'darkMarketAvailable', 'soyuzMarketData', 'soyuzMarketAvailable']);

    // Step 1: HOME
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestMarket" });
    } catch (e) { /* content script not reachable */ }
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get('marketData');
            if (data.marketData && data.marketData.market) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 500);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 15000);
    });
    await loadMarket();
    refreshAllTimestamps();

    // Step 2: D4RK (sequential — only after HOME is done)
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestDarkMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable']);
            if ((data.darkMarketData && data.darkMarketData.market) || data.darkMarketAvailable === false) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 500);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 15000);
    });
    await loadDarkMarket();
    refreshAllTimestamps();

    // Step 3: SOYUZ (sequential — only after D4RK is done)
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestSoyuzMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['soyuzMarketData', 'soyuzMarketAvailable']);
            if ((data.soyuzMarketData && data.soyuzMarketData.market) || data.soyuzMarketAvailable === false) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 500);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 20000);
    });
    await loadSoyuzMarket();
    refreshAllTimestamps();
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

async function refreshSoyuzMarketData() {
    soyuzMarketContainer.innerHTML = '<div class="no-decisions">Refreshing market data...</div>';
    try {
        const tab = await getCor3Tab();
        if (!tab) throw new Error('No cor3.gg tab');
        await chrome.tabs.sendMessage(tab.id, { action: "refreshSoyuzMarket" });
        setTimeout(() => { loadSoyuzMarket(); refreshAllTimestamps(); }, 5000);
    } catch (e) {
        setTimeout(() => { loadSoyuzMarket(); refreshAllTimestamps(); }, 500);
    }
}

refreshSoyuzMarketBtn.addEventListener('click', () => refreshSoyuzMarketData());

// On popup open: load cached market data (no WS requests)
chrome.storage.local.get(['marketData', 'darkMarketData', 'darkMarketAvailable', 'soyuzMarketData', 'soyuzMarketAvailable'], (result) => {
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
    if (result.darkMarketData || result.darkMarketAvailable === false) {
        if (result.darkMarketData) {
            if (result.darkMarketData.nextJobsResetAt) bmiNextJobsResetAt = result.darkMarketData.nextJobsResetAt;
            if (result.darkMarketData.market && result.darkMarketData.market.marketName) {
                darkMarketName = result.darkMarketData.market.marketName;
                updateMarketLabel(darkMarketLabel, darkMarketName, 'Market-2', '🌑');
                TIMER_LABELS.dark_jobs = darkMarketName + ' Jobs Reset';
                const opt = alarmTimerSelect.querySelector('option[value="dark_jobs"]');
                if (opt) opt.textContent = TIMER_LABELS.dark_jobs;
            }
        }
        renderDarkMarket(result.darkMarketData || null, result.darkMarketAvailable);
    } else {
        darkMarketContainer.innerHTML = '<div class="no-decisions">No market data cached. Click 🔄 to refresh.</div>';
    }
    if (result.soyuzMarketData || result.soyuzMarketAvailable === false) {
        if (result.soyuzMarketData) {
            if (result.soyuzMarketData.nextJobsResetAt) soyuzNextJobsResetAt = result.soyuzMarketData.nextJobsResetAt;
            if (result.soyuzMarketData.market && result.soyuzMarketData.market.marketName) {
                soyuzMarketName = result.soyuzMarketData.market.marketName;
                updateMarketLabel(soyuzMarketLabel, soyuzMarketName, 'Market-3', '☭');
                TIMER_LABELS.soyuz_jobs = soyuzMarketName + ' Jobs Reset';
                const opt = alarmTimerSelect.querySelector('option[value="soyuz_jobs"]');
                if (opt) opt.textContent = TIMER_LABELS.soyuz_jobs;
            }
        }
        renderSoyuzMarket(result.soyuzMarketData || null, result.soyuzMarketAvailable);
    } else {
        soyuzMarketContainer.innerHTML = '<div class="no-decisions">No market data cached. Click 🔄 to refresh.</div>';
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
    // Wait for either darkMarketData (success) or darkMarketAvailable (error/unreachable)
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable']);
            if (data.darkMarketData || data.darkMarketAvailable !== undefined) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 400);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 10000);
    });
    await loadDarkMarket();
    refreshAllTimestamps();
}

async function refreshMarket3Only() {
    soyuzMarketContainer.innerHTML = '<div class="no-decisions">Refreshing Market-3...</div>';
    await chrome.storage.local.remove(['soyuzMarketData', 'soyuzMarketAvailable']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "refreshSoyuzMarket" });
    } catch (e) {}
    // Wait for either soyuzMarketData (success) or soyuzMarketAvailable (error/unreachable)
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['soyuzMarketData', 'soyuzMarketAvailable']);
            if (data.soyuzMarketData || data.soyuzMarketAvailable !== undefined) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 400);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 15000);
    });
    await loadSoyuzMarket();
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

        // 5. Market-3 (SOYUZ)
        await executeRefreshStep('market3', refreshMarket3Only);
        await humanDelay();

        // 6. Expeditions
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
const pinSoyuzMarketBtn = document.getElementById('pinSoyuzMarketBtn');

// State: which timers are pinned
let pinnedTimers = { daily: false, home_jobs: false, dark_jobs: false, soyuz_jobs: false };
// State: auto-refresh for market job timers
let autoRefresh = { home_jobs: false, dark_jobs: false, soyuz_jobs: false };
// Track if auto-refresh retry is pending
let autoRefreshRetry = { home_jobs: null, dark_jobs: null, soyuz_jobs: null };
// Track last known timer values for zero-detection
let lastTimerSeconds = { home_jobs: null, dark_jobs: null, soyuz_jobs: null };

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
    pinSoyuzMarketBtn.classList.toggle('pinned', !!pinnedTimers.soyuz_jobs);
}

function renderPinnedTimers() {
    // Check if any timer is pinned (including expedition timers)
    let anyPinned = pinnedTimers.daily || pinnedTimers.home_jobs || pinnedTimers.dark_jobs || pinnedTimers.soyuz_jobs;
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
            <div><span class="pinned-timer-symbol-daily">📅 </span>
            <span class="pinned-timer-label">Daily Ops</span></div>
            <span class="pinned-timer-value" id="pinnedDailyValue">--:--:--</span>
        `;
        pinnedTimersContainer.appendChild(row);
    }
    if (pinnedTimers.home_jobs) {
        const name = coreMarketName || 'Market-1';
        const row = document.createElement('div');
        row.className = 'pinned-timer-row';
        row.innerHTML = `
            <div><span class="pinned-timer-symbol-core">🏠 </span>
            <span class="pinned-timer-label">${name} Jobs</span></div>
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
            <div><span class="pinned-timer-symbol-dark">🌑 </span>
            <span class="pinned-timer-label">${name} Jobs</span></div>
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

    if (pinnedTimers.soyuz_jobs) {
        const name = soyuzMarketName || 'Market-3';
        const row = document.createElement('div');
        row.className = 'pinned-timer-row';
        row.innerHTML = `
            <div><span class="pinned-timer-symbol-soyuz">☭ </span>
            <span class="pinned-timer-label">${name} Jobs</span></div>
            <span class="pinned-timer-value" id="pinnedSoyuzJobsValue">--:--:--</span>
            <label class="pinned-auto-refresh" title="Auto-refresh jobs when timer hits 0">
                <input type="checkbox" id="autoRefreshSoyuz" ${autoRefresh.soyuz_jobs ? 'checked' : ''}> Auto
            </label>
        `;
        pinnedTimersContainer.appendChild(row);
        row.querySelector('#autoRefreshSoyuz').addEventListener('change', async (e) => {
            autoRefresh.soyuz_jobs = e.target.checked;
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
    const pinnedSoyuz = document.getElementById('pinnedSoyuzJobsValue');
    if (pinnedSoyuz) {
        pinnedSoyuz.textContent = soyuzNextJobsResetAt ? formatTimeRemaining(soyuzNextJobsResetAt) : '--:--:--';
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
pinSoyuzMarketBtn.addEventListener('click', async () => {
    pinnedTimers.soyuz_jobs = !pinnedTimers.soyuz_jobs;
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
// Auto-refresh is now handled entirely by content.js (sequential, works in background).
// Popup UI updates automatically via chrome.storage.onChanged when market data arrives.
function checkAutoRefreshFromPopup() {
    // No-op: content.js handles sequential auto-refresh for all markets.
    // Popup UI refreshes via storage listeners when new market data is written.
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
    if (soyuzNextJobsResetAt) {
        const soyuzResetEl = soyuzMarketContainer.querySelector('.soyuz-reset-timer');
        if (soyuzResetEl) {
            soyuzResetEl.textContent = `⏳ Jobs Reset: ${formatTimeRemaining(soyuzNextJobsResetAt)}`;
        }
    }

    // Expedition timers inside expedition info cards
    document.querySelectorAll('.exp-timer').forEach(el => {
        const expId = el.dataset.expId;
        const endTime = expeditionEndTimes[expId];
        if (endTime) el.textContent = formatTimeRemaining(endTime);
    });

    // Auto-jobs reset timers
    document.querySelectorAll('.auto-jobs-reset-timer').forEach(el => {
        const resetAt = el.dataset.resetAt;
        if (resetAt) el.textContent = '⏳ Jobs Reset: ' + formatTimeRemaining(resetAt);
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
    // Live-update market data (handles initial load, background refreshes, error states)
    if (changes.marketData) {
        const md = changes.marketData.newValue;
        if (md) {
            if (md.nextJobsResetAt) coreNextJobsResetAt = md.nextJobsResetAt;
            if (md.market && md.market.marketName) {
                coreMarketName = md.market.marketName;
                updateMarketLabel(coreMarketLabel, coreMarketName, 'Market-1', '🏠');
                TIMER_LABELS.home_jobs = coreMarketName + ' Jobs Reset';
                const opt = alarmTimerSelect.querySelector('option[value="home_jobs"]');
                if (opt) opt.textContent = TIMER_LABELS.home_jobs;
            }
            renderMarket(md);
            refreshAllTimestamps();
        }
    }
    if (changes.darkMarketData || changes.darkMarketAvailable) {
        loadDarkMarket();
        refreshAllTimestamps();
    }
    if (changes.soyuzMarketData || changes.soyuzMarketAvailable) {
        loadSoyuzMarket();
        refreshAllTimestamps();
    }
    if (changes.dailyOpsData) {
        loadCachedDailyOps();
        refreshAllTimestamps();
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

// --- Auto ICE Wall Hacking ---
const autoIceWallToggle = document.getElementById('autoIceWallToggle');
const iceWallStatus = document.getElementById('iceWallStatus');

function updateIceWallStatusLabel(enabled) {
    iceWallStatus.textContent = enabled ? 'Active' : 'Off';
    iceWallStatus.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

// Load saved state on popup open
chrome.storage.sync.get('autoIceWallEnabled', (data) => {
    const enabled = !!data.autoIceWallEnabled;
    autoIceWallToggle.checked = enabled;
    updateIceWallStatusLabel(enabled);
});

autoIceWallToggle.addEventListener('change', async () => {
    const enabled = autoIceWallToggle.checked;
    await chrome.storage.sync.set({ autoIceWallEnabled: enabled });
    updateIceWallStatusLabel(enabled);

    // Send toggle message to content script
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "toggleIceWallSolver",
            enabled: enabled
        }).catch(() => {});
    }
});

// ICE Wall solver status line
const iceWallSolverStatusLine = document.getElementById('iceWallSolverStatusLine');

function renderIceWallSolverStatus(statusObj) {
    if (!statusObj || !statusObj.message) {
        iceWallSolverStatusLine.style.display = 'none';
        return;
    }
    // Only show if recent (within 5 minutes)
    if (Date.now() - statusObj.timestamp > 5 * 60 * 1000) {
        iceWallSolverStatusLine.style.display = 'none';
        return;
    }
    const colorMap = { success: 'var(--accent-green)', error: 'var(--accent-red, #ff5555)', warn: 'var(--accent-orange)', info: 'var(--accent-cyan)' };
    iceWallSolverStatusLine.textContent = '\uD83D\uDD13 ' + statusObj.message;
    iceWallSolverStatusLine.style.color = colorMap[statusObj.level] || 'var(--text-dim)';
    iceWallSolverStatusLine.style.display = '';
}

// Load cached status on popup open
chrome.storage.local.get('iceWallSolverStatus', (data) => {
    renderIceWallSolverStatus(data.iceWallSolverStatus);
});

// --- Auto Simple Decrypt Hacking ---
const autoSimpleDecryptToggle = document.getElementById('autoSimpleDecryptToggle');
const simpleDecryptStatus = document.getElementById('simpleDecryptStatus');

function updateSimpleDecryptStatusLabel(enabled) {
    simpleDecryptStatus.textContent = enabled ? 'Active' : 'Off';
    simpleDecryptStatus.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

// Load saved state on popup open
chrome.storage.sync.get('autoSimpleDecryptEnabled', (data) => {
    const enabled = !!data.autoSimpleDecryptEnabled;
    autoSimpleDecryptToggle.checked = enabled;
    updateSimpleDecryptStatusLabel(enabled);
});

autoSimpleDecryptToggle.addEventListener('change', async () => {
    const enabled = autoSimpleDecryptToggle.checked;
    await chrome.storage.sync.set({ autoSimpleDecryptEnabled: enabled });
    updateSimpleDecryptStatusLabel(enabled);

    // Send toggle message to content script
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "toggleSimpleDecryptSolver",
            enabled: enabled
        }).catch(() => {});
    }
});

// Simple Decrypt solver status line
const simpleDecryptSolverStatusLine = document.getElementById('simpleDecryptSolverStatusLine');

function renderSimpleDecryptSolverStatus(statusObj) {
    if (!statusObj || !statusObj.message) {
        simpleDecryptSolverStatusLine.style.display = 'none';
        return;
    }
    // Only show if recent (within 5 minutes)
    if (Date.now() - statusObj.timestamp > 5 * 60 * 1000) {
        simpleDecryptSolverStatusLine.style.display = 'none';
        return;
    }
    const colorMap = { success: 'var(--accent-green)', error: 'var(--accent-red, #ff5555)', warn: 'var(--accent-orange)', info: 'var(--accent-cyan)' };
    simpleDecryptSolverStatusLine.textContent = '\uD83D\uDD13 ' + statusObj.message;
    simpleDecryptSolverStatusLine.style.color = colorMap[statusObj.level] || 'var(--text-dim)';
    simpleDecryptSolverStatusLine.style.display = '';
}

// Load cached status on popup open
chrome.storage.local.get('simpleDecryptSolverStatus', (data) => {
    renderSimpleDecryptSolverStatus(data.simpleDecryptSolverStatus);
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

    if (enabled) {
        // Check if daily is already claimed — if yes, don't trigger automation
        const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
        if (dailyOpsData && dailyOpsData.hasClaimedToday) {
            if (dailyHackLogEl) {
                dailyHackLogEl.textContent = 'Daily already claimed today — skipping automation.';
                dailyHackLogEl.style.display = '';
            }
            // Turn toggle back off
            autoDailyHackToggle.checked = false;
            await chrome.storage.sync.set({ autoDailyHackEnabled: false });
            updateDailyHackStatusLabel(false);
            return;
        }
    }

    // Send toggle to content script
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "toggleDailyHackSolver",
            enabled: enabled
        }).catch(() => {});
    }
});

// Listen for daily hack log updates and toggle auto-disable
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.dailyHackLog) {
        const msg = changes.dailyHackLog.newValue;
        if (msg && dailyHackLogEl) {
            dailyHackLogEl.textContent = msg;
            dailyHackLogEl.style.display = '';
        }
    }
    // Auto-disable toggle when solver finishes (success or failure)
    if (area === 'sync' && changes.autoDailyHackEnabled) {
        const enabled = !!changes.autoDailyHackEnabled.newValue;
        autoDailyHackToggle.checked = enabled;
        updateDailyHackStatusLabel(enabled);
    }
    // Sync ICE Wall toggle state (e.g. when auto-job enables it)
    if (area === 'sync' && changes.autoIceWallEnabled) {
        const enabled = !!changes.autoIceWallEnabled.newValue;
        autoIceWallToggle.checked = enabled;
        updateIceWallStatusLabel(enabled);
    }
    // Live update ICE Wall solver status
    if (area === 'local' && changes.iceWallSolverStatus) {
        renderIceWallSolverStatus(changes.iceWallSolverStatus.newValue);
    }
    // Sync Simple Decrypt toggle state (e.g. when auto-job enables it)
    if (area === 'sync' && changes.autoSimpleDecryptEnabled) {
        const enabled = !!changes.autoSimpleDecryptEnabled.newValue;
        autoSimpleDecryptToggle.checked = enabled;
        updateSimpleDecryptStatusLabel(enabled);
    }
    // Live update Simple Decrypt solver status
    if (area === 'local' && changes.simpleDecryptSolverStatus) {
        renderSimpleDecryptSolverStatus(changes.simpleDecryptSolverStatus.newValue);
    }
});

// Version Info ---
async function displayVersionInfo(retryCount) {
    retryCount = retryCount || 0;
    const versionSection = document.getElementById('versionInfoSection');
    if (!versionSection) return;
    const extVersion = chrome.runtime.getManifest().version;
    const { webVersion, systemVersion, patchVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion', 'patchVersion']);

    // Fallback: try to get versions from content script globals if storage fails
    let finalWebVersion = webVersion;
    let finalSystemVersion = systemVersion;
    let finalPatchVersion = patchVersion;

    if (!webVersion || !systemVersion || !patchVersion) {
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
                    if (!finalPatchVersion && response.patchVersion) {
                        finalPatchVersion = response.patchVersion;
                        chrome.storage.local.set({ patchVersion: response.patchVersion });
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
    if (finalPatchVersion) parts.push(`Patch: ${finalPatchVersion}`);
    versionSection.innerHTML = parts.join(' · ');
    versionSection.style.display = 'block';

    // Retry a few times if versions are missing (data may arrive after popup opens)
    if ((!finalWebVersion || !finalSystemVersion || !finalPatchVersion) && retryCount < 5) {
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

// Auto-check GitHub for web/system/patch version differences on popup load
async function autoCheckWebsiteUpdated() {
    const webVersionNotice = document.getElementById('webVersionNotice');
    const webVersionData = document.getElementById('webVersionData');
    const systemVersionNotice = document.getElementById('systemVersionNotice');
    const systemVersionData = document.getElementById('systemVersionData');
    const patchVersionNotice = document.getElementById('patchVersionNotice');
    const patchVersionData = document.getElementById('patchVersionData');
    if (!webVersionNotice || !webVersionData || !systemVersionNotice || !systemVersionData) return;
    try {
        const resp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/versions.json', { cache: 'no-store' });
        if (!resp.ok) return;
        const remote = await resp.json();
        const { webVersion, systemVersion, patchVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion', 'patchVersion']);

        // Check web version - only warn if local is less than remote
        if (webVersion && remote.web) {
            const comparison = compareVersions(webVersion, remote.web);
            if (comparison > 0) {
                webVersionNotice.innerHTML = '⚠️ Website is recently updated';
                webVersionNotice.style.display = 'block';
                webVersionData.innerHTML = "Detected: " + webVersion + " · Old: " + remote.web;
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

        // Check patch version - warn if detected version is higher than remote (new patch)
        if (patchVersion && remote.patch && patchVersionNotice && patchVersionData) {
            const comparison = compareVersions(patchVersion, remote.patch);
            if (comparison > 0) {
                patchVersionNotice.innerHTML = '⚠️ Patch version is changed. Check patch notes!';
                patchVersionNotice.style.display = 'block';
                patchVersionData.innerHTML = "Detected: " + patchVersion + " · Old: " + remote.patch;
                patchVersionData.style.display = 'block';
            }
        }
    } catch (e) { /* silent */ }
}
autoCheckWebsiteUpdated();

// Auto-update version display when web/system/patch version arrives
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.webVersion || changes.systemVersion || changes.patchVersion) {
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
        mercStashWarning.textContent = '⚠️ Stash is full — auto-send mercenary disabled. Clear stash and re-enable auto-send to resume.';
        mercStashWarning.style.borderColor = 'var(--accent-orange)';
        mercStashWarning.style.color = 'var(--accent-orange)';
        mercStashWarning.style.background = 'rgba(255,160,0,0.15)';
        mercStashWarning.style.display = '';
    } else if (settings && settings.disabledReason === 'insufficient_credits' && !settings.enabled) {
        mercStashWarning.textContent = '⚠️ Insufficient credits — auto-send mercenary disabled. Earn more credits and re-enable auto-send to resume.';
        mercStashWarning.style.borderColor = 'var(--accent-red, #ff4444)';
        mercStashWarning.style.color = 'var(--accent-red, #ff4444)';
        mercStashWarning.style.background = 'rgba(255,68,68,0.15)';
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
    // If user re-enables, clear stash warning and expedition errors
    if (autoSendMercenaryToggle.checked) {
        updateMercStashWarning(null); // hide warning
        chrome.storage.local.remove('expeditionLaunchError');
        loadExpeditions();
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

        // Avatar image (avatarSeed is now a CDN URL)
        let avatarHtml = '';
        if (merc.avatarSeed && merc.avatarSeed.startsWith('http')) {
            avatarHtml = `<img class="merc-avatar" src="${merc.avatarSeed}" alt="${merc.callsign || ''}" loading="lazy">`;
        }

        let html = `${avatarHtml}<div class="merc-details">`;
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

// --- Move Notifications to Left Toggle ---
const moveNotificationsToggle = document.getElementById('moveNotificationsToggle');
const moveNotificationsStatus = document.getElementById('moveNotificationsStatus');

// --- Auto Update Markets Toggle ---
const autoUpdateMarketsToggle = document.getElementById('autoUpdateMarketsToggle');
const autoUpdateMarketsStatus = document.getElementById('autoUpdateMarketsStatus');

function updateNetworkFogStatus() {
    if (!disableNetworkFogToggle || !networkFogStatus) return;
    const isEnabled = disableNetworkFogToggle.checked;
    networkFogStatus.textContent = isEnabled ? 'Active' : 'Off';
    networkFogStatus.style.color = isEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

function updateMoveNotificationsStatus() {
    if (!moveNotificationsToggle || !moveNotificationsStatus) return;
    const isEnabled = moveNotificationsToggle.checked;
    moveNotificationsStatus.textContent = isEnabled ? 'Active' : 'Off';
    moveNotificationsStatus.style.color = isEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

function updateAutoUpdateMarketsStatus() {
    if (!autoUpdateMarketsToggle || !autoUpdateMarketsStatus) return;
    const isEnabled = autoUpdateMarketsToggle.checked;
    autoUpdateMarketsStatus.textContent = isEnabled ? 'Active' : 'Off';
    autoUpdateMarketsStatus.style.color = isEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

// Load saved settings
chrome.storage.sync.get(['disableSystemMessages', 'disableBackground', 'disableNetworkFog', 'moveNotificationsLeft', 'autoUpdateMarkets'], (result) => {
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
    if (moveNotificationsToggle) {
        moveNotificationsToggle.checked = result.moveNotificationsLeft || false;
        updateMoveNotificationsStatus();
    }
    if (autoUpdateMarketsToggle) {
        autoUpdateMarketsToggle.checked = result.autoUpdateMarkets || false;
        updateAutoUpdateMarketsStatus();
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

// Handle move notifications toggle changes
if (moveNotificationsToggle) {
    moveNotificationsToggle.addEventListener('change', async () => {
        const isEnabled = moveNotificationsToggle.checked;
        chrome.storage.sync.set({ moveNotificationsLeft: isEnabled });
        updateMoveNotificationsStatus();
        try {
            const tab = await getCor3Tab();
            if (tab) {
                if (isEnabled) {
                    await chrome.tabs.sendMessage(tab.id, { action: "moveNotificationsLeft" });
                } else {
                    await chrome.tabs.sendMessage(tab.id, { action: "moveNotificationsRight" });
                }
            }
        } catch (e) {
            console.error('[COR3 Helper] Failed to toggle notification position:', e);
            cor3LogError('popup.js', e, { action: 'toggleNotificationPosition' });
        }
    });
}

// Handle auto update markets toggle changes
if (autoUpdateMarketsToggle) {
    autoUpdateMarketsToggle.addEventListener('change', () => {
        const isEnabled = autoUpdateMarketsToggle.checked;
        chrome.storage.sync.set({ autoUpdateMarkets: isEnabled });
        updateAutoUpdateMarketsStatus();
    });
}

// Initialize status on load
updateSystemMessageStatus();
updateBackgroundStatus();
updateNetworkFogStatus();
updateMoveNotificationsStatus();
updateAutoUpdateMarketsStatus();

// --- Auto Job Solver ---
const autoJobSolverToggle = document.getElementById('autoJobSolverToggle');
const autoJobSolverStatus = document.getElementById('autoJobSolverStatus');
const autoJobSolverSection = document.getElementById('autoJobSolverSection');
const autoJobsTabHome = document.getElementById('autoJobsTabHome');
const autoJobsTabDark = document.getElementById('autoJobsTabDark');
const autoJobsTabSoyuz = document.getElementById('autoJobsTabSoyuz');
const autoJobsContentHome = document.getElementById('autoJobsContentHome');
const autoJobsContentDark = document.getElementById('autoJobsContentDark');
const autoJobsContentSoyuz = document.getElementById('autoJobsContentSoyuz');
const autoJobsStartBtn = document.getElementById('autoJobsStartBtn');
const autoJobsDebugToggle = document.getElementById('autoJobsDebugToggle');
const autoJobsDebugConsole = document.getElementById('autoJobsDebugConsole');
const debugTabJobs = document.getElementById('debugTabJobs');
const debugTabLogs = document.getElementById('debugTabLogs');
const debugJobsBody = document.getElementById('debugJobsBody');
const debugLogsBody = document.getElementById('debugLogsBody');
const refreshAutoJobsBtn = document.getElementById('refreshAutoJobsBtn');
const autoFinishAllJobsToggle = document.getElementById('autoFinishAllJobsToggle');

const SUPPORTED_JOB_TYPES = [
    'File Decryption',
    'IP Injection',
    'Data Download',
    'Log Deletion',
    'Log Download',
    'Decrypt & Extract',
    'File Elimination',
    'Data Upload',
    'IP Cleanup'
];

const MARKET_IDS = {
    home: '019d3ea4-85bd-7389-904d-8f7c85841134',
    dark: '019d3ea4-85bd-7389-904d-908ba9194aa0',
    soyuz: '019da731-2db5-7d76-9447-1ea3b9b78001'
};

// Server priority (furthest first — matching auto-job-solver.js)
const SERVER_PRIORITY = ['RM7-N1L1', 'RM7-W3NCP', 'RM7-N2L3', 'RM7-N2L2', 'RM7-N2ECP', 'D4RK RM7CE', 'RM7-S4L4', 'RM7-E1SCP', 'RM7-E1L2CT', 'RM7-E1L5', 'RM7-E1L3'];
function getServerPriority(name) {
    const idx = SERVER_PRIORITY.indexOf(name);
    return idx >= 0 ? idx : SERVER_PRIORITY.length;
}

// Job type priority (matching auto-job-solver.js — transit jobs first, then simple, then complex)
const JOB_TYPE_PRIORITY = [
    'IP Injection', 'IP Cleanup', 'Data Upload', 'Data Download',
    'Log Deletion', 'Log Download', 'File Elimination', 'File Decryption', 'Decrypt & Extract'
];
function getJobTypePriority(name) {
    const idx = JOB_TYPE_PRIORITY.indexOf(name);
    return idx >= 0 ? idx : JOB_TYPE_PRIORITY.length;
}

// Log-related jobs are bugged on D4RK RM7CE (server has no logs tab)
const LOG_JOB_TYPES = ['Log Deletion', 'Log Download'];
function isJobBugged(job) {
    const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : (job.serverName || '');
    return serverName === 'D4RK RM7CE' && LOG_JOB_TYPES.includes(job.name || job.type);
}

let autoJobsRunning = false;
let autoFinishAllActive = false;
let autoJobsSelectedTypes = { home: [], dark: [], soyuz: [] };
let autoJobsDebugLogs = [];
const AUTO_JOBS_MAX_LOGS = 200;
let autoJobsTracker = []; // {jobId, name, type, server, market, status}

// Toggle section visibility
function updateAutoJobSolverStatus(enabled) {
    autoJobSolverStatus.textContent = enabled ? 'Active' : 'Off';
    autoJobSolverStatus.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
    autoJobSolverSection.style.display = enabled ? '' : 'none';
}

chrome.storage.sync.get('autoJobSolverEnabled', (data) => {
    const enabled = !!data.autoJobSolverEnabled;
    autoJobSolverToggle.checked = enabled;
    updateAutoJobSolverStatus(enabled);
    if (enabled) renderAutoJobsTabs();
});

autoJobSolverToggle.addEventListener('change', async () => {
    const enabled = autoJobSolverToggle.checked;
    await chrome.storage.sync.set({ autoJobSolverEnabled: enabled });
    updateAutoJobSolverStatus(enabled);
    if (enabled) renderAutoJobsTabs();
});

// Market tabs
autoJobsTabHome.addEventListener('click', () => switchAutoJobsTab('home'));
autoJobsTabDark.addEventListener('click', () => switchAutoJobsTab('dark'));
autoJobsTabSoyuz.addEventListener('click', () => switchAutoJobsTab('soyuz'));

function switchAutoJobsTab(market) {
    autoJobsTabHome.classList.toggle('active', market === 'home');
    autoJobsTabDark.classList.toggle('active', market === 'dark');
    autoJobsTabSoyuz.classList.toggle('active', market === 'soyuz');
    autoJobsContentHome.classList.toggle('active', market === 'home');
    autoJobsContentDark.classList.toggle('active', market === 'dark');
    autoJobsContentSoyuz.classList.toggle('active', market === 'soyuz');
}

// Render job types from cached market data
async function renderAutoJobsTabs() {
    const { marketData, darkMarketData, soyuzMarketData } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData']);
    renderAutoJobsMarket(autoJobsContentHome, marketData, 'home');
    renderAutoJobsMarket(autoJobsContentDark, darkMarketData, 'dark');
    renderAutoJobsMarket(autoJobsContentSoyuz, soyuzMarketData, 'soyuz');
    // Update tab labels with market names
    if (marketData && marketData.market && marketData.market.marketName) {
        autoJobsTabHome.textContent = '🏠 ' + marketData.market.marketName;
    }
    if (darkMarketData && darkMarketData.market && darkMarketData.market.marketName) {
        autoJobsTabDark.textContent = '🌑 ' + darkMarketData.market.marketName;
    }
    if (soyuzMarketData && soyuzMarketData.market && soyuzMarketData.market.marketName) {
        autoJobsTabSoyuz.innerHTML = '<span style="color:#c33b3b;">☭</span> ' + soyuzMarketData.market.marketName;
    }
}

function renderAutoJobsMarket(container, data, marketKey) {
    container.innerHTML = '';
    if (!data || (!data.jobs && !data.recentJobs)) {
        container.innerHTML = '<div class="auto-jobs-no-jobs">No jobs available. Click 🔄 to refresh market data.</div>';
        return;
    }

    // Show job reset timer at the top
    if (data.nextJobsResetAt) {
        const timerDiv = document.createElement('div');
        timerDiv.className = 'auto-jobs-reset-timer';
        timerDiv.dataset.resetAt = data.nextJobsResetAt;
        timerDiv.textContent = '⏳ Jobs Reset: ' + formatTimeRemaining(data.nextJobsResetAt);
        container.appendChild(timerDiv);
    }

    // Combine open jobs + in-progress (taken) jobs from recentJobs
    const openJobs = (data.jobs || []).filter(j => !j.isCompleted && !j.isExpired);
    const takenJobs = (data.recentJobs || []).filter(j => j.status === 'TAKEN');
    // Mark taken jobs so we can distinguish them
    for (const tj of takenJobs) {
        tj._isTaken = true;
    }
    const availableJobs = [...openJobs, ...takenJobs];
    if (availableJobs.length === 0) {
        const noJobsDiv = document.createElement('div');
        noJobsDiv.className = 'auto-jobs-no-jobs';
        noJobsDiv.textContent = 'All jobs completed or expired.';
        container.appendChild(noJobsDiv);
        return;
    }

    // Group by job type (name)
    const typeMap = {};
    for (const job of availableJobs) {
        const typeName = job.name || 'Unknown';
        if (!typeMap[typeName]) typeMap[typeName] = [];
        typeMap[typeName].push(job);
    }

    const checkboxes = [];

    for (const [typeName, jobs] of Object.entries(typeMap)) {
        const isSupported = SUPPORTED_JOB_TYPES.includes(typeName);
        const row = document.createElement('div');
        row.className = 'auto-jobs-type-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.jobType = typeName;
        cb.dataset.market = marketKey;
        cb.disabled = !isSupported;
        if (isSupported && autoJobsSelectedTypes[marketKey] && autoJobsSelectedTypes[marketKey].includes(typeName)) {
            cb.checked = true;
        }
        cb.addEventListener('change', () => {
            updateAutoJobsSelectedTypes(marketKey, container);
            updateSelectAllState(selectAllCb, checkboxes);
        });

        const label = document.createElement('span');
        label.className = 'job-type-label';
        label.textContent = typeName;

        const takenCount = jobs.filter(j => j._isTaken).length;
        const buggedCount = jobs.filter(j => isJobBugged(j)).length;
        const count = document.createElement('span');
        count.className = 'job-type-count';
        let countText = `(${jobs.length}`;
        if (takenCount > 0) countText += `, ${takenCount} in-progress`;
        if (buggedCount > 0) countText += `, ${buggedCount} bugged`;
        countText += ')';
        count.textContent = countText;

        row.appendChild(label);

        if (!isSupported) {
            const tooltip = document.createElement('span');
            tooltip.className = 'unsupported-tooltip';
            tooltip.textContent = 'Not supported';
            tooltip.title = 'This job type is currently not supported';
            row.appendChild(tooltip);
        } else if (buggedCount > 0 && buggedCount === jobs.length) {
            const tooltip = document.createElement('span');
            tooltip.className = 'unsupported-tooltip';
            tooltip.style.color = 'var(--accent-orange)';
            tooltip.textContent = 'Bugged';
            tooltip.title = 'Log jobs on D4RK RM7CE are bugged (logs tab unavailable)';
            row.appendChild(tooltip);
        }

        row.appendChild(count);
        row.appendChild(cb);

        container.appendChild(row);
        if (isSupported) checkboxes.push(cb);
    }

    // Select all checkbox
    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'auto-jobs-select-all';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.id = 'selectAll_' + marketKey;
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = "job-type-label";
    selectAllLabel.setAttribute('for', selectAllCb.id);
    selectAllLabel.textContent = 'Select All';
    const totalTaken = takenJobs.length;
    const selectAllCount = document.createElement('span');
    selectAllCount.className = 'job-type-count';
    selectAllCount.textContent = totalTaken > 0 ? `(${availableJobs.length}, ${totalTaken} in-progress)` : `(${availableJobs.length})`;
    selectAllDiv.appendChild(selectAllLabel);
    selectAllDiv.appendChild(selectAllCount);
    selectAllDiv.appendChild(selectAllCb);
    container.appendChild(selectAllDiv);

    // Wire select all
    selectAllCb.addEventListener('change', () => {
        const checked = selectAllCb.checked;
        for (const cb of checkboxes) {
            cb.checked = checked;
        }
        updateAutoJobsSelectedTypes(marketKey, container);
    });

    updateSelectAllState(selectAllCb, checkboxes);
}

function updateSelectAllState(selectAllCb, checkboxes) {
    if (checkboxes.length === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
        return;
    }
    const checkedCount = checkboxes.filter(cb => cb.checked).length;
    selectAllCb.checked = checkedCount === checkboxes.length;
    selectAllCb.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function updateAutoJobsSelectedTypes(marketKey, container) {
    const cbs = container.querySelectorAll('input[type="checkbox"][data-job-type]');
    autoJobsSelectedTypes[marketKey] = [];
    cbs.forEach(cb => {
        if (cb.checked) autoJobsSelectedTypes[marketKey].push(cb.dataset.jobType);
    });
    chrome.storage.sync.set({ autoJobsSelectedTypes });
}

// Restore selected types
chrome.storage.sync.get('autoJobsSelectedTypes', (data) => {
    if (data.autoJobsSelectedTypes) {
        autoJobsSelectedTypes = data.autoJobsSelectedTypes;
    }
});

// Refresh button
refreshAutoJobsBtn.addEventListener('click', async () => {
    autoJobsContentHome.innerHTML = '<div class="auto-jobs-no-jobs">Refreshing (sequential)...</div>';
    autoJobsContentDark.innerHTML = '<div class="auto-jobs-no-jobs">Refreshing (sequential)...</div>';
    autoJobsContentSoyuz.innerHTML = '<div class="auto-jobs-no-jobs">Refreshing (sequential)...</div>';
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "refreshAllMarketsSeq" });
        }
    } catch (e) {}
    // Wait for sequential refresh completion signal via storage, with 30s fallback
    await new Promise(r => {
        let done = false;
        const listener = (changes, area) => {
            if (area === 'local' && changes._allMarketsRefreshed) {
                done = true;
                chrome.storage.onChanged.removeListener(listener);
                clearTimeout(tmr);
                r();
            }
        };
        chrome.storage.onChanged.addListener(listener);
        const tmr = setTimeout(() => { if (!done) { chrome.storage.onChanged.removeListener(listener); r(); } }, 30000);
    });
    renderAutoJobsTabs();
});

// Start/Stop button
autoJobsStartBtn.addEventListener('click', async () => {
    if (autoJobsRunning) {
        // Stop
        autoJobsRunning = false;
        autoJobsStartBtn.textContent = '▶ Start Auto Jobs';
        autoJobsStartBtn.className = 'auto-jobs-btn-start start';
        addAutoJobLog('Auto Jobs stopped by user.', 'warn');
        // Tell content script to stop
        try {
            const tab = await getCor3Tab();
            if (tab) await chrome.tabs.sendMessage(tab.id, { action: "stopAutoJobs" });
        } catch (e) {}
        await chrome.storage.local.set({ autoJobsRunning: false });
    } else {
        // Immediately switch button to Stop so user gets instant feedback
        autoJobsRunning = true;
        autoJobsStartBtn.textContent = '■ Stop Auto Jobs';
        autoJobsStartBtn.className = 'auto-jobs-btn-start stop';

        // Collect selected jobs from all markets (using already-cached market data)
        const { marketData, darkMarketData, soyuzMarketData } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData']);
        const jobsToRun = [];

        for (const marketKey of ['home', 'dark', 'soyuz']) {
            const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : soyuzMarketData;
            if (!md) continue;
            const selectedTypes = autoJobsSelectedTypes[marketKey] || [];
            if (selectedTypes.length === 0) continue;

            // Combine open + taken jobs
            const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && selectedTypes.includes(j.name));
            const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && selectedTypes.includes(j.name));

            for (const job of openJobs) {
                const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
                const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                    : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
                jobsToRun.push({
                    jobId: job.id,
                    name: job.name,
                    type: job.name,
                    serverName: serverName,
                    serverId: serverId,
                    marketId: MARKET_IDS[marketKey],
                    marketKey: marketKey,
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    deposit: job.deposit || 0,
                    conditions: job.conditions ? job.conditions.items || job.conditions : [],
                    alreadyTaken: false,
                    canComplete: false,
                    status: 'pending'
                });
            }

            for (const job of takenJobs) {
                const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
                const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                    : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
                jobsToRun.push({
                    jobId: job.id,
                    name: job.name,
                    type: job.name,
                    serverName: serverName,
                    serverId: serverId,
                    marketId: MARKET_IDS[marketKey],
                    marketKey: marketKey,
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    deposit: job.deposit || 0,
                    conditions: job.conditions ? job.conditions.items || job.conditions : [],
                    alreadyTaken: true,
                    canComplete: !!job.canComplete,
                    status: 'pending'
                });
            }
        }

        // Sort by server priority (furthest first), then job type priority
        jobsToRun.sort((a, b) => {
            const sp = getServerPriority(a.serverName) - getServerPriority(b.serverName);
            if (sp !== 0) return sp;
            return getJobTypePriority(a.type || a.name) - getJobTypePriority(b.type || b.name);
        });

        if (jobsToRun.length === 0) {
            addAutoJobLog('No jobs selected or available to run.', 'warn');
            autoJobsRunning = false;
            autoJobsStartBtn.textContent = '▶ Start Auto Jobs';
            autoJobsStartBtn.className = 'auto-jobs-btn-start start';
            return;
        }
        // Merge with existing tracker: keep previously completed/failed jobs from other runs
        const newJobIds = new Set(jobsToRun.map(j => j.jobId));
        const previousJobs = autoJobsTracker.filter(j =>
            !newJobIds.has(j.jobId) && (j.status === 'done' || j.status === 'failed')
        );
        autoJobsTracker = [...previousJobs, ...jobsToRun];
        renderDebugJobs();
        addAutoJobLog(`Starting auto jobs: ${jobsToRun.length} job(s) queued.`, 'info');

        // Store running state, queue, and merged tracker
        await chrome.storage.local.set({ autoJobsRunning: true, autoJobsQueue: jobsToRun, autoJobsTracker: autoJobsTracker });
        try {
            const tab = await getCor3Tab();
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, {
                    action: "startAutoJobs",
                    jobs: jobsToRun
                });
            }
        } catch (e) {
            addAutoJobLog('Failed to send auto jobs to content script: ' + e.message, 'error');
        }
    }
});

// Debug console toggle — persisted across popup close/reopen
chrome.storage.sync.get('autoJobsDebugConsoleEnabled', (data) => {
    const enabled = !!data.autoJobsDebugConsoleEnabled;
    autoJobsDebugToggle.checked = enabled;
    autoJobsDebugConsole.style.display = enabled ? '' : 'none';
    if (enabled) {
        renderDebugJobs();
        renderDebugLogs();
    }
});
autoJobsDebugToggle.addEventListener('change', () => {
    const enabled = autoJobsDebugToggle.checked;
    chrome.storage.sync.set({ autoJobsDebugConsoleEnabled: enabled });
    autoJobsDebugConsole.style.display = enabled ? '' : 'none';
    if (enabled) {
        renderDebugJobs();
        renderDebugLogs();
    }
});

// Debug console tabs
debugTabJobs.addEventListener('click', () => {
    debugTabJobs.classList.add('active');
    debugTabLogs.classList.remove('active');
    debugJobsBody.classList.add('active');
    debugLogsBody.classList.remove('active');
});
debugTabLogs.addEventListener('click', () => {
    debugTabLogs.classList.add('active');
    debugTabJobs.classList.remove('active');
    debugLogsBody.classList.add('active');
    debugJobsBody.classList.remove('active');
});

// --- Auto Finish All Jobs ---
// All scheduling is handled exclusively by background.js via chrome.alarms.
// popup.js only toggles the setting and notifies background.
chrome.storage.sync.get('autoFinishAllJobsEnabled', (data) => {
    autoFinishAllActive = !!data.autoFinishAllJobsEnabled;
    autoFinishAllJobsToggle.checked = autoFinishAllActive;
});

autoFinishAllJobsToggle.addEventListener('change', async () => {
    autoFinishAllActive = autoFinishAllJobsToggle.checked;
    await chrome.storage.sync.set({ autoFinishAllJobsEnabled: autoFinishAllActive });
    if (autoFinishAllActive) {
        addAutoJobLog('🔄 Auto Finish All Jobs enabled', 'info');
    } else {
        addAutoJobLog('🔄 Auto Finish All Jobs disabled', 'warn');
    }
    // Notify background to schedule/clear alarms
    chrome.runtime.sendMessage({ action: "scheduleAutoFinishAll" }).catch(() => {});
});

// --- Auto Clear Generated IPs ---
const autoClearIpsToggle = document.getElementById('autoClearIpsToggle');
chrome.storage.sync.get('autoClearIpsEnabled', (data) => {
    autoClearIpsToggle.checked = !!data.autoClearIpsEnabled;
});

autoClearIpsToggle.addEventListener('change', async () => {
    const enabled = autoClearIpsToggle.checked;
    await chrome.storage.sync.set({ autoClearIpsEnabled: enabled });
    if (enabled) {
        addAutoJobLog('🧹 Auto Clear Generated IPs enabled', 'info');
    } else {
        addAutoJobLog('🧹 Auto Clear Generated IPs disabled', 'warn');
    }
    chrome.runtime.sendMessage({ action: "scheduleAutoClearIps" }).catch(() => {});
});

// Collect all supported jobs WITHOUT filtering bugged ones (used to detect if only bugged remain)
function collectAllSupportedJobsUnfiltered(marketData, darkMarketData, soyuzMarketData) {
    const jobs = [];
    for (const marketKey of ['dark', 'home', 'soyuz']) {
        const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : soyuzMarketData;
        if (!md) continue;
        const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES.includes(j.name));
        const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES.includes(j.name));
        for (const j of [...openJobs, ...takenJobs]) {
            const sn = (j.relatedServers && j.relatedServers[0]) ? j.relatedServers[0].serverName : 'None';
            jobs.push({ name: j.name, type: j.name, serverName: sn, relatedServers: j.relatedServers });
        }
    }
    return jobs;
}

function collectAllSupportedJobs(marketData, darkMarketData, soyuzMarketData) {
    const jobsToRun = [];
    // D4RK market first (higher priority), then SOYUZ
    for (const marketKey of ['dark', 'home', 'soyuz']) {
        const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : soyuzMarketData;
        if (!md) continue;

        const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES.includes(j.name) && !isJobBugged(j));
        const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES.includes(j.name) && !isJobBugged(j));

        for (const job of openJobs) {
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
            jobsToRun.push({
                jobId: job.id,
                name: job.name,
                type: job.name,
                serverName: serverName,
                serverId: serverId,
                marketId: MARKET_IDS[marketKey],
                marketKey: marketKey,
                rewardCredits: job.rewardCredits,
                rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: false,
                canComplete: false,
                status: 'pending'
            });
        }

        for (const job of takenJobs) {
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
            jobsToRun.push({
                jobId: job.id,
                name: job.name,
                type: job.name,
                serverName: serverName,
                serverId: serverId,
                marketId: MARKET_IDS[marketKey],
                marketKey: marketKey,
                rewardCredits: job.rewardCredits,
                rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: true,
                canComplete: !!job.canComplete,
                status: 'pending'
            });
        }
    }
    // Sort by server priority (furthest first), then job type priority
    jobsToRun.sort((a, b) => {
        const sp = getServerPriority(a.serverName) - getServerPriority(b.serverName);
        if (sp !== 0) return sp;
        return getJobTypePriority(a.type || a.name) - getJobTypePriority(b.type || b.name);
    });
    return jobsToRun;
}

// runAutoFinishAll and scheduleAutoFinishAll are now handled exclusively by background.js
// popup.js only renders the UI state based on storage changes

// Add a log entry
function addAutoJobLog(msg, level = 'info') {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    autoJobsDebugLogs.push({ time: timeStr, msg, level });
    if (autoJobsDebugLogs.length > AUTO_JOBS_MAX_LOGS) {
        autoJobsDebugLogs.shift();
    }
    renderDebugLogs();
    // Persist logs
    chrome.storage.local.set({ autoJobsDebugLogs });
}

function renderDebugLogs() {
    if (autoJobsDebugLogs.length === 0) {
        debugLogsBody.innerHTML = '<div style="color:var(--text-dim);">No logs yet.</div>';
        return;
    }
    // Build off-screen to avoid flash/reflow
    const frag = document.createDocumentFragment();
    for (const log of autoJobsDebugLogs) {
        const row = document.createElement('div');
        let levelClass = '';
        if (log.level === 'error') levelClass = ' log-error';
        else if (log.level === 'success') levelClass = ' log-success';
        else if (log.level === 'warn') levelClass = ' log-warn';
        row.className = 'debug-log-row' + levelClass;
        row.innerHTML = `<span class="log-time">[${log.time}]</span> ${log.msg}`;
        frag.appendChild(row);
    }
    debugLogsBody.replaceChildren(frag);
    debugLogsBody.scrollTop = debugLogsBody.scrollHeight;
}

let _renderDebugJobsId = 0;
async function renderDebugJobs() {
    const renderId = ++_renderDebugJobsId;

    const storageData = await chrome.storage.local.get(['autoJobsCompletedResults', 'marketData', 'darkMarketData', 'soyuzMarketData', 'autoJobsTracker']);
    if (renderId !== _renderDebugJobsId) return;

    const { autoJobsCompletedResults, marketData, darkMarketData, soyuzMarketData } = storageData;

    // Always use the freshest tracker from storage to avoid stale in-memory state
    if (storageData.autoJobsTracker) {
        autoJobsTracker = storageData.autoJobsTracker;
    }

    // Build indexes: completedResults (permanent record) and tracker (in-progress)
    const completedMap = {};
    if (autoJobsCompletedResults) {
        for (const cj of autoJobsCompletedResults) {
            completedMap[cj.jobId] = cj;
        }
    }
    const trackerMap = {};
    for (const tj of autoJobsTracker) {
        trackerMap[tj.jobId] = tj;
    }

    // Unified render: for each market, merge all sources with deduplication.
    // Priority: completedResults status > tracker status > market data status.
    // All jobs stay in the list until market reset clears them.
    const marketSources = [
        { key: 'home', label: '🏠 HOME', data: marketData },
        { key: 'dark', label: '🌑 D4RK', data: darkMarketData },
        { key: 'soyuz', label: '<span style="color:#c33b3b;margin-left:2px;margin-right:3px">☭</span> SOYUZ', data: soyuzMarketData }
    ];

    let hasAny = false;
    // Build all content off-screen in a fragment to avoid flash/reflow
    const frag = document.createDocumentFragment();

    for (const ms of marketSources) {
        const allJobs = [];
        const seenIds = new Set();

        // Helper: resolve final status for a job.
        // Priority: completedResults (permanent) > tracker (only non-pending) > fallback.
        // 'done' in completedResults is IMMUTABLE until next reset.
        // Tracker 'pending' means queued but not yet taken — show as 'open'.
        function resolveStatus(jobId, fallbackStatus) {
            const completed = completedMap[jobId];
            if (completed) return { status: completed.status, reward: completed.reward, error: completed.error };
            const tracked = trackerMap[jobId];
            if (tracked && tracked.status && tracked.status !== 'pending') {
                return { status: tracked.status, reward: tracked.reward || null, error: tracked.error || null };
            }
            return { status: fallbackStatus, reward: (tracked && tracked.reward) || null, error: (tracked && tracked.error) || null };
        }

        // 1. Market open jobs
        if (ms.data && ms.data.jobs) {
            for (const j of ms.data.jobs) {
                if (j.isCompleted || j.isExpired) continue;
                const sn = (j.relatedServers && j.relatedServers[0]) ? j.relatedServers[0].serverName : 'None';
                const resolved = resolveStatus(j.id, 'open');
                allJobs.push({ id: j.id, name: j.name, type: j.jobType || j.name, serverName: sn, status: resolved.status, reward: resolved.reward, error: resolved.error });
                seenIds.add(j.id);
            }
        }

        // 2. Taken/Completed jobs from recentJobs
        if (ms.data && ms.data.recentJobs) {
            for (const j of ms.data.recentJobs) {
                if ((j.status !== 'TAKEN' && j.status !== 'COMPLETED') || seenIds.has(j.id)) continue;
                const sn = (j.relatedServers && j.relatedServers[0]) ? j.relatedServers[0].serverName : 'None';
                const marketStatus = j.status === 'COMPLETED' ? 'done' : 'in-progress';
                const resolved = resolveStatus(j.id, marketStatus);
                allJobs.push({ id: j.id, name: j.name, type: j.jobType || j.name, serverName: sn, status: resolved.status, reward: resolved.reward, error: resolved.error });
                seenIds.add(j.id);
            }
        }

        // 3. Tracker jobs not yet in market data (e.g. just taken, market not refreshed)
        for (const tj of autoJobsTracker) {
            if ((tj.marketKey || 'home') !== ms.key || seenIds.has(tj.jobId)) continue;
            const resolved = resolveStatus(tj.jobId, tj.status === 'pending' ? 'open' : (tj.status || 'open'));
            allJobs.push({ id: tj.jobId, name: tj.name, type: tj.type || tj.name, serverName: tj.serverName || 'None', status: resolved.status, reward: resolved.reward, error: resolved.error });
            seenIds.add(tj.jobId);
        }

        // 4. Completed results not in market data or tracker (jobs that vanished from market)
        if (autoJobsCompletedResults) {
            for (const cj of autoJobsCompletedResults) {
                if (cj.marketKey !== ms.key || seenIds.has(cj.jobId)) continue;
                allJobs.push({
                    id: cj.jobId, name: cj.name, type: cj.type || cj.name,
                    serverName: cj.serverName || 'None',
                    status: cj.status, reward: cj.reward, error: cj.error
                });
                seenIds.add(cj.jobId);
            }
        }

        if (allJobs.length === 0) continue;
        hasAny = true;

        allJobs.sort((a, b) => {
            const sp = getServerPriority(a.serverName) - getServerPriority(b.serverName);
            if (sp !== 0) return sp;
            return getJobTypePriority(a.type || a.name) - getJobTypePriority(b.type || b.name);
        });

        const group = document.createElement('div');
        group.className = 'debug-market-group';
        const title = document.createElement('div');
        title.className = 'debug-market-group-title';
        title.innerHTML = ms.label + ` (${allJobs.length})`;
        group.appendChild(title);

        for (const job of allJobs) {
            group.appendChild(createDebugJobRow(job));
        }
        frag.appendChild(group);
    }

    if (!hasAny) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--text-dim)';
        empty.textContent = 'No job data yet.';
        frag.appendChild(empty);
    }
    // Atomic swap — single reflow, no flash
    debugJobsBody.replaceChildren(frag);
}

function createDebugJobRow(job) {
    const row = document.createElement('div');
    row.className = 'debug-job-row';

    const statusEl = document.createElement('span');
    let st = job.status || 'open';
    if (st === 'open' && isJobBugged(job)) st = 'bugged';
    statusEl.className = 'debug-job-status ' + st;
    statusEl.textContent = st.toUpperCase();
    if (job.error) {
        statusEl.title = job.error;
        statusEl.style.cursor = 'help';
    }
    row.appendChild(statusEl);

    const info = document.createElement('span');
    info.style.cssText = 'font-size:10px;color:var(--text-secondary);flex:1;';
    info.textContent = `${job.name} — ${job.serverName}`;
    row.appendChild(info);

    if (job.reward) {
        const rewardEl = document.createElement('span');
        rewardEl.style.cssText = 'font-size:9px;color:var(--accent-green);white-space:nowrap;';
        const dep = job.reward.deposit ? ` (-${job.reward.deposit})` : '';
        rewardEl.textContent = `💰${job.reward.credits}${dep} ⭐${job.reward.reputation || 0} 🏅${job.reward.renown || 0}`;
        row.appendChild(rewardEl);
    }

    return row;
}

// Listen for auto-job updates from content script via storage changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.autoJobsTracker) {
        autoJobsTracker = changes.autoJobsTracker.newValue || [];
        renderDebugJobs();
    }

    // Sync debug logs from storage (background.js writes directly to array)
    if (changes.autoJobsDebugLogs) {
        const newLogs = changes.autoJobsDebugLogs.newValue;
        if (Array.isArray(newLogs)) {
            autoJobsDebugLogs = newLogs;
            renderDebugLogs();
        }
    }

    if (changes.autoJobsRunning) {
        const running = changes.autoJobsRunning.newValue;
        autoJobsRunning = !!running;
        if (autoJobsRunning) {
            autoJobsStartBtn.textContent = '■ Stop Auto Jobs';
            autoJobsStartBtn.className = 'auto-jobs-btn-start stop';
        } else {
            autoJobsStartBtn.textContent = '▶ Start Auto Jobs';
            autoJobsStartBtn.className = 'auto-jobs-btn-start start';
        }
    }

    // Re-render job tabs and debug jobs when market data changes
    if (changes.marketData || changes.darkMarketData || changes.soyuzMarketData) {
        // Clear completed results per-market BEFORE re-rendering when that market's jobs reset
        const checkReset = (change) => {
            if (!change) return false;
            const oldReset = change.oldValue && change.oldValue.nextJobsResetAt;
            const newReset = change.newValue && change.newValue.nextJobsResetAt;
            return newReset && newReset !== oldReset;
        };
        const homeReset = checkReset(changes.marketData);
        const darkReset = checkReset(changes.darkMarketData);
        const soyuzReset = checkReset(changes.soyuzMarketData);
        if (homeReset || darkReset || soyuzReset) {
            // Clear old tracker/completed results synchronously first, then persist + render
            autoJobsTracker = autoJobsTracker.filter(j => {
                if (homeReset && (j.marketKey || 'home') === 'home') return false;
                if (darkReset && j.marketKey === 'dark') return false;
                if (soyuzReset && j.marketKey === 'soyuz') return false;
                return true;
            });
            chrome.storage.local.get('autoJobsCompletedResults', (result) => {
                let cr = Array.isArray(result.autoJobsCompletedResults) ? result.autoJobsCompletedResults : [];
                if (homeReset) cr = cr.filter(j => j.marketKey !== 'home');
                if (darkReset) cr = cr.filter(j => j.marketKey !== 'dark');
                if (soyuzReset) cr = cr.filter(j => j.marketKey !== 'soyuz');
                chrome.storage.local.set({ autoJobsCompletedResults: cr, autoJobsTracker: autoJobsTracker });
                // Render after clearing so new data doesn't show stale DONE statuses
                if (autoJobSolverToggle.checked) renderAutoJobsTabs();
                if (autoJobsDebugToggle.checked) renderDebugJobs();
            });
        } else {
            // No reset — just re-render with updated data
            if (autoJobSolverToggle.checked) renderAutoJobsTabs();
            if (autoJobsDebugToggle.checked) renderDebugJobs();
        }
    }

    // Re-render debug jobs when completed results change
    if (changes.autoJobsCompletedResults) {
        if (autoJobsDebugToggle.checked) {
            renderDebugJobs();
        }
    }
});

// Restore debug logs from storage on popup open
chrome.storage.local.get(['autoJobsDebugLogs', 'autoJobsTracker', 'autoJobsRunning'], (data) => {
    if (data.autoJobsDebugLogs) {
        autoJobsDebugLogs = data.autoJobsDebugLogs;
        renderDebugLogs();
    }
    if (data.autoJobsTracker) {
        autoJobsTracker = data.autoJobsTracker;
        renderDebugJobs();
    }
    if (data.autoJobsRunning) {
        autoJobsRunning = true;
        autoJobsStartBtn.textContent = '■ Stop Auto Jobs';
        autoJobsStartBtn.className = 'auto-jobs-btn-start stop';
    }
});
