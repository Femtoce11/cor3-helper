import { _h, _clearEl } from './dom-helpers.js';
import { getCor3Tab, formatTimeRemaining } from './utils.js';
import { state } from './state.js';

const pinnedTimersSection = document.getElementById('pinnedTimersSection');
const pinnedTimersContainer = document.getElementById('pinnedTimersContainer');
const pinDailyBtn = document.getElementById('pinDailyBtn');
const pinCoreMarketBtn = document.getElementById('pinCoreMarketBtn');
const pinDarkMarketBtn = document.getElementById('pinDarkMarketBtn');
const pinSoyuzMarketBtn = document.getElementById('pinSoyuzMarketBtn');
const pinUsolMarketBtn = document.getElementById('pinUsolMarketBtn');

export async function loadPinnedState() {
    const data = await chrome.storage.sync.get(['pinnedTimers', 'autoRefresh']);
    if (data.pinnedTimers) state.pinnedTimers = data.pinnedTimers;
    if (data.autoRefresh) state.autoRefresh = data.autoRefresh;
    updatePinButtons();
    renderPinnedTimers();
}

export async function savePinnedState() {
    await chrome.storage.sync.set({ pinnedTimers: state.pinnedTimers, autoRefresh: state.autoRefresh });
}

function updatePinButtons() {
    pinDailyBtn.classList.toggle('pinned', !!state.pinnedTimers.daily);
    pinCoreMarketBtn.classList.toggle('pinned', !!state.pinnedTimers.home_jobs);
    pinDarkMarketBtn.classList.toggle('pinned', !!state.pinnedTimers.dark_jobs);
    pinSoyuzMarketBtn.classList.toggle('pinned', !!state.pinnedTimers.soyuz_jobs);
    pinUsolMarketBtn.classList.toggle('pinned', !!state.pinnedTimers.usol_jobs);
}

export function renderPinnedTimers() {
    let anyPinned = state.pinnedTimers.daily || state.pinnedTimers.home_jobs || state.pinnedTimers.dark_jobs || state.pinnedTimers.soyuz_jobs || state.pinnedTimers.usol_jobs;
    if (!anyPinned) {
        for (const key of Object.keys(state.pinnedTimers)) {
            if (key.startsWith('exp_') && state.pinnedTimers[key]) { anyPinned = true; break; }
        }
    }
    pinnedTimersSection.style.display = anyPinned ? '' : 'none';
    _clearEl(pinnedTimersContainer);

    if (state.pinnedTimers.daily) {
        const row = _h('div', {className: 'pinned-timer-row'},
            _h('div', null, _h('span', {className: 'pinned-timer-symbol-daily'}, '📅 '), _h('span', {className: 'pinned-timer-label'}, 'Daily Ops')),
            _h('span', {className: 'pinned-timer-value', id: 'pinnedDailyValue'}, '--:--:--')
        );
        pinnedTimersContainer.appendChild(row);
    }

    function _buildJobRow(pinKey, symbolCls, symbol, name, valueId, autoRefreshId) {
        const row = _h('div', {className: 'pinned-timer-row'},
            _h('div', {style: 'width: 200%;'}, _h('span', {className: symbolCls}, symbol + ' '), _h('span', {className: 'pinned-timer-label'}, name + ' Jobs')),
            _h('span', {className: 'pinned-timer-value', id: valueId}, '--:--:--')
        );
        if (!state.isHelper) {
            const cb = _h('input', {type: 'checkbox', id: autoRefreshId});
            if (state.autoRefresh[pinKey]) cb.checked = true;
            row.appendChild(_h('label', {className: 'pinned-auto-refresh', title: 'Auto-refresh jobs when timer hits 0'}, cb, ' Auto'));
            pinnedTimersContainer.appendChild(row);
            cb.addEventListener('change', async () => {
                state.autoRefresh[pinKey] = cb.checked;
                await savePinnedState();
                sendAutoRefreshToContent();
            });
        } else {
            pinnedTimersContainer.appendChild(row);
        }
    }

    if (state.pinnedTimers.home_jobs) _buildJobRow('home_jobs', 'pinned-timer-symbol-core', '🏠', state.coreMarketName || 'Market-1', 'pinnedCoreJobsValue', 'autoRefreshCore');
    if (state.pinnedTimers.dark_jobs) _buildJobRow('dark_jobs', 'pinned-timer-symbol-dark', '🌑', state.darkMarketName || 'Market-2', 'pinnedDarkJobsValue', 'autoRefreshDark');
    if (state.pinnedTimers.soyuz_jobs) _buildJobRow('soyuz_jobs', 'pinned-timer-symbol-soyuz', '☭', state.soyuzMarketName || 'Market-3', 'pinnedSoyuzJobsValue', 'autoRefreshSoyuz');
    if (state.pinnedTimers.usol_jobs) _buildJobRow('usol_jobs', 'pinned-timer-symbol-usol', '☮', state.usolMarketName || 'Market-4', 'pinnedUsolJobsValue', 'autoRefreshUsol');

    for (const key of Object.keys(state.pinnedTimers)) {
        if (!key.startsWith('exp_') || !state.pinnedTimers[key]) continue;
        const expId = key.substring(4);
        const endTime = state.expeditionEndTimes[expId];
        let expLabel = 'Expedition';
        const row = _h('div', {className: 'pinned-timer-row'},
            _h('span', {className: 'pinned-timer-label'}, '🎯 ', _h('span', {className: 'pinned-exp-label', dataset: {expId: expId}}, expLabel)),
            _h('span', {className: 'pinned-timer-value pinned-exp-timer', dataset: {expId: expId}}, endTime ? formatTimeRemaining(endTime) : '--:--:--')
        );
        pinnedTimersContainer.appendChild(row);
    }

    chrome.storage.local.get(['expeditionsData', 'droneMissionData'], async (result) => {
        const exps = result.expeditionsData || [];
        const droneMission = result.droneMissionData || null;
        const activeExpIds = new Set(exps.map(e => e.id));
        const activeDroneId = droneMission && droneMission.status === 'RUNNING' ? droneMission.id : null;
        if (activeDroneId) activeExpIds.add(activeDroneId);
        let staleRemoved = false;

        for (const key of Object.keys(state.pinnedTimers)) {
            if (key.startsWith('exp_') && state.pinnedTimers[key]) {
                const expId = key.substring(4);
                if (!activeExpIds.has(expId)) {
                    delete state.pinnedTimers[key];
                    delete state.expeditionEndTimes[expId];
                    staleRemoved = true;
                }
            }
        }

        if (staleRemoved) {
            await savePinnedState();
            renderPinnedTimers();
            return;
        }

        for (const exp of exps) {
            if (exp.endTime) state.expeditionEndTimes[exp.id] = exp.endTime;
            const labelEl = pinnedTimersContainer.querySelector(`.pinned-exp-label[data-exp-id="${exp.id}"]`);
            if (labelEl) {
                labelEl.textContent = `${exp.locationName || 'Expedition'} — ${exp.zoneName || ''}`;
            }
        }
        if (activeDroneId) {
            if (droneMission.endTime) state.expeditionEndTimes[activeDroneId] = droneMission.endTime;
            const labelEl = pinnedTimersContainer.querySelector(`.pinned-exp-label[data-exp-id="${activeDroneId}"]`);
            if (labelEl) {
                const loc = (droneMission.location && droneMission.location.name) || '';
                const mis = (droneMission.mission && droneMission.mission.name) || '';
                labelEl.textContent = `${loc} — ${mis}`;
            }
        }
    });
}

