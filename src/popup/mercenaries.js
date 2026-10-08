// --- Mercenaries ---
import { _h, _noData, _clearEl, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab, waitForStorageKey } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';
import { state } from './state.js';
import { findMaintenanceBlocker } from '../shared/server-map.js';
import { loadExpeditions } from './expeditions.js';

const mercenariesSectionToggle = document.getElementById('mercenariesSectionToggle');
const mercenariesSectionBody = document.getElementById('mercenariesSectionBody');
const mercenariesContainer = document.getElementById('mercenariesContainer');
const refreshMercenariesBtn = document.getElementById('refreshMercenariesBtn');
const autoSendMercenaryToggle = document.getElementById('autoSendMercenaryToggle');
const autoChooseMercToggle = document.getElementById('autoChooseMercToggle');
const autoChooseUsolFirstToggle = document.getElementById('autoChooseUsolFirstToggle');
const insureHighRiskToggle = document.getElementById('insureHighRiskToggle');
const ignoreEliteMercToggle = document.getElementById('ignoreEliteMercToggle');
const applyMercCostLimiterToggle = document.getElementById('applyMercCostLimiterToggle');
const maxMercCostInput = document.getElementById('maxMercCostInput');
const mercCostDisplay = document.getElementById('mercCostDisplay');
const mercCostDisplayValue = document.getElementById('mercCostDisplayValue');
const mercCostEditRow = document.getElementById('mercCostEditRow');
const editMercCostBtn = document.getElementById('editMercCostBtn');
const saveMercCostBtn = document.getElementById('saveMercCostBtn');
const cancelMercCostBtn = document.getElementById('cancelMercCostBtn');
const getRidOfVeteransToggle = document.getElementById('getRidOfVeteransToggle');
const mercenaryConfigRow = document.getElementById('mercenaryConfigRow');
const selectedMercenaryName = document.getElementById('selectedMercenaryName');
const mercWarning = document.getElementById('mercWarning');

let selectedMercenaryId = null;
let mercRestTimers = {};

export function updateMercWarning(settings) {
    if (!mercWarning) return;
    if (settings && settings.disabledReason === 'stash_full' && !settings.enabled) {
        mercWarning.textContent = '⚠️ Stash is full — auto-send mercenary disabled. Clear stash and re-enable auto-send to resume.';
        mercWarning.style.borderColor = 'var(--accent-orange)';
        mercWarning.style.color = 'var(--accent-orange)';
        mercWarning.style.background = 'rgba(255,160,0,0.15)';
        mercWarning.style.display = '';
    } else if (settings && settings.disabledReason === 'insufficient_credits' && !settings.enabled) {
        mercWarning.textContent = '⚠️ Insufficient credits — auto-send mercenary disabled. Earn more credits and re-enable auto-send to resume.';
        mercWarning.style.borderColor = 'var(--accent-red, #ff4444)';
        mercWarning.style.color = 'var(--accent-red, #ff4444)';
        mercWarning.style.background = 'rgba(255,68,68,0.15)';
        mercWarning.style.display = '';
    } else {
        mercWarning.style.display = 'none';
    }
}

mercenariesSectionToggle.addEventListener('click', () => {
    mercenariesSectionToggle.classList.toggle('open');
    mercenariesSectionBody.classList.toggle('open');
});

export async function requestMercenaries() {
    mercenariesContainer.replaceChildren(_noData('Loading mercenaries...'));
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.storage.local.remove(['coreMercsDone', 'usolMercsDone']);
            await chrome.tabs.sendMessage(tab.id, { action: "requestMercenaries" });
            await waitForStorageKey('coreMercsDone', 30000);
            try { await chrome.tabs.sendMessage(tab.id, { action: "requestUsolMercenaries" }); } catch (e) {}
            await waitForStorageKey('usolMercsDone', 30000).catch(() => {});
        }
    } catch (e) { /* not reachable */ }
    await loadMercenaries();
    refreshAllTimestamps();
}

