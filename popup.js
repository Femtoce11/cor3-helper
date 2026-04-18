// popup.js

const alarmToggle = document.getElementById('alarmToggle');
const alarmTimerSelect = document.getElementById('alarmTimerSelect');
const alarmMinutes = document.getElementById('alarmMinutes');
const alarmSeconds = document.getElementById('alarmSeconds');
const continuousToggle = document.getElementById('continuousToggle');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const testAlarmBtn = document.getElementById('testAlarmBtn');
const stopAlarmBtn = document.getElementById('stopAlarmBtn');
const statusDiv = document.getElementById('status');

// Listen for alarm status from content script
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "alarmActiveStatus") {
        stopAlarmBtn.disabled = !request.isActive;
        statusDiv.textContent = request.isActive ? 'Alarm sounding...' : 'Ready';
    }
});

// --- Alarm Settings ---
async function loadSettings() {
    const data = await chrome.storage.sync.get([
        'alarmEnabled', 'alarmVolume', 'continuousAlarm',
        'alarmTimerSource', 'alarmThresholdMinutes', 'alarmThresholdSeconds'
    ]);
    alarmToggle.checked = data.alarmEnabled || false;
    continuousToggle.checked = data.continuousAlarm || false;
    alarmTimerSelect.value = data.alarmTimerSource || 'daily';
    alarmMinutes.value = data.alarmThresholdMinutes !== undefined ? data.alarmThresholdMinutes : 1;
    alarmSeconds.value = data.alarmThresholdSeconds !== undefined ? data.alarmThresholdSeconds : 0;
    const vol = data.alarmVolume !== undefined ? data.alarmVolume : 50;
    volumeSlider.value = vol;
    volumeValue.textContent = vol + '%';
    sendSettingsToContent();
}
function sendSettingsToContent() {
    const thresholdSec = (parseInt(alarmMinutes.value) || 0) * 60 + (parseInt(alarmSeconds.value) || 0);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "updateSettings",
                settings: {
                    alarmEnabled: alarmToggle.checked,
                    alarmVolume: parseInt(volumeSlider.value),
                    continuousAlarm: continuousToggle.checked,
                    alarmTimerSource: alarmTimerSelect.value,
                    alarmThresholdSeconds: thresholdSec
                }
            }).catch(() => {});
        }
    });
}
loadSettings();

alarmToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ alarmEnabled: alarmToggle.checked });
    sendSettingsToContent();
});
alarmTimerSelect.addEventListener('change', async () => {
    await chrome.storage.sync.set({ alarmTimerSource: alarmTimerSelect.value });
    sendSettingsToContent();
});
alarmMinutes.addEventListener('change', async () => {
    await chrome.storage.sync.set({ alarmThresholdMinutes: parseInt(alarmMinutes.value) || 0 });
    sendSettingsToContent();
});
alarmSeconds.addEventListener('change', async () => {
    await chrome.storage.sync.set({ alarmThresholdSeconds: parseInt(alarmSeconds.value) || 0 });
    sendSettingsToContent();
});
continuousToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ continuousAlarm: continuousToggle.checked });
    sendSettingsToContent();
});
volumeSlider.addEventListener('input', async () => {
    const vol = volumeSlider.value;
    volumeValue.textContent = vol + '%';
    await chrome.storage.sync.set({ alarmVolume: parseInt(vol) });
    sendSettingsToContent();
});

testAlarmBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "testAlarm" });
        }
    });
});
stopAlarmBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "stopAlarm" });
            stopAlarmBtn.disabled = true;
        }
    });
});

// --- Expedition Decisions ---
const mainView = document.getElementById('mainView');
const decisionsView = document.getElementById('decisionsView');
const decisionsContainer = document.getElementById('decisionsContainer');
const checkDecisionsBtn = document.getElementById('checkDecisionsBtn');
const backToMainBtn = document.getElementById('backToMainBtn');
const refreshDecisionsBtn = document.getElementById('refreshDecisionsBtn');

function showDecisionsView() {
    mainView.classList.add('hidden');
    inventoryView.classList.remove('active');
    decisionsView.classList.add('active');
    loadDecisions();
}

function showMainView() {
    decisionsView.classList.remove('active');
    mainView.classList.remove('hidden');
}

