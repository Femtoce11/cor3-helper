// Auto-Send Mercenary logic

import { isContextValid, _automationFinish, _automationEnqueue, _broadcastQueueStatus, getAutomationActive, setAutomationActive, getAutomationQueue } from './helpers.js';

export let _initialFetchDone = true; // false during initial data fetch after reconnect
export let autoSendInProgress = false;
export let autoSendExpeditionId = null;
export let autoSendAwaitingMercenaries = false;
export let autoSendAwaitingUsolMercs = false;
export let initialMercsReady = false;
export let autoSendDeferredWaiting = false;
export let autoSendExpeditionBlocked = false;
export let autoSendCollectRetries = 0;
export const MAX_COLLECT_RETRIES = 3;
export let _autoSendUsolSkipped = false;
export let _autoSendMercRetryCount = 0;
export const MAX_MERC_RETRIES = 3;

export function setInitialFetchDone(v) { _initialFetchDone = v; }
export function setAutoSendInProgress(v) { autoSendInProgress = v; }
export function setAutoSendExpeditionId(v) { autoSendExpeditionId = v; }
export function setAutoSendAwaitingMercenaries(v) { autoSendAwaitingMercenaries = v; }
export function setAutoSendAwaitingUsolMercs(v) { autoSendAwaitingUsolMercs = v; }
export function setInitialMercsReady(v) { initialMercsReady = v; }
export function setAutoSendDeferredWaiting(v) { autoSendDeferredWaiting = v; }
export function setAutoSendExpeditionBlocked(v) { autoSendExpeditionBlocked = v; }
export function setAutoSendCollectRetries(v) { autoSendCollectRetries = v; }
export function setAutoSendUsolSkipped(v) { _autoSendUsolSkipped = v; }
export function setAutoSendMercRetryCount(v) { _autoSendMercRetryCount = v; }

// Helper: sell cheapest sellable items to free up `count` stash slots
export function autoSellCheapestItems(items, count, callback) {
    if (!items || count <= 0) { if (callback) callback(); return; }
    const sellable = items
        .filter(i => i.canSell && i.sellPrice && i.sellPrice > 0)
        .sort((a, b) => a.sellPrice - b.sellPrice);
    const toSell = sellable.slice(0, Math.max(count, 1));
    if (toSell.length === 0) {
        console.log('[COR3 Helper] Auto-sell: no sellable items found');
        if (callback) callback();
        return;
    }
    console.log('[COR3 Helper] Auto-sell: selling', toSell.length, 'item(s):', toSell.map(i => i.name + ' (' + i.sellPrice + ')').join(', '));
    let idx = 0;
    function sellNext() {
        if (idx >= toSell.length) { if (callback) callback(); return; }
        const item = toSell[idx++];
        window.postMessage({ type: 'COR3_SELL_ITEM', itemId: item.id, quantity: 1, skipStashRefresh: true }, '*');
        setTimeout(sellNext, 1200 + Math.floor(Math.random() * 300));
    }
    sellNext();
}

// Helper: disable auto-send mercenary due to full stash
export function disableAutoSendDueToStashFull() {
    chrome.storage.sync.get('autoSendMerc', (settings) => {
        if (settings.autoSendMerc) {
            chrome.storage.sync.set({
                autoSendMerc: {
                    ...settings.autoSendMerc,
                    enabled: false,
                    disabledReason: 'stash_full'
                }
            });
        }
    });
    window.postMessage({
        type: 'COR3_STASH_FULL_WARNING',
        message: 'Stash is full. Clear stash before claiming more items. Auto-send mercenary disabled.'
    }, '*');
    autoSendInProgress = false;
    _automationFinish('auto-send');
    autoSendExpeditionId = null;
}