if (refreshMercenariesBtn) {
    refreshMercenariesBtn.addEventListener('click', () => requestMercenaries());
}

// Load/save auto-send settings
chrome.storage.sync.get('autoSendMerc', (data) => {
    if (data.autoSendMerc) {
        autoSendMercenaryToggle.checked = !!data.autoSendMerc.enabled;
        if (autoChooseMercToggle) autoChooseMercToggle.checked = !!data.autoSendMerc.autoChooseMerc;
        if (autoChooseUsolFirstToggle) autoChooseUsolFirstToggle.checked = !!data.autoSendMerc.autoChooseUsolFirst;
        if (insureHighRiskToggle) insureHighRiskToggle.checked = !!data.autoSendMerc.insureHighRisk;
        if (ignoreEliteMercToggle) ignoreEliteMercToggle.checked = !!data.autoSendMerc.ignoreEliteMerc;
        if (applyMercCostLimiterToggle) applyMercCostLimiterToggle.checked = !!data.autoSendMerc.applyMercCostLimiter;
        if (maxMercCostInput) maxMercCostInput.value = data.autoSendMerc.maxMercCost ?? 15000;
        if (mercCostDisplayValue) mercCostDisplayValue.textContent = data.autoSendMerc.maxMercCost ?? 15000;
        selectedMercenaryId = data.autoSendMerc.mercenaryId || null;
        if (selectedMercenaryId && mercenaryConfigRow) {
            mercenaryConfigRow.style.display = '';
            if (selectedMercenaryName) selectedMercenaryName.textContent = data.autoSendMerc.mercenaryName || selectedMercenaryId;
        }
        updateMercWarning(data.autoSendMerc);
    }
});
chrome.storage.local.get('mercWarning', (data) => {
    if (data.mercWarning && mercWarning) {
        mercWarning.textContent = '⚠️ ' + data.mercWarning;
        mercWarning.style.borderColor = 'var(--accent-orange)';
        mercWarning.style.color = 'var(--accent-orange)';
        mercWarning.style.background = 'rgba(255,160,0,0.15)';
        mercWarning.style.display = '';
    }
});

function saveAutoSendMercSettings() {
    if (!state.isHelper) {
        chrome.storage.sync.get('autoSendMerc', (data) => {
            const existing = data.autoSendMerc || {};
            const isEnabling = autoSendMercenaryToggle.checked;
            console.log("saveAutoSendMercSettings: " + autoChooseMercToggle.checked);
            chrome.storage.sync.set({
                autoSendMerc: {
                    enabled: isEnabling,
                    autoChooseMerc: autoChooseMercToggle ? autoChooseMercToggle.checked : false,
                    autoChooseUsolFirst: autoChooseUsolFirstToggle ? autoChooseUsolFirstToggle.checked : false,
                    insureHighRisk: insureHighRiskToggle ? insureHighRiskToggle.checked : false,
                    ignoreEliteMerc: ignoreEliteMercToggle ? ignoreEliteMercToggle.checked : false,
                    applyMercCostLimiter: applyMercCostLimiterToggle ? applyMercCostLimiterToggle.checked : false,
                    maxMercCost: maxMercCostInput ? parseInt(maxMercCostInput.value, 10) || 15000 : 15000,
                    mercenaryId: selectedMercenaryId,
                    mercenaryName: selectedMercenaryName ? selectedMercenaryName.textContent : '',
                    disabledReason: isEnabling ? null : (existing.disabledReason || null)
                }
            });
        });
    }
}

// Keep this preference independent from mercenary selection and the other
// auto-send controls. In particular, do not replace saved settings with DOM
// state that may still be loading when this toggle is changed.
function saveInsureHighRiskSetting() {
    if (state.isHelper || !insureHighRiskToggle) return;
    chrome.storage.sync.get('autoSendMerc', (data) => {
        chrome.storage.sync.set({
            autoSendMerc: {
                ...(data.autoSendMerc || {}),
                insureHighRisk: insureHighRiskToggle.checked
            }
        });
    });
}