function renderDecisions(decisions) {
    decisionsContainer.innerHTML = '';

    if (!decisions || decisions.length === 0) {
        decisionsContainer.innerHTML = '<div class="no-decisions">No pending decisions found.<br>Make sure you have the cor3.gg tab open and expeditions are running.</div>';
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

async function loadDecisions() {
    const { expeditionDecisions } = await chrome.storage.local.get('expeditionDecisions');
    renderDecisions(expeditionDecisions || []);
}

checkDecisionsBtn.addEventListener('click', () => {
    showDecisionsView();
});

backToMainBtn.addEventListener('click', () => {
    showMainView();
});

refreshDecisionsBtn.addEventListener('click', async () => {
    // Clear stored decisions, request fresh data, then reload after a short delay
    await chrome.storage.local.set({ expeditionDecisions: [] });
    decisionsContainer.innerHTML = '<div class="no-decisions">Requesting data from server...</div>';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
    } catch (e) {
        // content script not reachable
    }
    // Wait a moment for the WS response to come back
    setTimeout(() => loadDecisions(), 2000);
});

// --- Inventory View ---
const inventoryView = document.getElementById('inventoryView');
const inventoryContainer = document.getElementById('inventoryContainer');
const openInventoryBtn = document.getElementById('openInventoryBtn');
const backFromInventoryBtn = document.getElementById('backFromInventoryBtn');
const refreshInventoryBtn = document.getElementById('refreshInventoryBtn');
const spaceInfo = document.getElementById('spaceInfo');

function showInventoryView() {
    mainView.classList.add('hidden');
    decisionsView.classList.remove('active');
    inventoryView.classList.add('active');
    requestAndLoadInventory();
}

async function hideInventoryView() {
    inventoryView.classList.remove('active');
    mainView.classList.remove('hidden');
    // Leave stash room when backing out
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: "leaveStash" });
    } catch (e) { /* content script not reachable */ }
}

async function requestAndLoadInventory() {
    inventoryContainer.innerHTML = '<div class="no-decisions">Requesting inventory from server...</div>';
    spaceInfo.textContent = '-- / --';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: "requestStash" });
    } catch (e) {
        // content script not reachable
    }
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

openInventoryBtn.addEventListener('click', () => showInventoryView());
backFromInventoryBtn.addEventListener('click', () => hideInventoryView());
refreshInventoryBtn.addEventListener('click', () => requestAndLoadInventory());

// --- Daily Ops Timer ---
const dailyTimerDisplay = document.getElementById('dailyTimerDisplay');
const dailyDetailsToggle = document.getElementById('dailyDetailsToggle');
const dailyDetailsBody = document.getElementById('dailyDetailsBody');
const dailyClaimed = document.getElementById('dailyClaimed');
const dailyStreak = document.getElementById('dailyStreak');
const dailyDifficulty = document.getElementById('dailyDifficulty');
const dailyStreakBonus = document.getElementById('dailyStreakBonus');

let dailyNextTaskTime = null;
let dailyTimerInterval = null;

dailyDetailsToggle.addEventListener('click', () => {
    dailyDetailsToggle.classList.toggle('open');
    dailyDetailsBody.classList.toggle('open');
});

function updateDailyTimer() {
    if (!dailyNextTaskTime) {
        dailyTimerDisplay.textContent = '--:--:--';
        return;
    }
    const now = Date.now();
    const diff = dailyNextTaskTime - now;
    if (diff <= 0) {
        dailyTimerDisplay.textContent = '0h:0m:0s';
        return;
    }
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    dailyTimerDisplay.textContent = `${h}h:${m}m:${s}s`;
}

async function fetchDailyOps() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.tabs.sendMessage(tab.id, { action: "fetchDailyOps" });
        if (response && response.data) {
            const data = response.data;
            dailyNextTaskTime = data.nextTaskTime ? new Date(data.nextTaskTime).getTime() : null;
            dailyClaimed.textContent = data.hasClaimedToday ? 'Yes' : 'No';
            dailyStreak.textContent = data.currentStreak ?? '--';
            dailyDifficulty.textContent = data.difficulty ?? '--';
            dailyStreakBonus.textContent = data.streakBonus ?? '--';
            updateDailyTimer();
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
                dailyTimerDisplay.textContent = '--:--:--';
            }
        } catch (e2) {
            dailyTimerDisplay.textContent = '--:--:--';
        }
    }
}

// Fetch once on every popup open
fetchDailyOps();
dailyTimerInterval = setInterval(updateDailyTimer, 1000);

// --- Markets ---
const marketContainer = document.getElementById('marketContainer');
const darkMarketContainer = document.getElementById('darkMarketContainer');
const refreshMarketBtn = document.getElementById('refreshMarketBtn');
const refreshDarkMarketBtn = document.getElementById('refreshDarkMarketBtn');

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

