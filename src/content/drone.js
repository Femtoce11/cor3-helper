// Drone missions (Personal Drone Assembling) — linear automation pipeline.
// Mirrors the mercenary auto-send flow: claim completed -> repair if needed -> launch.
import { isContextValid } from './helpers.js';

let autoDroneInProgress = false;
let autoDroneClaimedMissionId = null;
const autoDroneResolvedEvents = new Set();

let _droneOptionsRefreshTimer = null;
function scheduleDroneOptionsRefresh(delayMs) {
    if (_droneOptionsRefreshTimer) clearTimeout(_droneOptionsRefreshTimer);
    _droneOptionsRefreshTimer = setTimeout(() => {
        _droneOptionsRefreshTimer = null;
        if (!isContextValid()) return;
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
    }, delayMs || 1000);
}

// Pick the mission to dispatch: manual selection when autoChooseLocation is off,
// otherwise the cheapest (lowest battery cost) then lowest-risk then shortest mission.
function pickDroneMission(options, cfg) {
    if (!options || !options.locations || options.locations.length === 0) return null;
    if (!cfg.autoChooseLocation) {
        const loc = options.locations.find(l => l.id === cfg.locationConfigId) || options.locations[0];
        if (!loc || !loc.missions || loc.missions.length === 0) return null;
        const mis = loc.missions.find(m => m.id === cfg.missionConfigId) || loc.missions[0];
        return mis ? Object.assign({}, mis, { locationConfigId: loc.id, _risk: loc.baseRisk || 0 }) : null;
    }
    let best = null;
    for (const loc of options.locations) {
        for (const m of (loc.missions || [])) {
            const cand = Object.assign({}, m, { locationConfigId: loc.id, _risk: loc.baseRisk || 0 });
            if (!best) { best = cand; continue; }
            const cCost = cand.batteryCost || 0, bCost = best.batteryCost || 0;
            if (cCost !== bCost) { if (cCost < bCost) best = cand; continue; }
            if (cand._risk !== best._risk) { if (cand._risk < best._risk) best = cand; continue; }
            if ((cand.durationSeconds || 0) < (best.durationSeconds || 0)) best = cand;
        }
    }
    return best;
}

// Auto-drone main loop. Reads fresh droneData (options) + pending completed push.
function checkAutoDrone() {
    if (autoDroneInProgress) return;
    autoDroneInProgress = true;
    const finish = () => { autoDroneInProgress = false; };

    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (!cfg.enabled) { finish(); return; }
        if (cfg.paused) { finish(); return; }

        chrome.storage.local.get(['droneData', 'droneCompleted'], (local) => {
            const options = local.droneData;
            const completed = local.droneCompleted;

            if (options && options.drone && completed && completed.missionId && Array.isArray(completed.loot) && completed.loot.some(i => !i.claimed)) {
                if (autoDroneClaimedMissionId !== completed.missionId) {
                    autoDroneClaimedMissionId = completed.missionId;
                    console.log('[COR3 Helper] Auto-drone: claiming completed mission', completed.missionId);
                    window.postMessage({ type: 'COR3_CLAIM_DRONE', missionId: completed.missionId }, '*');
                }
                finish();
                return;
            }

            if (!options || !options.drone) { finish(); return; }
            const drone = options.drone;

            if (options.activeMissionId) { finish(); return; }
            if (drone.isRepairing) { finish(); return; }
            if (drone.isDestroyed) {
                console.log('[COR3 Helper] Auto-drone: drone destroyed — pausing');
                chrome.storage.sync.set({ autoDrone: Object.assign({}, cfg, { paused: true }) });
                chrome.storage.local.set({ droneWarning: 'Drone is destroyed — auto-drone paused. Repair or replace the drone.' });
                finish();
                return;
            }

            // Repair when durability is at/below threshold, or when battery is low (top-up during downtime)
            if (cfg.repairEnabled) {
                const threshold = typeof cfg.repairThreshold === 'number' ? cfg.repairThreshold : 60;
                const lowBattThreshold = typeof cfg.lowBatteryThreshold === 'number' ? cfg.lowBatteryThreshold : 30;
                const battCur = options.battery && typeof options.battery.current === 'number' ? options.battery.current : 100;
                const needsDurabilityRepair = drone.durability <= threshold;
                const needsLowBatteryRepair = !!cfg.repairOnLowBattery && battCur < lowBattThreshold && drone.durability < drone.maxDurability;
                if (needsDurabilityRepair || needsLowBatteryRepair) {
                    console.log('[COR3 Helper] Auto-drone: repairing (durability', drone.durability, ', battery', battCur + ')');
                    window.postMessage({ type: 'COR3_REPAIR_DRONE', targetDurability: 100 }, '*');
                    finish();
                    return;
                }
            }

            // Launch when battery is sufficient
            const mission = pickDroneMission(options, cfg);
            if (!mission) {
                console.log('[COR3 Helper] Auto-drone: no mission available');
                finish();
                return;
            }
            const batt = options.battery;
            if (batt && typeof batt.current === 'number' && batt.current < (mission.batteryCost || 0)) {
                console.log('[COR3 Helper] Auto-drone: battery', batt.current, '< cost', mission.batteryCost, '— waiting for recharge');
                finish();
                return;
            }
            if (cfg.fullChargeBeforeLaunch && batt && typeof batt.current === 'number' && typeof batt.max === 'number' && batt.current < batt.max) {
                console.log('[COR3 Helper] Auto-drone: waiting for full charge (', batt.current, '/', batt.max, ')');
                finish();
                return;
            }
            console.log('[COR3 Helper] Auto-drone: launching mission', mission.name, '(' + mission.locationConfigId + ')');
            window.postMessage({ type: 'COR3_LAUNCH_DRONE', locationConfigId: mission.locationConfigId, missionConfigId: mission.id }, '*');
            finish();
        });
    });
}