autoSendMercenaryToggle.addEventListener('change', () => {
    saveAutoSendMercSettings();
    if (autoSendMercenaryToggle.checked) {
        updateMercWarning(null);
        chrome.storage.local.remove(['expeditionLaunchError', 'mercWarning']);
        loadExpeditions();
    }
});

if (autoChooseMercToggle) {
    autoChooseMercToggle.addEventListener('change', () => {
        saveAutoSendMercSettings();
        loadMercenaries();
    });
}
if (autoChooseUsolFirstToggle) {
    autoChooseUsolFirstToggle.addEventListener('change', () => {
        saveAutoSendMercSettings();
        loadMercenaries();
    });
}
if (insureHighRiskToggle) {
    insureHighRiskToggle.addEventListener('change', saveInsureHighRiskSetting);
}
if (ignoreEliteMercToggle) {
    ignoreEliteMercToggle.addEventListener('change', () => {
        saveAutoSendMercSettings();
        loadMercenaries();
    });
}
if (applyMercCostLimiterToggle) {
    applyMercCostLimiterToggle.addEventListener('change', () => {
        saveAutoSendMercSettings();
        loadMercenaries();
    });
}
if (editMercCostBtn) {
    editMercCostBtn.addEventListener('click', () => {
        if (maxMercCostInput) maxMercCostInput.value = mercCostDisplayValue ? mercCostDisplayValue.textContent : 15000;
        if (mercCostEditRow) mercCostEditRow.style.display = '';
        if (mercCostDisplay) mercCostDisplay.style.display = 'none';
    });
}
if (saveMercCostBtn) {
    saveMercCostBtn.addEventListener('click', () => {
        const newVal = maxMercCostInput ? parseInt(maxMercCostInput.value, 10) || 15000 : 15000;
        if (mercCostDisplayValue) mercCostDisplayValue.textContent = newVal;
        if (maxMercCostInput) maxMercCostInput.value = newVal;
        if (mercCostEditRow) mercCostEditRow.style.display = 'none';
        if (mercCostDisplay) mercCostDisplay.style.display = '';
        saveAutoSendMercSettings();
        loadMercenaries();
    });
}
if (cancelMercCostBtn) {
    cancelMercCostBtn.addEventListener('click', () => {
        if (mercCostEditRow) mercCostEditRow.style.display = 'none';
        if (mercCostDisplay) mercCostDisplay.style.display = '';
    });
}

// Auto-sell cheapest items toggle
const autoSellCheapestToggle = document.getElementById('autoSellCheapestToggle');
if (autoSellCheapestToggle) {
    chrome.storage.sync.get('autoSellCheapest', (data) => {
        autoSellCheapestToggle.checked = !!data.autoSellCheapest;
    });
    autoSellCheapestToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ autoSellCheapest: autoSellCheapestToggle.checked });
    });
}

export async function loadMercenaries() {
    const { mercenariesData, usolMercenariesData, mercConfigData, usolMarketAvailable, usolMarketMaintenanceEndsAt, usolMarketBlockerServer, serverMaintenanceMap } = await chrome.storage.local.get(['mercenariesData', 'usolMercenariesData', 'mercConfigData', 'usolMarketAvailable', 'usolMarketMaintenanceEndsAt', 'usolMarketBlockerServer', 'serverMaintenanceMap']);
    function attachConfigs(data) {
        if (!data || !mercConfigData) return;
        let mercs = data;
        if (mercs && !Array.isArray(mercs) && mercs.mercenaries) mercs = mercs.mercenaries;
        if (mercs && !Array.isArray(mercs) && mercs.data) mercs = mercs.data;
        if (Array.isArray(mercs)) {
            for (const merc of mercs) {
                if (mercConfigData[merc.id]) merc._expeditionConfig = mercConfigData[merc.id];
            }
        }
        const raw = data && data.data ? data.data : data;
        if (raw && raw.eliteSlots && mercConfigData) {
            raw.eliteSlots.forEach(es => {
                if (es.mercenary && mercConfigData[es.mercenary.id]) es.mercenary._expeditionConfig = mercConfigData[es.mercenary.id];
            });
        }
    }
    attachConfigs(mercenariesData);
    attachConfigs(usolMercenariesData);
    const usolB = usolMarketAvailable === false ? null : findMaintenanceBlocker(serverMaintenanceMap, 'usol');
    renderMercenaries(mercenariesData, usolMercenariesData, usolB ? false : usolMarketAvailable, usolB ? usolB.maintenanceEndsAt : usolMarketMaintenanceEndsAt, usolB ? usolB.blockerName : usolMarketBlockerServer);
    refreshAllTimestamps();
}