export function updatePinnedTimerValues() {
    const pinnedDaily = document.getElementById('pinnedDailyValue');
    if (pinnedDaily) {
        if (!state.dailyNextTaskTime) {
            pinnedDaily.textContent = '--:--:--';
        } else {
            const diff = state.dailyNextTaskTime - Date.now();
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
        pinnedCore.textContent = state.coreNextJobsResetAt ? formatTimeRemaining(state.coreNextJobsResetAt) : '--:--:--';
    }
    const pinnedDark = document.getElementById('pinnedDarkJobsValue');
    if (pinnedDark) {
        pinnedDark.textContent = state.bmiNextJobsResetAt ? formatTimeRemaining(state.bmiNextJobsResetAt) : '--:--:--';
    }
    const pinnedSoyuz = document.getElementById('pinnedSoyuzJobsValue');
    if (pinnedSoyuz) {
        pinnedSoyuz.textContent = state.soyuzNextJobsResetAt ? formatTimeRemaining(state.soyuzNextJobsResetAt) : '--:--:--';
    }
    const pinnedUsol = document.getElementById('pinnedUsolJobsValue');
    if (pinnedUsol) {
        pinnedUsol.textContent = state.usolNextJobsResetAt ? formatTimeRemaining(state.usolNextJobsResetAt) : '--:--:--';
    }
    document.querySelectorAll('.pinned-exp-timer').forEach(el => {
        const expId = el.dataset.expId;
        const endTime = state.expeditionEndTimes[expId];
        el.textContent = endTime ? formatTimeRemaining(endTime) : '--:--:--';
    });
}

async function sendAutoRefreshToContent() {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "updateAutoRefresh",
            autoRefresh: state.autoRefresh
        }).catch(() => {});
    }
}

export function initPinnedTimers() {
    pinDailyBtn.addEventListener('click', async () => {
        state.pinnedTimers.daily = !state.pinnedTimers.daily;
        await savePinnedState();
        updatePinButtons();
        renderPinnedTimers();
    });
    pinCoreMarketBtn.addEventListener('click', async () => {
        state.pinnedTimers.home_jobs = !state.pinnedTimers.home_jobs;
        await savePinnedState();
        updatePinButtons();
        renderPinnedTimers();
    });
    pinDarkMarketBtn.addEventListener('click', async () => {
        state.pinnedTimers.dark_jobs = !state.pinnedTimers.dark_jobs;
        await savePinnedState();
        updatePinButtons();
        renderPinnedTimers();
    });
    pinSoyuzMarketBtn.addEventListener('click', async () => {
        state.pinnedTimers.soyuz_jobs = !state.pinnedTimers.soyuz_jobs;
        await savePinnedState();
        updatePinButtons();
        renderPinnedTimers();
    });
    pinUsolMarketBtn.addEventListener('click', async () => {
        state.pinnedTimers.usol_jobs = !state.pinnedTimers.usol_jobs;
        await savePinnedState();
        updatePinButtons();
        renderPinnedTimers();
    });

    loadPinnedState();

    chrome.storage.sync.get('autoRefresh', (data) => {
        if (data.autoRefresh) state.autoRefresh = data.autoRefresh;
        sendAutoRefreshToContent();
    });
}

initPinnedTimers();