// Auto-resolve in-mission DECISION/HAZARD events (reward loot, penalize risk;
// avoid options that require a module we may not have).
function checkAutoDroneDecide(eventData) {
    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (!cfg.enabled || !cfg.autoDecide) return;
        const ev = eventData && eventData.event;
        if (!ev || !ev.isResolvable || ev.isResolved) return;
        if (!Array.isArray(ev.options) || ev.options.length === 0) return;
        if (autoDroneResolvedEvents.has(ev.eventId)) return;

        let best = null;
        for (const opt of ev.options) {
            if (!best) { best = opt; continue; }
            const r = (opt.effect && opt.effect.riskDelta) || 0;
            const l = (opt.effect && opt.effect.lootDelta) || 0;
            const br = (best.effect && best.effect.riskDelta) || 0;
            const bl = (best.effect && best.effect.lootDelta) || 0;
            const score = l * 3 - r * 2;
            const bScore = bl * 3 - br * 2;
            if (score !== bScore) { if (score > bScore) best = opt; continue; }
            if (!opt.requiredModuleId && best.requiredModuleId) best = opt;
        }
        if (!best) return;
        autoDroneResolvedEvents.add(ev.eventId);
        console.log('[COR3 Helper] Auto-drone: resolving event', ev.type, '->', best.label);
        window.postMessage({ type: 'COR3_RESOLVE_DRONE_EVENT', missionId: eventData.missionId, eventId: ev.eventId, optionId: best.id }, '*');
    });
}

// Rate-limit ("Too many requests") handling: retry with backoff, then disable.
let _droneRateLimitRetries = 0;
const DRONE_RATE_LIMIT_MAX_RETRIES = 3;
const DRONE_RATE_LIMIT_DELAYS_MS = [20000, 40000, 60000];

function isDroneRateLimited(msg) {
    const m = (msg || '').toLowerCase();
    return m.indexOf('too many requests') !== -1 || m.indexOf('rate limit') !== -1 || m.indexOf('rate-limited') !== -1;
}

function handleDroneRateLimited(action, msg) {
    _droneRateLimitRetries++;
    if (_droneRateLimitRetries <= DRONE_RATE_LIMIT_MAX_RETRIES) {
        const delayMs = DRONE_RATE_LIMIT_DELAYS_MS[Math.min(_droneRateLimitRetries - 1, DRONE_RATE_LIMIT_DELAYS_MS.length - 1)];
        const secs = Math.round(delayMs / 1000);
        console.log('[COR3 Helper] Auto-drone: rate limited (' + action + ') — retry ' + _droneRateLimitRetries + '/' + DRONE_RATE_LIMIT_MAX_RETRIES + ' in ' + secs + 's');
        chrome.storage.local.set({ droneWarning: 'Rate limited — retrying in ' + secs + 's (' + _droneRateLimitRetries + '/' + DRONE_RATE_LIMIT_MAX_RETRIES + ')' });
        setTimeout(() => {
            if (!isContextValid()) return;
            window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
        }, delayMs);
    } else {
        _droneRateLimitRetries = 0;
        console.log('[COR3 Helper] Auto-drone: rate limited after ' + DRONE_RATE_LIMIT_MAX_RETRIES + ' retries — disabling auto-dispatch');
        chrome.storage.local.set({ droneWarning: 'Rate limited — auto-dispatch disabled after ' + DRONE_RATE_LIMIT_MAX_RETRIES + ' retries. Re-enable to resume.' });
        chrome.storage.sync.get('autoDrone', (settings) => {
            chrome.storage.sync.set({ autoDrone: Object.assign({}, settings.autoDrone || {}, { enabled: false }) });
        });
    }
}