function parseMercList(data) {
    if (!data) return { mercs: [], eliteSlots: [] };
    let raw = data;
    if (raw && !Array.isArray(raw) && raw.data) raw = raw.data;
    let mercs = [];
    let eliteSlots = [];
    if (raw && raw.mercenaries) mercs = raw.mercenaries;
    else if (Array.isArray(raw)) mercs = raw;
    if (raw && raw.eliteSlots) eliteSlots = raw.eliteSlots;
    return { mercs, eliteSlots };
}

function buildMercCard(merc, isElite) {
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

    let avatarHtml = '';
    if (merc.avatarSeed && merc.avatarSeed.startsWith('http')) {
        avatarHtml = `<img class="merc-avatar" src="${merc.avatarSeed}" alt="${merc.callsign || ''}" loading="lazy">`;
    }

    let html = `${avatarHtml}<div class="merc-details">`;
    html += `<div class="merc-name">${merc.callsign || merc.name || 'Unknown'}`;
    if (isElite) html += `<span class="merc-elite-badge">ELITE</span>`;
    html += `</div>`;
    html += `<div style="margin-top:4px;"><span class="merc-status ${statusClass}">${status}</span>${restTimer}</div>`;
    if (merc.faction) {
        html += `<div class="merc-faction">`;
        const factionDisplay = (merc.faction.name || '').replace('factions.', '').replace(/([A-Z])/g, ' $1').trim().split(" ")[0].toUpperCase();
        html += `Faction: <b>${factionDisplay}</b></div>`;
    }
    html += `<div class="merc-info">`;
    html += `Rank: <b>${merc.rank || '--'}</b> · Missions: ${merc.missionsCompleted ?? '--'}<br>`;
    html += `Spec: <b>${specName}</b>`;
    if (specDesc) html += ` <span style="color:var(--text-dim);font-size:9px;">— ${specDesc}</span>`;
    html += `<br>Trait: <b>${traitName}</b>`;
    if (traitDesc) html += ` <span style="color:var(--text-dim);font-size:9px;">— ${traitDesc}</span>`;
    if (merc.reputationRequirement) html += `<br>Rep Required: ${merc.reputationRequirement}`;
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
    _safeSetHtml(card, html);

    card.addEventListener('click', () => {
        if ((autoChooseMercToggle && autoChooseMercToggle.checked)) return;
        selectedMercenaryId = merc.id;
        if (selectedMercenaryName) selectedMercenaryName.textContent = merc.callsign || merc.name || merc.id;
        if (mercenaryConfigRow) mercenaryConfigRow.style.display = '';
        mercenariesContainer.querySelectorAll('.merc-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        saveAutoSendMercSettings();
    });

    return card;
}

function renderMercenaries(coreData, usolData, usolAvailable, usolMaintenanceEndsAt, usolBlockerServer) {
    if (!mercenariesContainer) return;
    _clearEl(mercenariesContainer);

    if (usolAvailable === false) {
        let timerHtml = '';
        if (usolBlockerServer) timerHtml += ' (' + usolBlockerServer + ' in maintenance';
        if (usolMaintenanceEndsAt) {
            const diff = new Date(usolMaintenanceEndsAt).getTime() - Date.now();
            if (diff > 0) {
                const mins = Math.ceil(diff / 60000);
                timerHtml += (usolBlockerServer ? ', ' : ' (') + '~' + mins + 'm remaining';
            }
        }
        if (timerHtml) timerHtml += ')';
        mercenariesContainer.appendChild(_h('div', {className: 'warning-banner'}, '⚠️ USOL market is currently unreachable' + timerHtml + '. USOL mercenaries may be unavailable.'));
    }

    const coreParsed = parseMercList(coreData);
    const usolParsed = parseMercList(usolData);

    const eliteMercIds = new Set();
    [...coreParsed.eliteSlots, ...usolParsed.eliteSlots].forEach(es => {
        if (es.mercenary && es.mercenary.id) eliteMercIds.add(es.mercenary.id);
    });

    const allMercs = [];
    coreParsed.mercs.forEach(m => { m._market = 'core'; m._isElite = eliteMercIds.has(m.id); allMercs.push(m); });
    coreParsed.eliteSlots.forEach(es => {
        if (es.mercenary) { es.mercenary._market = 'core'; es.mercenary._isElite = true; if (!allMercs.find(x => x.id === es.mercenary.id)) allMercs.push(es.mercenary); }
    });
    usolParsed.mercs.forEach(m => { m._market = 'usol'; m._isElite = eliteMercIds.has(m.id); allMercs.push(m); });
    usolParsed.eliteSlots.forEach(es => {
        if (es.mercenary) { es.mercenary._market = 'usol'; es.mercenary._isElite = true; if (!allMercs.find(x => x.id === es.mercenary.id)) allMercs.push(es.mercenary); }
    });

    if (autoChooseMercToggle && autoChooseMercToggle.checked) {
        const ignoreElite = ignoreEliteMercToggle && ignoreEliteMercToggle.checked;
        const usolFirst = autoChooseUsolFirstToggle && autoChooseUsolFirstToggle.checked;
        const costLimiterOn = applyMercCostLimiterToggle && applyMercCostLimiterToggle.checked;
        const maxCost = maxMercCostInput ? parseInt(maxMercCostInput.value, 10) || 15000 : 15000;
        let available = allMercs.filter(m => m.status === 'AVAILABLE' && m._expeditionConfig);
        if (ignoreElite) available = available.filter(m => !m._isElite);
        if (costLimiterOn) available = available.filter(m => (m._expeditionConfig.totalCost || 0) <= maxCost);
        if (available.length > 0) {
            available.sort((a, b) => {
                if (usolFirst) {
                    if (a._market === 'usol' && b._market !== 'usol') return -1;
                    if (a._market !== 'usol' && b._market === 'usol') return 1;
                }
                const costA = (a._expeditionConfig && a._expeditionConfig.totalCost) || Infinity;
                const costB = (b._expeditionConfig && b._expeditionConfig.totalCost) || Infinity;
                if (costA !== costB) return costA - costB;
                const riskA = (a._expeditionConfig && a._expeditionConfig.riskScore) || 0;
                const riskB = (b._expeditionConfig && b._expeditionConfig.riskScore) || 0;
                if (riskA !== riskB) return riskA - riskB;
                if (a._market === 'usol' && b._market !== 'usol') return -1;
                if (a._market !== 'usol' && b._market === 'usol') return 1;
                return 0;
            });
            selectedMercenaryId = available[0].id;
            if (selectedMercenaryName) selectedMercenaryName.textContent = available[0].callsign || available[0].name || available[0].id;
            if (mercenaryConfigRow) mercenaryConfigRow.style.display = '';
            saveAutoSendMercSettings();
        }
    }

    const hasCore = coreParsed.mercs.length > 0 || coreParsed.eliteSlots.length > 0;
    const hasUsol = usolParsed.mercs.length > 0 || usolParsed.eliteSlots.length > 0;

    if (!hasCore && !hasUsol) {
        mercenariesContainer.replaceChildren(_noData('No mercenaries found.'));
        return;
    }

    if (hasCore) {
        const row = document.createElement('div');
        row.className = 'merc-market-row';
        const header = document.createElement('div');
        header.className = 'merc-market-header';
        header.appendChild(_h('div', null, _h('span', {className: 'expand-arrow-sub'}, '▶'), _h('span', {className: 'merc-market-label'}, 'CORE Market (' + (coreParsed.mercs.length + coreParsed.eliteSlots.filter(es => es.mercenary).length) + ')')));
        header.appendChild(_h('img', {src: 'factions/core_faction-96x96.png', alt: 'CORE'}));
        const body = document.createElement('div');
        body.className = 'merc-market-body';
        header.addEventListener('click', () => { header.classList.toggle('expanded'); body.classList.toggle('expanded'); });
        coreParsed.eliteSlots.forEach(es => { if (es.mercenary) body.appendChild(buildMercCard(es.mercenary, true)); });
        coreParsed.mercs.forEach(m => { if (!eliteMercIds.has(m.id)) body.appendChild(buildMercCard(m, false)); });
        row.appendChild(header);
        row.appendChild(body);
        mercenariesContainer.appendChild(row);
    }

    if (hasUsol) {
        const row = document.createElement('div');
        row.className = 'merc-market-row';
        const header = document.createElement('div');
        header.className = 'merc-market-header';
        header.appendChild(_h('div', null, _h('span', {className: 'expand-arrow-sub'}, '▶'), _h('span', {className: 'merc-market-label'}, 'USOL Market (' + (usolParsed.mercs.length + usolParsed.eliteSlots.filter(es => es.mercenary).length) + ')')));
        header.appendChild(_h('img', {src: 'factions/usol_faction-96x96.png', alt: 'USOL'}));
        const body = document.createElement('div');
        body.className = 'merc-market-body';
        header.addEventListener('click', () => { header.classList.toggle('expanded'); body.classList.toggle('expanded'); });
        usolParsed.eliteSlots.forEach(es => { if (es.mercenary) body.appendChild(buildMercCard(es.mercenary, true)); });
        usolParsed.mercs.forEach(m => { if (!eliteMercIds.has(m.id)) body.appendChild(buildMercCard(m, false)); });
        row.appendChild(header);
        row.appendChild(body);
        mercenariesContainer.appendChild(row);
    }
}

// Auto-load mercenaries from cache on popup open
(async () => {
    const { mercenariesData } = await chrome.storage.local.get('mercenariesData');
    if (mercenariesData) {
        loadMercenaries();
    } else {
        mercenariesContainer.replaceChildren(_noData('Waiting for mercenary data...'));
        let waited = 0;
        const pollInterval = setInterval(async () => {
            waited += 2000;
            const result = await chrome.storage.local.get('mercenariesData');
            if (result.mercenariesData) {
                clearInterval(pollInterval);
                loadMercenaries();
            } else if (waited >= 30000) {
                clearInterval(pollInterval);
                requestMercenaries();
            }
        }, 2000);
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

// Storage listener for mercenary data updates
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.mercenariesData || changes.usolMercenariesData || changes.mercConfigData || changes.usolMarketAvailable || changes.serverMaintenanceMap) {
        loadMercenaries();
    }
    if (changes.mercWarning) {
        const val = changes.mercWarning.newValue;
        if (val && mercWarning) {
            mercWarning.textContent = '⚠️ ' + val;
            mercWarning.style.borderColor = 'var(--accent-orange)';
            mercWarning.style.color = 'var(--accent-orange)';
            mercWarning.style.background = 'rgba(255,160,0,0.15)';
            mercWarning.style.display = '';
        }
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.autoSendMerc) {
        const val = changes.autoSendMerc.newValue;
        if (val) {
            autoSendMercenaryToggle.checked = !!val.enabled;
            updateMercWarning(val);
        }
    }
});