export function checkAutoSendOnExpeditionData(expeditions) {
    if (!expeditions || !Array.isArray(expeditions) || autoSendInProgress) return;
    if (!_initialFetchDone) {
        console.log('[COR3 Helper] Auto-send: deferred — initial data fetch still in progress');
        return;
    }
    if (autoSendExpeditionBlocked) {
        var hasActive = expeditions.some(e => e.status !== 'COMPLETED' && e.status !== 'FAILED');
        if (hasActive) {
            console.log('[COR3 Helper] Auto-send: still blocked — active expedition in progress');
            return;
        }
        console.log('[COR3 Helper] Auto-send: active expedition finished — unblocking');
        autoSendExpeditionBlocked = false;
        chrome.storage.local.remove('autoSendExpeditionBlocked');
    }
    const _automationActive = getAutomationActive();
    const _automationQueue = getAutomationQueue();
    if (_automationActive && _automationActive.type !== 'auto-send') {
        if (!_automationQueue.some(q => q.type === 'auto-send')) {
            console.log('[COR3 Helper] Auto-send: queued (waiting for', _automationActive.type, 'to finish)');
            _automationQueue.push({ type: 'auto-send', run: function () {
                chrome.storage.local.get('expeditionsData', (result) => {
                    setAutomationActive(null);
                    if (result.expeditionsData) {
                        checkAutoSendOnExpeditionData(result.expeditionsData);
                    } else {
                        import('./helpers.js').then(m => m._automationProcessNext());
                    }
                });
            }});
            _broadcastQueueStatus();
        } else {
            console.log('[COR3 Helper] Auto-send: already queued (waiting for', _automationActive.type, ')');
        }
        return;
    }
    chrome.storage.sync.get('autoSendMerc', (settings) => {
        if (!settings.autoSendMerc || !settings.autoSendMerc.enabled) return;
        if (!settings.autoSendMerc.mercenaryId && !settings.autoSendMerc.autoChooseMerc) return;

        const hasActiveExpeditions = expeditions.length > 0;
        if (!hasActiveExpeditions) {
            if (!initialMercsReady) {
                if (autoSendDeferredWaiting) {
                    console.log('[COR3 Helper] Auto-send: Already waiting for initial mercs — skipping duplicate deferral');
                    return;
                }
                autoSendDeferredWaiting = true;
                console.log('[COR3 Helper] Auto-send: No active expeditions but initial mercs not ready — deferring');
                function onInitialMercsDone(evt) {
                    if (evt.data && evt.data.type === 'COR3_USOL_MERCS_DONE') {
                        window.removeEventListener('message', onInitialMercsDone);
                        clearTimeout(deferTimeout);
                        autoSendDeferredWaiting = false;
                        console.log('[COR3 Helper] Auto-send: Initial mercs now ready — re-checking expeditions');
                        initialMercsReady = true;
                        chrome.storage.local.get('expeditionsData', (result) => {
                            if (result.expeditionsData) {
                                checkAutoSendOnExpeditionData(result.expeditionsData);
                            }
                        });
                    }
                }
                window.addEventListener('message', onInitialMercsDone);
                var deferTimeout = setTimeout(() => {
                    window.removeEventListener('message', onInitialMercsDone);
                    autoSendDeferredWaiting = false;
                    initialMercsReady = true;
                    console.log('[COR3 Helper] Auto-send: Deferred merc wait timed out — proceeding');
                    chrome.storage.local.get('expeditionsData', (result) => {
                        if (result.expeditionsData) {
                            checkAutoSendOnExpeditionData(result.expeditionsData);
                        }
                    });
                }, 60000);
                return;
            }
            console.log('[COR3 Helper] Auto-send: No active expeditions, refreshing mercs (CORE + USOL) before launch');
            autoSendInProgress = true;
            if (!getAutomationActive()) setAutomationActive({ type: 'auto-send', startedAt: Date.now() });
            _broadcastQueueStatus();
            autoSendExpeditionId = null;
            autoSendAwaitingMercenaries = false;
            autoSendAwaitingUsolMercs = true;
            var mercDelay = 2500 + Math.floor(Math.random() * 1000);
            setTimeout(() => {
                if (!autoSendInProgress || (getAutomationActive() && getAutomationActive().type !== 'auto-send')) {
                    console.log('[COR3 Helper] Auto-send: merc refresh skipped (no longer active or another automation took over)');
                    return;
                }
                window.postMessage({ type: 'COR3_REQUEST_MERCENARIES' }, '*');
            }, mercDelay);
            return;
        }

        // Look for a COMPLETED expedition that hasn't been fully collected yet
        for (const exp of expeditions) {
            if (exp.status === 'COMPLETED' && !exp.completedAt) {
                autoSendInProgress = true;
                if (!getAutomationActive()) setAutomationActive({ type: 'auto-send', startedAt: Date.now() });
                _broadcastQueueStatus();
                autoSendExpeditionId = exp.id;
                if (!exp.containerOpenedAt) {
                    console.log('[COR3 Helper] Auto-send: Detected COMPLETED expedition:', exp.id, '- opening container in 10s');
                    setTimeout(() => {
                        window.postMessage({ type: 'COR3_OPEN_CONTAINER', expeditionId: exp.id }, '*');
                    }, 10000 + Math.floor(Math.random() * 500));
                } else {
                    console.log('[COR3 Helper] Auto-send: Detected COMPLETED expedition:', exp.id, '- container already open, collecting in 10s');
                    setTimeout(() => {
                        window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: exp.id }, '*');
                    }, 10000 + Math.floor(Math.random() * 500));
                }
                return; // process one at a time
            }
        }
    });
}