function handleDroneError(action, error) {
    const msg = error && (error.message || JSON.stringify(error)) || 'unknown error';
    console.log('[COR3 Helper] Auto-drone error (' + action + '):', msg);

    if (isDroneRateLimited(msg)) {
        handleDroneRateLimited(action, msg);
        return;
    }

    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (action === 'repair') {
            chrome.storage.local.set({ droneWarning: 'Drone repair failed: ' + msg });
            if (cfg.pauseOnRepairFail !== false) {
                console.log('[COR3 Helper] Auto-drone: pausing after repair failure');
                chrome.storage.sync.set({ autoDrone: Object.assign({}, cfg, { paused: true }) });
            }
        } else if (action === 'claim') {
            autoDroneClaimedMissionId = null;
            chrome.storage.local.set({ droneWarning: 'Drone claim failed: ' + msg });
        } else {
            chrome.storage.local.set({ droneWarning: 'Drone ' + action + ' failed: ' + msg });
        }
    });
}

// --- Relay inbound drone events to storage + drive the state machine ---
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isContextValid()) return;
    const now = Date.now();
    const type = event.data && event.data.type;

    if (type === 'COR3_WS_DRONE_OPTIONS') {
        _droneRateLimitRetries = 0;
        chrome.storage.local.set({ droneData: event.data.data, droneDataUpdatedAt: now });
        checkAutoDrone();
    } else if (type === 'COR3_WS_DRONE_MISSION') {
        chrome.storage.local.set({ droneMissionData: event.data.data, droneMissionUpdatedAt: now });
        scheduleDroneOptionsRefresh(2000);
    } else if (type === 'COR3_WS_DRONE_LAUNCHED') {
        console.log('[COR3 Helper] Auto-drone: mission launched');
        chrome.storage.local.remove('droneCompleted');
        autoDroneClaimedMissionId = null;
    } else if (type === 'COR3_WS_DRONE_CLAIMED') {
        console.log('[COR3 Helper] Auto-drone: mission claimed');
        chrome.storage.local.remove('droneCompleted');
        scheduleDroneOptionsRefresh(1500);
    } else if (type === 'COR3_WS_DRONE_COMPLETED') {
        chrome.storage.local.set({ droneCompleted: event.data.data, droneCompletedUpdatedAt: now });
        checkAutoDrone();
    } else if (type === 'COR3_WS_DRONE_EVENT') {
        checkAutoDroneDecide(event.data.data);
    } else if (type === 'COR3_WS_DRONE_REPAIR') {
        console.log('[COR3 Helper] Auto-drone: repair started');
    } else if (type === 'COR3_WS_DRONE_ARCHIVED') {
        const arcData = event.data.data || {};
        const items = Array.isArray(arcData.items) ? arcData.items : [];
        chrome.storage.local.get('droneArchivedData', (prev) => {
            let mergedItems = items;
            if (prev.droneArchivedData && Array.isArray(prev.droneArchivedData.items) && prev.droneArchivedData.items.length > 0) {
                const seen = new Set(prev.droneArchivedData.items.map(i => i.id));
                mergedItems = prev.droneArchivedData.items.concat(items.filter(i => !seen.has(i.id)));
            }
            chrome.storage.local.set({
                droneArchivedData: Object.assign({}, arcData, { items: mergedItems }),
                droneArchivedUpdatedAt: now
            });
        });
    } else if (type === 'COR3_WS_DRONE_ERROR') {
        handleDroneError(event.data.action, event.data.error);
    }
});

// --- Runtime actions from the popup ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'requestDroneOptions') {
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'launchDrone') {
        window.postMessage({ type: 'COR3_LAUNCH_DRONE', locationConfigId: request.locationConfigId, missionConfigId: request.missionConfigId }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'claimDrone') {
        window.postMessage({ type: 'COR3_CLAIM_DRONE', missionId: request.missionId }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'repairDrone') {
        window.postMessage({ type: 'COR3_REPAIR_DRONE', targetDurability: request.targetDurability }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'resolveDroneEvent') {
        window.postMessage({ type: 'COR3_RESOLVE_DRONE_EVENT', missionId: request.missionId, eventId: request.eventId, optionId: request.optionId }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'requestDroneArchived') {
        window.postMessage({ type: 'COR3_REQUEST_DRONE_ARCHIVED', cursor: request.cursor || null, limit: request.limit || 20 }, '*');
        sendResponse({ success: true });
    }
});

// --- Light polling: catch battery recharge / repair completion even with popup closed ---
setInterval(() => {
    if (!isContextValid()) return;
    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (!cfg.enabled || cfg.paused) return;
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
    });
}, 60000);

// Trigger when the toggle changes (enable / re-enable / unpause)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.autoDrone) return;
    const newVal = changes.autoDrone.newValue;
    if (newVal && newVal.enabled && !newVal.paused) {
        console.log('[COR3 Helper] Auto-drone enabled — checking drone state');
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
    }
});

// Page load: if auto-drone was enabled, kick off a state check after WS connects
setTimeout(() => {
    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (cfg.enabled && !cfg.paused) {
            console.log('[COR3 Helper] Page load: auto-drone enabled — requesting options');
            window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
        }
    });
}, 6000);