function renderMarketInto(container, data, labelPrefix, idPrefix) {
    container.innerHTML = '';

    if (!data || !data.market) {
        container.innerHTML = '<div class="no-decisions">No market data available.<br>Make sure you have the cor3.gg tab open.</div>';
        return;
    }

    const md = data;
    const market = md.market;
    const rep = md.reputation;

    // Market name
    let html = `<div style="font-size:13px;font-weight:bold;color:#f8f8f2;margin-bottom:6px;">${market.marketName || labelPrefix}</div>`;

    // Credits
    if (md.userCredits !== undefined) {
        html += `<div style="font-size:11px;color:#50fa7b;margin-bottom:4px;">💰 Credits: ${md.userCredits.toLocaleString()}</div>`;
    }

    // Reputation section
    if (rep) {
        const pct = rep.requiredReputation > 0 ? Math.min(100, Math.floor((rep.progress / rep.requiredReputation) * 100)) : 0;
        html += `<div style="font-size:11px;color:#c0c0c0;margin-bottom:2px;">Reputation — Level ${rep.level}</div>`;
        html += `<div class="market-rep-bar"><div class="market-rep-fill" style="width:${pct}%"></div></div>`;
        html += `<div style="font-size:10px;color:#6272a4;margin-bottom:4px;">`;
        html += `Progress: ${rep.progress}/${rep.requiredReputation} · `;
        html += `Level Locked: ${rep.isLevelLocked ? 'Yes' : 'No'} · `;
        html += `Max Level: ${rep.isMaxLevel ? 'Yes' : 'No'}`;
        html += `</div>`;
    }

    // Next jobs reset timer
    if (md.nextJobsResetAt) {
        html += `<div class="${idPrefix}-reset-timer" style="font-size:11px;color:#ffb86c;margin-bottom:8px;">⏳ Jobs Reset: ${formatTimeRemaining(md.nextJobsResetAt)}</div>`;
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
    renderMarketInto(marketContainer, data, 'CORE Market', 'home');
}

function renderDarkMarket(data, available) {
    if (available === false) {
        darkMarketContainer.innerHTML = '<div class="no-decisions" style="color:#ff5555;">⚠️ BMI-ZEN Market is currently unavailable.<br>The endpoint server could not be reached.</div>';
        return;
    }
    if (data && data.nextJobsResetAt) bmiNextJobsResetAt = data.nextJobsResetAt;
    renderMarketInto(darkMarketContainer, data, 'BMI-ZEN Market', 'dark');
}

async function loadMarket() {
    const { marketData } = await chrome.storage.local.get('marketData');
    renderMarket(marketData);
}

async function loadDarkMarket() {
    const { darkMarketData, darkMarketAvailable } = await chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable']);
    renderDarkMarket(darkMarketData, darkMarketAvailable);
}

async function requestMarketData() {
    marketContainer.innerHTML = '<div class="no-decisions">Requesting CORE market data...</div>';
    darkMarketContainer.innerHTML = '<div class="no-decisions">Waiting for BMI-ZEN market...</div>';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // Step 1: Request CORE market
        await chrome.tabs.sendMessage(tab.id, { action: "requestMarket" });
        // Step 2: After CORE data arrives, leave market room, then request BMI-ZEN
        setTimeout(async () => {
            loadMarket();
            try {
                await chrome.tabs.sendMessage(tab.id, { action: "leaveMarketRoom" });
                setTimeout(async () => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { action: "requestDarkMarket" });
                    } catch (e) { /* not reachable */ }
                    // BMI-ZEN market response comes async, load after timeout
                    setTimeout(() => loadDarkMarket(), 4000);
                }, 800);
            } catch (e) { /* not reachable */ }
        }, 3500);
    } catch (e) {
        // content script not reachable — try loading cached data
        setTimeout(() => { loadMarket(); loadDarkMarket(); }, 500);
    }
}

async function refreshMarketData() {
    marketContainer.innerHTML = '<div class="no-decisions">Refreshing CORE market data...</div>';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: "refreshMarket" });
        setTimeout(() => loadMarket(), 4000);
    } catch (e) {
        setTimeout(() => loadMarket(), 500);
    }
}

refreshMarketBtn.addEventListener('click', () => refreshMarketData());

async function refreshDarkMarketData() {
    darkMarketContainer.innerHTML = '<div class="no-decisions">Refreshing BMI-ZEN market data...</div>';
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: "refreshDarkMarket" });
        setTimeout(() => loadDarkMarket(), 4000);
    } catch (e) {
        setTimeout(() => loadDarkMarket(), 500);
    }
}

refreshDarkMarketBtn.addEventListener('click', () => refreshDarkMarketData());

// On popup open: request market data (CORE first, then BMI-ZEN)
requestMarketData();

// Seed timer timestamps from cache immediately so they tick while WS responses arrive
chrome.storage.local.get(['marketData', 'darkMarketData'], (result) => {
    if (result.marketData && result.marketData.nextJobsResetAt) {
        coreNextJobsResetAt = result.marketData.nextJobsResetAt;
    }
    if (result.darkMarketData && result.darkMarketData.nextJobsResetAt) {
        bmiNextJobsResetAt = result.darkMarketData.nextJobsResetAt;
    }
});

// Update market timers periodically using stored static timestamps
setInterval(() => {
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
}, 1000);