export function proceedWithMerc(mercId, allMercs, settings, localData) {
    if (!mercId) {
        console.log('[COR3 Helper] Auto-send: no mercenary selected, aborting');
        autoSendInProgress = false;
        _automationFinish('auto-send');
        return;
    }
    const selectedMerc = allMercs.find(m => m.id === mercId);
    if (!selectedMerc || selectedMerc.status !== 'AVAILABLE') {
        console.log('[COR3 Helper] Auto-send: selected mercenary not AVAILABLE (status: ' + (selectedMerc ? selectedMerc.status : 'not found') + '), aborting');
        autoSendInProgress = false;
        _automationFinish('auto-send');
        return;
    }
    const isUsol = selectedMerc._market === 'usol' || (selectedMerc.faction && selectedMerc.faction.key === 'usol_employment');
    const configKey = isUsol ? 'usolExpeditionConfigData' : 'expeditionConfigData';
    const marketId = isUsol ? '019e4065-6ae8-760d-8724-58ab4f2cf7d7' : '019d3ea4-85bd-7389-904d-8f7c85841134';
    const config = localData[configKey];
    if (!config || !config.locations || config.locations.length === 0) {
        console.log('[COR3 Helper] Auto-send: no expedition config available for ' + (isUsol ? 'USOL' : 'CORE') + ', aborting');
        autoSendInProgress = false;
        _automationFinish('auto-send');
        return;
    }
    const DEFAULT_LOCATION_NAMES = ['Skylift Remains', 'Koute Mining and Reprocessing Outpost'];
    let loc = config.locations.find(l => DEFAULT_LOCATION_NAMES.includes(l.name));
    if (!loc) loc = config.locations[0];
    const zone = loc.zones && loc.zones[0] ? loc.zones[0] : null;
    const goal = zone && zone.goals && zone.goals[0] ? zone.goals[0] : null;
    if (!zone || !goal) {
        console.log('[COR3 Helper] Auto-send: missing zone/goal config, aborting');
        autoSendInProgress = false;
        _automationFinish('auto-send');
        return;
    }
    // Insurance is an optional launch modifier only. It must never affect which
    // mercenary is selected or whether an otherwise-valid launch proceeds.
    const mercConfig = localData.mercConfigData?.[mercId];
    const insuranceEnabled = settings.autoSendMerc.insureHighRisk === true;
    const isHighRisk = String(mercConfig?.riskLevel ?? '').trim().toUpperCase() === 'HIGH';
    const hasInsurance = insuranceEnabled && isHighRisk && !!mercConfig?.isInsuranceAvailable;
    const launchConfig = {
        mercenaryId: mercId,
        marketId: marketId,
        locationConfigId: loc.id,
        zoneConfigId: zone.id,
        goalId: goal.id,
        hasInsurance
    };
    if (insuranceEnabled) {
        if (isHighRisk) {
            console.log('[COR3 Helper] Auto-send: high-risk mercenary detected; insurance', hasInsurance ? 'enabled' : 'unavailable');
        } else {
            console.log('[COR3 Helper] Auto-send: mercenary is not high risk; launching without insurance');
        }
    }
    console.log('[COR3 Helper] Auto-send: launching expedition with mercenary:', selectedMerc.callsign, '(' + (isUsol ? 'USOL' : 'CORE') + ')');
    setTimeout(() => {
        chrome.storage.local.set({ lastExpeditionLaunchData: launchConfig });
        window.postMessage({ type: 'COR3_LAUNCH_EXPEDITION', config: launchConfig }, '*');
        autoSendExpeditionBlocked = true;
        chrome.storage.local.set({ autoSendExpeditionBlocked: true });
        autoSendInProgress = false;
        _automationFinish('auto-send');
    }, 1500 + Math.floor(Math.random() * 500));
}
