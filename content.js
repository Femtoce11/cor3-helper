// content.js

// Check if extension context is still valid
function isContextValid() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
}

// --- Automation Queue: prevents parallel endpoint-changing processes ---
let _automationQueue = [];
let _automationActive = null; // { type, startedAt }
const _AUTOMATION_POLL_MS = 10000;

function _automationQueueStatus() {
    return {
        active: _automationActive ? _automationActive.type : null,
        queued: _automationQueue.map(q => q.type)
    };
}

function _broadcastQueueStatus() {
    if (!isContextValid()) return;
    try { chrome.storage.local.set({ automationQueueStatus: _automationQueueStatus() }); } catch (e) {}
}

function _automationFinish(type) {
    if (_automationActive && _automationActive.type === type) {
        console.log('[COR3 Helper] Automation finished:', type);
        _automationActive = null;
        _broadcastQueueStatus();
        _automationProcessNext();
    }
}

function _automationProcessNext() {
    if (_automationActive) return;
    if (_automationQueue.length === 0) {
        _broadcastQueueStatus();
        setTimeout(() => {
            if (_automationActive || _automationQueue.length > 0) return;
            chrome.storage.local.get('expeditionsData', (result) => {
                if (result.expeditionsData) {
                    checkAutoSendOnExpeditionData(result.expeditionsData);
                }
            });
        }, 3000);
        return;
    }
    var next = _automationQueue.shift();
    _automationActive = { type: next.type, startedAt: Date.now() };
    console.log('[COR3 Helper] Automation starting:', next.type);
    _broadcastQueueStatus();
    next.run();
}

function _automationEnqueue(type, runFn) {
    if (_automationActive && _automationActive.type === type) return 'already-running';
    if (_automationQueue.some(q => q.type === type)) return 'already-queued';
    if (!_automationActive) {
        _automationActive = { type: type, startedAt: Date.now() };
        console.log('[COR3 Helper] Automation starting:', type);
        _broadcastQueueStatus();
        runFn();
        return 'started';
    }
    _automationQueue.push({ type: type, run: runFn });
    console.log('[COR3 Helper] Automation queued:', type, '(waiting for', _automationActive.type, ')');
    _broadcastQueueStatus();
    return 'queued';
}

// Auto Update Markets toggle: when OFF, only explicit refresh operations update market data in storage
let _autoUpdateMarkets = false;
let _marketRefreshInProgress = false;
let _autoUpdateMarketsLastRefresh = 0;
let _seqRefreshRunning = false;
let _autoJobsActive = false;
const _AUTO_UPDATE_MARKETS_INTERVAL = 10 * 60 * 1000; // 10 minutes
try { chrome.storage.sync.get('autoUpdateMarkets', (data) => {
    if (data.autoUpdateMarkets !== undefined) _autoUpdateMarkets = data.autoUpdateMarkets;
    // If enabled on load, check how fresh markets are and set timer accordingly
    if (_autoUpdateMarkets) _initAutoUpdateMarketsTimer();
}); } catch (e) {}

// Check market freshness and set the last-refresh timer so we only refresh when actually stale
function _initAutoUpdateMarketsTimer() {
    if (!isContextValid()) { _autoUpdateMarketsLastRefresh = Date.now(); return; }
    try {
        chrome.storage.local.get(['marketDataUpdatedAt', 'darkMarketDataUpdatedAt', 'soyuzMarketDataUpdatedAt', 'usolMarketDataUpdatedAt'], (result) => {
            const now = Date.now();
            const timestamps = [
                result.marketDataUpdatedAt || 0,
                result.darkMarketDataUpdatedAt || 0,
                result.soyuzMarketDataUpdatedAt || 0,
                result.usolMarketDataUpdatedAt || 0
            ].filter(t => t > 0);
            if (timestamps.length === 0) {
                // No market data at all — trigger immediate refresh
                _autoUpdateMarketsLastRefresh = 0;
                return;
            }
            const oldestUpdate = Math.min(...timestamps);
            const timeSinceOldest = now - oldestUpdate;
            if (timeSinceOldest >= _AUTO_UPDATE_MARKETS_INTERVAL) {
                // At least one market is stale (>10min) — trigger immediate refresh
                _autoUpdateMarketsLastRefresh = 0;
            } else {
                // All markets are fresh — pretend last refresh was at the oldest update time
                // so the next refresh fires when the 10-min window expires
                _autoUpdateMarketsLastRefresh = oldestUpdate;
            }
        });
    } catch (e) { _autoUpdateMarketsLastRefresh = Date.now(); }
}

// Periodic market refresh when Auto Update Markets is enabled
setInterval(() => {
    if (!_autoUpdateMarkets) return;
    if (!isContextValid()) return;
    if (_marketRefreshInProgress || _seqRefreshRunning || _autoJobsActive) return;
    const now = Date.now();
    if (now - _autoUpdateMarketsLastRefresh < _AUTO_UPDATE_MARKETS_INTERVAL) return;
    _autoUpdateMarketsLastRefresh = now;
    _automationEnqueue('auto-update-markets', () => {
        _marketRefreshInProgress = true;
        console.log('[COR3 Helper] Auto Update Markets: triggering periodic 10-min refresh');
        window.postMessage({ type: 'COR3_REFRESH_ALL_MARKETS_SEQ' }, '*');
        setTimeout(() => { _marketRefreshInProgress = false; _automationFinish('auto-update-markets'); }, 30000);
        function onDone(evt) {
            if (evt.data && evt.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
                window.removeEventListener('message', onDone);
                _marketRefreshInProgress = false;
                _automationFinish('auto-update-markets');
            }
        }
        window.addEventListener('message', onDone);
    });
}, 30000); // check every 30s

// Helper: sell cheapest sellable items to free up `count` stash slots
function autoSellCheapestItems(items, count, callback) {
    if (!items || count <= 0) { if (callback) callback(); return; }
    // Filter sellable items, sort by price ascending (cheapest first)
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
function disableAutoSendDueToStashFull() {
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

// --- Listen for data relayed from content-early.js (MAIN world) ---
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isContextValid()) return; // Extension was reloaded/updated
    const now = Date.now();

    // WS message logging (sent/received from content-early.js)
    if (event.data && event.data.type === 'COR3_WS_LOG') {
        cor3LogWsMessage(event.data.direction, event.data.message);
    }

    if (event.data && event.data.type === 'COR3_WS_EXPEDITIONS') {
        chrome.storage.local.set({ expeditionsData: event.data.expeditions, expeditionsDataUpdatedAt: now });
        // Clear expedition launch error if no active (IN_PROGRESS) expeditions remain
        var exps = event.data.expeditions || [];
        var hasActive = exps.some(function (e) { return e.status === 'IN_PROGRESS'; });
        if (!hasActive) {
            chrome.storage.local.get('expeditionLaunchError', function (result) {
                if (result.expeditionLaunchError && !result.expeditionLaunchError.noRetry) {
                    console.log('[COR3 Helper] No active expeditions — clearing expedition launch error');
                    chrome.storage.local.remove('expeditionLaunchError');
                }
            });
        }
        // Check for completed expeditions to trigger auto-send flow
        checkAutoSendOnExpeditionData(event.data.expeditions);
    }
    // Update decisions — always replace with fresh data from expedition messages
    if (event.data && event.data.type === 'COR3_WS_DECISIONS') {
        chrome.storage.local.set({ expeditionDecisions: event.data.decisions });
        checkAutoChooseFromContent(event.data.decisions);
    }
    if (event.data && event.data.type === 'COR3_WS_STASH') {
        chrome.storage.local.set({ stashData: event.data.stash, stashDataUpdatedAt: now });

        // Check if auto-send was disabled due to full stash and if we now have space
        chrome.storage.sync.get('autoSendMerc', (settings) => {
            if (settings.autoSendMerc &&
                settings.autoSendMerc.disabledReason === 'stash_full' &&
                !settings.autoSendMerc.enabled) {

                const stash = event.data.stash;
                let hasSpace = false;
                let spaceNeeded = 2; // Require at least 2 spaces for safety

                if (stash && stash.maxCapacity && stash.currentUsage !== undefined) {
                    const availableSpace = stash.maxCapacity - stash.currentUsage;
                    hasSpace = availableSpace >= spaceNeeded;
                }

                if (hasSpace) {
                    console.log('[COR3 Helper] Stash has space again, re-enabling auto-send mercenary');
                    chrome.storage.sync.set({
                        autoSendMerc: {
                            ...settings.autoSendMerc,
                            enabled: true,
                            disabledReason: null
                        }
                    });
                    // Notify user
                    window.postMessage({
                        type: 'COR3_AUTO_SEND_REENABLED',
                        message: 'Stash space available. Auto-send mercenary re-enabled.'
                    }, '*');
                }
            }
        });
    }
    if (event.data && event.data.type === 'COR3_WS_MARKET') {
        // Always store market data: initial page load, auto-update, or manual refresh
        chrome.storage.local.set({ marketData: event.data.market, marketDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_DARK_MARKET') {
        chrome.storage.local.set({ darkMarketData: event.data.market, darkMarketAvailable: true, darkMarketDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_SOYUZ_MARKET') {
        chrome.storage.local.set({ soyuzMarketData: event.data.market, soyuzMarketAvailable: true, soyuzMarketDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_USOL_MARKET') {
        chrome.storage.local.set({ usolMarketData: event.data.market, usolMarketAvailable: true, usolMarketDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_LOADOUT') {
        chrome.storage.local.set({ loadoutData: event.data.loadout, loadoutAction: event.data.action, loadoutUpdatedAt: now, loadoutError: null });
    }
    if (event.data && event.data.type === 'COR3_WS_LOADOUT_ERROR') {
        chrome.storage.local.set({ loadoutError: event.data.error, loadoutErrorAction: event.data.action, loadoutUpdatedAt: now });
    }
    // Handle dark market unreachable — keep cached data, set flag
    if (event.data && event.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') {
        chrome.storage.local.set({ darkMarketAvailable: false, darkMarketDataUpdatedAt: now, darkMarketMaintenanceEndsAt: event.data.maintenanceEndsAt || null, darkMarketBlockerServer: event.data.blockerServerName || null });
    }
    if (event.data && event.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE') {
        chrome.storage.local.set({ soyuzMarketAvailable: false, soyuzMarketDataUpdatedAt: now, soyuzMarketMaintenanceEndsAt: event.data.maintenanceEndsAt || null, soyuzMarketBlockerServer: event.data.blockerServerName || null });
    }
    if (event.data && event.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
        chrome.storage.local.set({ usolMarketAvailable: false, usolMarketDataUpdatedAt: now, usolMarketMaintenanceEndsAt: event.data.maintenanceEndsAt || null, usolMarketBlockerServer: event.data.blockerServerName || null });
    }
    if (event.data && event.data.type === 'COR3_BEARER_TOKEN') {
        chrome.storage.local.get('bearerToken', (prev) => {
            const isNew = !prev.bearerToken || prev.bearerToken !== event.data.token;
            chrome.storage.local.set({ bearerToken: event.data.token });
            if (isNew) {
                fetch('https://svc-corie.cor3.gg/api/user-daily-claim', {
                    headers: { 'Authorization': event.data.token }
                })
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data) chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now(), dailyOpsError: null }); })
                .catch(() => {});
            }
        });
    }
    // Store web version and system version
    if (event.data && event.data.type === 'COR3_WEB_VERSION') {
        chrome.storage.local.set({ webVersion: event.data.version });
    }
    if (event.data && event.data.type === 'COR3_SYSTEM_VERSION') {
        chrome.storage.local.set({ systemVersion: event.data.version });
    }
    if (event.data && event.data.type === 'COR3_PATCH_VERSION') {
        chrome.storage.local.set({ patchVersion: event.data.version });
    }
    // Store daily rewards data for streak bonus calculation
    if (event.data && event.data.type === 'COR3_DAILY_REWARDS') {
        chrome.storage.local.set({ dailyRewardsData: event.data.rewards });
    }
    // Store archived expeditions
    if (event.data && event.data.type === 'COR3_WS_ARCHIVED_EXPEDITIONS') {
        chrome.storage.local.set({ archivedExpeditionsData: event.data.data, archivedExpeditionsUpdatedAt: now });
    }
    // Store mercenary data
    if (event.data && event.data.type === 'COR3_WS_MERCENARIES') {
        chrome.storage.local.set({ mercenariesData: event.data.data, mercenariesUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_CORE_MERCS_DONE') {
        chrome.storage.local.set({ coreMercsDone: Date.now() });
    }
    if (event.data && event.data.type === 'COR3_USOL_MERCS_DONE') {
        chrome.storage.local.set({ usolMercsDone: Date.now() });
        initialMercsReady = true;
    }
    // Store USOL mercenary data
    if (event.data && event.data.type === 'COR3_WS_USOL_MERCENARIES') {
        chrome.storage.local.set({ usolMercenariesData: event.data.data, usolMercenariesUpdatedAt: now });
    }
    // Store expedition config data
    if (event.data && event.data.type === 'COR3_WS_EXPEDITION_CONFIG') {
        chrome.storage.local.set({ expeditionConfigData: event.data.data, expeditionConfigUpdatedAt: now });
    }
    // Store USOL expedition config data
    if (event.data && event.data.type === 'COR3_WS_USOL_EXPEDITION_CONFIG') {
        chrome.storage.local.set({ usolExpeditionConfigData: event.data.data, usolExpeditionConfigUpdatedAt: now });
    }
    // Store mercenary configure data (cost/risk per mercenary)
    if (event.data && event.data.type === 'COR3_WS_MERC_CONFIGURE' && event.data.mercenaryId) {
        chrome.storage.local.get('mercConfigData', (result) => {
            const configs = result.mercConfigData || {};
            configs[event.data.mercenaryId] = event.data.data;
            chrome.storage.local.set({ mercConfigData: configs, mercConfigUpdatedAt: now });
        });
    }
    // Auto-send: container opened — check inventory space before collecting all
    if (event.data && event.data.type === 'COR3_WS_CONTAINER_OPENED') {
        if (autoSendInProgress && autoSendExpeditionId) {
            console.log('[COR3 Helper] Auto-send: Container opened, checking inventory space...');
            const containerData = event.data.data;

            // Calculate space needed based on container contents
            let spaceNeeded = 2; // Default fallback
            if (containerData && containerData.items && Array.isArray(containerData.items)) {
                spaceNeeded = containerData.items.length;
                console.log('[COR3 Helper] Container contains', spaceNeeded, 'items');
            } else if (containerData && containerData.containerItems && Array.isArray(containerData.containerItems)) {
                spaceNeeded = containerData.containerItems.length;
                console.log('[COR3 Helper] Container contains', spaceNeeded, 'items (containerItems)');
            }

            // Check stash data to ensure we have enough space
            chrome.storage.local.get('stashData', (result) => {
                const stash = result.stashData;
                let hasSpace = true;

                if (stash && stash.maxCapacity && stash.currentUsage !== undefined) {
                    const availableSpace = stash.maxCapacity - stash.currentUsage;
                    hasSpace = availableSpace >= spaceNeeded;
                    console.log('[COR3 Helper] Inventory check:', availableSpace, 'available, need', spaceNeeded);
                }

                if (hasSpace) {
                    console.log('[COR3 Helper] Auto-send: Sufficient space, collecting all in 10s...');
                    setTimeout(() => {
                        window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: autoSendExpeditionId }, '*');
                    }, 10000 + Math.floor(Math.random() * 500));
                } else {
                    // Check if auto-sell cheapest is enabled
                    chrome.storage.sync.get('autoSellCheapest', (sellData) => {
                        if (sellData.autoSellCheapest && stash && stash.items) {
                            const availableSpace = stash.maxCapacity - stash.currentUsage;
                            const shortfall = spaceNeeded - availableSpace;
                            console.log('[COR3 Helper] Auto-sell: need', shortfall, 'more slot(s), selling cheapest items');
                            autoSellCheapestItems(stash.items, shortfall, () => {
                                // After selling, refresh stash then retry collect
                                window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
                                setTimeout(() => {
                                    console.log('[COR3 Helper] Auto-sell done, collecting all in 10s...');
                                    setTimeout(() => {
                                        window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: autoSendExpeditionId }, '*');
                                    }, 10000 + Math.floor(Math.random() * 500));
                                }, 3000);
                            });
                        } else {
                            console.log('[COR3 Helper] Auto-send: Insufficient space, disabling auto-container-claim');
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
                            const availableSpace2 = stash ? stash.maxCapacity - stash.currentUsage : 0;
                            window.postMessage({
                                type: 'COR3_STASH_FULL_WARNING',
                                message: `Stash is full. Need ${spaceNeeded} spaces but only ${availableSpace2} available. Clear stash before claiming more items. Auto-send mercenary disabled.`
                            }, '*');
                            autoSendInProgress = false;
                            _automationFinish('auto-send');
                        }
                    });
                }
            });
        }
    }
    // Handle stash full error from collect.all
    if (event.data && event.data.type === 'COR3_WS_STASH_FULL') {
        console.log('[COR3 Helper] Stash full error detected');
        chrome.storage.sync.get('autoSellCheapest', (sellData) => {
            if (sellData.autoSellCheapest) {
                // Try to auto-sell cheapest items and retry
                chrome.storage.local.get('stashData', (result) => {
                    const stash = result.stashData;
                    if (stash && stash.items) {
                        console.log('[COR3 Helper] Auto-sell: selling cheapest items to free space after collect.all stash-full');
                        autoSellCheapestItems(stash.items, 5, () => {
                            window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
                            setTimeout(() => {
                                if (autoSendExpeditionId) {
                                    console.log('[COR3 Helper] Auto-sell done, retrying collect all in 10s...');
                                    setTimeout(() => {
                                        window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: autoSendExpeditionId }, '*');
                                    }, 10000 + Math.floor(Math.random() * 500));
                                }
                            }, 3000);
                        });
                    } else {
                        disableAutoSendDueToStashFull();
                    }
                });
            } else {
                disableAutoSendDueToStashFull();
            }
        });
    }
    // Handle insufficient credits error from expedition launch
    if (event.data && event.data.type === 'COR3_WS_INSUFFICIENT_CREDITS') {
        console.log('[COR3 Helper] Insufficient credits for expedition launch, disabling auto-send mercenary');
        // Disable auto-send temporarily due to insufficient credits
        chrome.storage.sync.get('autoSendMerc', (settings) => {
            if (settings.autoSendMerc) {
                chrome.storage.sync.set({
                    autoSendMerc: {
                        ...settings.autoSendMerc,
                        enabled: false,
                        disabledReason: 'insufficient_credits'
                    }
                });
            }
        });
        chrome.storage.local.set({
            expeditionLaunchError: {
                error: 'Insufficient credits to launch expedition',
                retryAfter: 0,
                timestamp: Date.now(),
                noRetry: true
            }
        });
        autoSendInProgress = false;
        _automationFinish('auto-send');
        autoSendExpeditionId = null;
    }
    // Handle insufficient credits error during reward container opening (collect.all)
    if (event.data && event.data.type === 'COR3_WS_COLLECT_INSUFFICIENT_CREDITS') {
        console.log('[COR3 Helper] Insufficient credits for collect.all, disabling auto-send mercenary');
        chrome.storage.sync.get('autoSendMerc', (settings) => {
            if (settings.autoSendMerc) {
                chrome.storage.sync.set({
                    autoSendMerc: {
                        ...settings.autoSendMerc,
                        enabled: false,
                        disabledReason: 'insufficient_credits'
                    }
                });
            }
        });
        chrome.storage.local.set({
            expeditionLaunchError: {
                error: 'Insufficient credits to open reward container. Auto-send disabled.',
                retryAfter: 0,
                timestamp: Date.now(),
                noRetry: true
            }
        });
        autoSendInProgress = false;
        _automationFinish('auto-send');
        autoSendExpeditionId = null;
    }
    // Expedition archived — clear active expedition data since it's now in the archive
    if (event.data && event.data.type === 'COR3_WS_EXPEDITION_ARCHIVED') {
        chrome.storage.local.get('expeditionsData', (result) => {
            var exps = result.expeditionsData;
            if (Array.isArray(exps) && event.data.data && event.data.data.expeditionId) {
                var filtered = exps.filter(function (e) { return e.id !== event.data.data.expeditionId; });
                chrome.storage.local.set({ expeditionsData: filtered, expeditionsDataUpdatedAt: Date.now() });
            }
        });
    }
    // Auto-send: collected all — proceed to get mercenaries and launch
    if (event.data && event.data.type === 'COR3_WS_COLLECTED_ALL') {
        if (autoSendInProgress && autoSendExpeditionId) {
            console.log('[COR3 Helper] Auto-send: All collected, refreshing mercenaries (CORE + USOL)...');
            autoSendExpeditionId = null; // done with old expedition
            // Refresh stash in background
            setTimeout(() => {
                window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
            }, 500);
            // Refresh CORE mercs first, then USOL mercs, then select+launch
            var mercDelay = 2500 + Math.floor(Math.random() * 1000);
            setTimeout(() => {
                window.postMessage({ type: 'COR3_REQUEST_MERCENARIES' }, '*');
            }, mercDelay);
            // USOL mercs after CORE mercs complete — listen for COR3_CORE_MERCS_DONE
            autoSendAwaitingMercenaries = false; // don't select on CORE done yet
            autoSendAwaitingUsolMercs = true; // flag: need USOL mercs before selecting
        }
    }
    // Auto-send: CORE mercs done, now chain to USOL mercs before selecting
    if (event.data && event.data.type === 'COR3_CORE_MERCS_DONE' && autoSendAwaitingUsolMercs) {
        autoSendAwaitingUsolMercs = false;
        console.log('[COR3 Helper] Auto-send: CORE mercs refreshed, now fetching USOL mercs...');
        setTimeout(() => {
            window.postMessage({ type: 'COR3_REQUEST_USOL_MERCENARIES' }, '*');
        }, 500);
        // Listen for USOL mercs done, then trigger selection
        function onUsolMercsDoneForAutoSend(evt) {
            if (evt.data && evt.data.type === 'COR3_USOL_MERCS_DONE') {
                window.removeEventListener('message', onUsolMercsDoneForAutoSend);
                clearTimeout(usolMercsTimeout);
                console.log('[COR3 Helper] Auto-send: USOL mercs refreshed, proceeding to select merc');
                autoSendAwaitingMercenaries = true;
                window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
            }
        }
        window.addEventListener('message', onUsolMercsDoneForAutoSend);
        var usolMercsTimeout = setTimeout(() => {
            window.removeEventListener('message', onUsolMercsDoneForAutoSend);
            console.log('[COR3 Helper] Auto-send: USOL mercs timeout — proceeding with CORE mercs only');
            autoSendAwaitingMercenaries = true;
            window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
        }, 30000);
    }
    // Auto-send: all merc configures done — now select merc and launch
    if (event.data && event.data.type === 'COR3_CORE_MERCS_DONE' && autoSendAwaitingMercenaries) {
        autoSendAwaitingMercenaries = false;
        chrome.storage.sync.get('autoSendMerc', (settings) => {
            if (!settings.autoSendMerc || !settings.autoSendMerc.enabled) {
                console.log('[COR3 Helper] Auto-send: disabled, aborting');
                autoSendInProgress = false;
                _automationFinish('auto-send');
                return;
            }
            // Gather CORE and USOL mercs from storage (configures are done, data is fresh)
            chrome.storage.local.get(['mercenariesData', 'usolMercenariesData', 'mercConfigData', 'expeditionConfigData', 'usolExpeditionConfigData'], (localData) => {
                let coreMercs = [];
                const coreRaw = localData.mercenariesData;
                if (coreRaw) {
                    if (coreRaw.mercenaries) coreMercs = coreRaw.mercenaries;
                    else if (Array.isArray(coreRaw)) coreMercs = coreRaw;
                }
                // Tag CORE mercs
                coreMercs.forEach(m => { m._market = 'core'; });
                // Also include elite mercs from CORE data
                const coreElite = (coreRaw && coreRaw.eliteSlots) || [];
                coreElite.forEach(es => {
                    if (es.mercenary && !coreMercs.find(m => m.id === es.mercenary.id)) {
                        es.mercenary._market = 'core'; es.mercenary._isElite = true;
                        coreMercs.push(es.mercenary);
                    }
                });
                let usolMercs = [];
                const usolData = localData.usolMercenariesData;
                if (usolData) {
                    let raw = usolData;
                    if (raw && !Array.isArray(raw) && raw.mercenaries) usolMercs = raw.mercenaries;
                    else if (Array.isArray(raw)) usolMercs = raw;
                    usolMercs.forEach(m => { m._market = 'usol'; });
                    // Include elite USOL mercs
                    const usolElite = (usolData && usolData.eliteSlots) || [];
                    usolElite.forEach(es => {
                        if (es.mercenary && !usolMercs.find(m => m.id === es.mercenary.id)) {
                            es.mercenary._market = 'usol'; es.mercenary._isElite = true;
                            usolMercs.push(es.mercenary);
                        }
                    });
                }

                const allMercs = [...coreMercs, ...usolMercs];
                let mercId = settings.autoSendMerc.mercenaryId;

                // If auto-choose mercenary is enabled, pick from all markets
                if (settings.autoSendMerc.autoChooseMerc) {
                    const configs = localData.mercConfigData || {};
                    const ignoreElite = !!settings.autoSendMerc.ignoreEliteMerc;
                    const usolFirst = !!settings.autoSendMerc.autoChooseUsolFirst;
                    // Build elite ID set
                    const eliteIds = new Set();
                    coreElite.forEach(es => { if (es.mercenary) eliteIds.add(es.mercenary.id); });
                    const usolElite2 = (usolData && usolData.eliteSlots) || [];
                    usolElite2.forEach(es => { if (es.mercenary) eliteIds.add(es.mercenary.id); });
                    allMercs.forEach(m => { if (!m._isElite) m._isElite = eliteIds.has(m.id); });

                    let available = allMercs.filter(m => m.status === 'AVAILABLE' && configs[m.id]);
                    if (ignoreElite) available = available.filter(m => !m._isElite);
                    if (available.length > 0) {
                        available.sort((a, b) => {
                            if (usolFirst) {
                                if (a._market === 'usol' && b._market !== 'usol') return -1;
                                if (a._market !== 'usol' && b._market === 'usol') return 1;
                            }
                            const costA = (configs[a.id] && configs[a.id].totalCost) || Infinity;
                            const costB = (configs[b.id] && configs[b.id].totalCost) || Infinity;
                            if (costA !== costB) return costA - costB;
                            const riskA = (configs[a.id] && configs[a.id].riskScore) || 0;
                            const riskB = (configs[b.id] && configs[b.id].riskScore) || 0;
                            if (riskA !== riskB) return riskA - riskB;
                            if (a._market === 'usol' && b._market !== 'usol') return -1;
                            if (a._market !== 'usol' && b._market === 'usol') return 1;
                            return 0;
                        });
                        mercId = available[0].id;
                        console.log('[COR3 Helper] Auto-choose merc: selected', available[0].callsign, '(' + available[0]._market + ') cost:', configs[available[0].id].totalCost);
                    }
                }
                proceedWithMerc(mercId, allMercs, settings, localData);
            });
        });

        function proceedWithMerc(mercId, allMercs, settings, localData) {
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
            // Determine market and config based on merc's market tag
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
            const loc = config.locations[0];
            const zone = loc.zones && loc.zones[0] ? loc.zones[0] : null;
            const goal = zone && zone.goals && zone.goals[0] ? zone.goals[0] : null;
            if (!zone || !goal) {
                console.log('[COR3 Helper] Auto-send: missing zone/goal config, aborting');
                autoSendInProgress = false;
                _automationFinish('auto-send');
                return;
            }
            const launchConfig = {
                mercenaryId: mercId,
                marketId: marketId,
                locationConfigId: loc.id,
                zoneConfigId: zone.id,
                goalId: goal.id,
                hasInsurance: false
            };
            console.log('[COR3 Helper] Auto-send: launching expedition with mercenary:', selectedMerc.callsign, '(' + (isUsol ? 'USOL' : 'CORE') + ')');
            setTimeout(() => {
                chrome.storage.local.set({ lastExpeditionLaunchData: launchConfig });
                window.postMessage({ type: 'COR3_LAUNCH_EXPEDITION', config: launchConfig }, '*');
                autoSendInProgress = false;
                _automationFinish('auto-send');
            }, 1500 + Math.floor(Math.random() * 500));
        }
    }
    // Auto-send: expedition launched confirmation
    if (event.data && event.data.type === 'COR3_WS_EXPEDITION_LAUNCHED') {
        console.log('[COR3 Helper] Expedition launched successfully');
    }
    // Handle expedition launch error
    if (event.data && event.data.type === 'COR3_WS_EXPEDITION_LAUNCH_ERROR') {
        console.log('[COR3 Helper] Expedition launch error:', event.data.error);
        if (event.data.error === 'Maximum 1 active expedition allowed') {
            // Silently abort — an expedition is already active.
            // Reset auto-send state so the normal flow re-triggers when the
            // active expedition completes and fresh expedition data arrives.
            console.log('[COR3 Helper] Active expedition detected — silently waiting for it to finish');
            autoSendInProgress = false;
            _automationFinish('auto-send');
            autoSendExpeditionId = null;
        } else {
            // Store other errors for UI display
            chrome.storage.local.set({
                expeditionLaunchError: {
                    error: event.data.error,
                    retryAfter: event.data.retryAfter,
                    timestamp: Date.now()
                }
            });
            // Clear any previous successful launch message
            chrome.storage.local.remove('expeditionLaunched');
        }
    }
    // Handle expedition launch retry
    if (event.data && event.data.type === 'COR3_WS_EXPEDITION_RETRY_LAUNCH') {
        console.log('[COR3 Helper] Retrying expedition launch');
        chrome.storage.local.get('lastExpeditionLaunchData', (result) => {
            if (result.lastExpeditionLaunchData) {
                // Retry the expedition launch with the same data
                window.postMessage({
                    type: 'COR3_RELAUNCH_EXPEDITION',
                    data: result.lastExpeditionLaunchData
                }, '*');
            }
        });
    }
    // Relay daily hack log messages to storage for popup to read
    if (event.data && event.data.type === 'COR3_DAILY_HACK_LOG') {
        chrome.storage.local.set({
            dailyHackLog: event.data.message,
            dailyHackLogUpdatedAt: Date.now()
        });
    }
    // Auto-disable daily hack toggle after completion or failure
    if (event.data && event.data.type === 'COR3_DAILY_HACK_DISABLE_TOGGLE') {
        chrome.storage.sync.set({ autoDailyHackEnabled: false });
    }
    // Auto-fetch daily ops on page load (triggered from content-early.js)
    if (event.data && event.data.type === 'COR3_FETCH_DAILY_OPS') {
        console.log('[COR3 Helper] Requesting daily ops data');
        chrome.storage.local.get('bearerToken', (result) => {
            const token = result.bearerToken;
            if (!token) return;
            fetch('https://svc-corie.cor3.gg/api/user-daily-claim', {
                headers: { 'Authorization': token }
            })
            .then(r => {
                if (r.ok) return r.json();
                if (r.status === 400 || r.status === 401 || r.status === 403) {
                    chrome.storage.local.set({ dailyOpsError: 'token_expired', dailyOpsErrorUpdatedAt: Date.now() });
                    return null;
                }
                return null;
            })
            .then(data => {
                if (data) {
                    chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now(), dailyOpsError: null });
                    // Also fetch rewards for streak bonus calculation
                    fetchDailyRewards(token);
                }
            })
            .catch(() => {});
        });
    }
});

// Fetch daily claim rewards for streak bonus calculation
function fetchDailyRewards(token) {
    fetch('https://svc-corie.cor3.gg/api/user-daily-claim/rewards', {
        headers: { 'Authorization': token }
    })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
        if (data && Array.isArray(data)) {
            chrome.storage.local.set({ dailyRewardsData: data });
        }
    })
    .catch(() => {});
}

// --- Auto-Choose Decisions (content-side, works even when popup is closed) ---
const contentAutoChosenDecisions = new Set();
function checkAutoChooseFromContent(decisions) {
    if (!decisions || decisions.length === 0) return;
    chrome.storage.sync.get('decisionModifiers', (result) => {
        const mods = result.decisionModifiers;
        if (!mods || !mods.autoChoose) return;
        const noWait = !!mods.noWaitAutoChoose;
        const lootMod = mods.enabled !== false ? (mods.loot ?? 3) : 1;
        const riskMod = mods.enabled !== false ? (mods.risk ?? -2) : -1;
        for (const d of decisions) {
            if (d.isResolved || !d.decisionDeadline || !Array.isArray(d.decisionOptions)) continue;
            if (contentAutoChosenDecisions.has(d.messageId)) continue;
            const dl = new Date(d.decisionDeadline);
            const remaining = dl - Date.now();
            if (remaining <= 0) continue;
            if (!noWait && remaining > 60000) continue;
            let bestOpt = null;
            let bestScore = -Infinity;
            for (const opt of d.decisionOptions) {
                const score = Math.round((opt.lootModifier * lootMod) + ((opt.riskModifier * riskMod) * (((d.riskScore + Math.abs(opt.riskModifier)) / 10) || 1)));
                if (score > bestScore) { bestScore = score; bestOpt = opt; }
            }
            if (bestOpt) {
                contentAutoChosenDecisions.add(d.messageId);
                console.log('[COR3 Helper] Auto-choose (content): picking "' + bestOpt.label + '" (score: ' + bestScore + ')');
                window.postMessage({
                    type: 'COR3_RESPOND_DECISION',
                    expeditionId: d.expeditionId,
                    messageId: d.messageId,
                    selectedOption: bestOpt.id
                }, '*');
            }
        }
    });
}

// --- Auto-Send Mercenary State ---
let autoSendInProgress = false;
let autoSendExpeditionId = null;
let autoSendAwaitingMercenaries = false;
let autoSendAwaitingUsolMercs = false;
// Flag: initial page load merc fetch complete (set when COR3_USOL_MERCS_DONE received from initial fetch)
let initialMercsReady = false;
// Flag: deferral listener already registered (prevent duplicate listeners from multiple callers)
let autoSendDeferredWaiting = false;

function checkAutoSendOnExpeditionData(expeditions) {
    if (!expeditions || !Array.isArray(expeditions) || autoSendInProgress) return;
    if (_automationActive && _automationActive.type !== 'auto-send') {
        if (!_automationQueue.some(q => q.type === 'auto-send')) {
            console.log('[COR3 Helper] Auto-send: queued (waiting for', _automationActive.type, 'to finish)');
            _automationQueue.push({ type: 'auto-send', run: function () {
                chrome.storage.local.get('expeditionsData', (result) => {
                    _automationActive = null;
                    if (result.expeditionsData) {
                        checkAutoSendOnExpeditionData(result.expeditionsData);
                    } else {
                        _automationProcessNext();
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

        // Check for no active expeditions case
        const hasActiveExpeditions = expeditions.length > 0;
        if (!hasActiveExpeditions) {
            // During initial page load, defer merc requests until initial fetch has loaded all mercs
            if (!initialMercsReady) {
                // Only register deferral listener once — multiple callers (message listener + 5s timeout) would otherwise duplicate
                if (autoSendDeferredWaiting) {
                    console.log('[COR3 Helper] Auto-send: Already waiting for initial mercs — skipping duplicate deferral');
                    return;
                }
                autoSendDeferredWaiting = true;
                console.log('[COR3 Helper] Auto-send: No active expeditions but initial mercs not ready — deferring');
                // Listen for initial merc fetch completion, then re-check
                function onInitialMercsDone(evt) {
                    if (evt.data && evt.data.type === 'COR3_USOL_MERCS_DONE') {
                        window.removeEventListener('message', onInitialMercsDone);
                        clearTimeout(deferTimeout);
                        autoSendDeferredWaiting = false;
                        console.log('[COR3 Helper] Auto-send: Initial mercs now ready — re-checking expeditions');
                        initialMercsReady = true;
                        // Re-check with fresh expedition data from storage
                        chrome.storage.local.get('expeditionsData', (result) => {
                            if (result.expeditionsData) {
                                checkAutoSendOnExpeditionData(result.expeditionsData);
                            }
                        });
                    }
                }
                window.addEventListener('message', onInitialMercsDone);
                // Safety timeout: if initial mercs take too long, proceed anyway
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
            if (!_automationActive) _automationActive = { type: 'auto-send', startedAt: Date.now() };
            _broadcastQueueStatus();
            autoSendExpeditionId = null;
            autoSendAwaitingMercenaries = false;
            autoSendAwaitingUsolMercs = true;
            var mercDelay = 2500 + Math.floor(Math.random() * 1000);
            setTimeout(() => {
                window.postMessage({ type: 'COR3_REQUEST_MERCENARIES' }, '*');
            }, mercDelay);
            return;
        }

        // Look for a COMPLETED expedition that hasn't been fully collected yet
        for (const exp of expeditions) {
            if (exp.status === 'COMPLETED' && !exp.completedAt) {
                autoSendInProgress = true;
                if (!_automationActive) _automationActive = { type: 'auto-send', startedAt: Date.now() };
                _broadcastQueueStatus();
                autoSendExpeditionId = exp.id;
                if (!exp.containerOpenedAt) {
                    // Container not opened yet — Step 1: open container (10s delay for UI visibility)
                    console.log('[COR3 Helper] Auto-send: Detected COMPLETED expedition:', exp.id, '- opening container in 10s');
                    setTimeout(() => {
                        window.postMessage({ type: 'COR3_OPEN_CONTAINER', expeditionId: exp.id }, '*');
                    }, 10000 + Math.floor(Math.random() * 500));
                } else {
                    // Container already opened but not collected — Step 2: collect all (10s delay for UI visibility)
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

let alarms = []; // array of alarm objects from storage
let alarmTriggered = {}; // keyed by alarm id
let audioContext = null;
let continuousInterval = null;
let isAlarmActive = false;

// Load alarms
chrome.storage.sync.get('alarms', (data) => {
    alarms = data.alarms || [];
});

function playAlarm(volumePercent) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(volumePercent / 100, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(now + 0.5);
}

function startContinuousAlarm(volume) {
    if (continuousInterval) clearInterval(continuousInterval);
    isAlarmActive = true;
    chrome.runtime.sendMessage({ action: "alarmActiveStatus", isActive: true }).catch(()=>{});
    playAlarm(volume);
    continuousInterval = setInterval(() => {
        playAlarm(volume);
    }, 2000);
}

function stopAlarm() {
    if (continuousInterval) {
        clearInterval(continuousInterval);
        continuousInterval = null;
    }
    isAlarmActive = false;
    chrome.runtime.sendMessage({ action: "alarmActiveStatus", isActive: false }).catch(()=>{});
}

function getTimerRemainingSeconds(timerSource) {
    return new Promise((resolve) => {
        if (!isContextValid()) { resolve(null); return; }
        if (timerSource === 'daily') {
            chrome.storage.local.get('dailyOpsData', (result) => {
                if (result.dailyOpsData && result.dailyOpsData.nextTaskTime) {
                    const diff = new Date(result.dailyOpsData.nextTaskTime).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'home_jobs') {
            chrome.storage.local.get('marketData', (result) => {
                if (result.marketData && result.marketData.nextJobsResetAt) {
                    const diff = new Date(result.marketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'dark_jobs') {
            chrome.storage.local.get('darkMarketData', (result) => {
                if (result.darkMarketData && result.darkMarketData.nextJobsResetAt) {
                    const diff = new Date(result.darkMarketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'soyuz_jobs') {
            chrome.storage.local.get('soyuzMarketData', (result) => {
                if (result.soyuzMarketData && result.soyuzMarketData.nextJobsResetAt) {
                    const diff = new Date(result.soyuzMarketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'usol_jobs') {
            chrome.storage.local.get('usolMarketData', (result) => {
                if (result.usolMarketData && result.usolMarketData.nextJobsResetAt) {
                    const diff = new Date(result.usolMarketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource.startsWith('exp_')) {
            const expId = timerSource.substring(4);
            chrome.storage.local.get('expeditionsData', (result) => {
                const exps = result.expeditionsData || [];
                const exp = exps.find(e => e.id === expId);
                if (exp && exp.endTime) {
                    const diff = new Date(exp.endTime).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
		} else {
            resolve(null);
        }
    });
}

// Interval IDs — stored so we can clear them on context invalidation
let alarmsIntervalId = null;
let autoRefreshIntervalId = null;

function clearAllIntervals() {
    if (alarmsIntervalId) { clearInterval(alarmsIntervalId); alarmsIntervalId = null; }
    if (autoRefreshIntervalId) { clearInterval(autoRefreshIntervalId); autoRefreshIntervalId = null; }
}

async function checkAlarms() {
    try {
        if (!isContextValid()) return; // Skip cycle, keep interval alive
        for (const alarm of alarms) {
            if (!alarm.enabled || alarm.thresholdSeconds <= 0) continue;
            const remaining = await getTimerRemainingSeconds(alarm.timerSource);
            if (remaining === null) continue;

            if (remaining <= alarm.thresholdSeconds && remaining > 0 && !alarmTriggered[alarm.id]) {
                alarmTriggered[alarm.id] = true;
                if (alarm.continuous) {
                    startContinuousAlarm(alarm.volume);
                } else {
                    playAlarm(alarm.volume);
                }
            } else if (remaining > alarm.thresholdSeconds) {
                alarmTriggered[alarm.id] = false;
            }
        }
    } catch (e) {
        // Don't kill intervals on context invalidation — just skip this cycle
        if (e.message && e.message.includes('Extension context invalidated')) return;
    }
}

// Check alarms every second
alarmsIntervalId = setInterval(() => checkAlarms(), 1000);

// --- Auto-Refresh for Market Job Timers ---
let autoRefreshSettings = { home_jobs: false, dark_jobs: false, soyuz_jobs: false, usol_jobs: false };
let autoRefreshRetryPending = { home_jobs: false, dark_jobs: false, soyuz_jobs: false, usol_jobs: false };
let autoRefreshExpiredRetryAt = { home_jobs: 0, dark_jobs: 0, soyuz_jobs: 0, usol_jobs: 0 }; // timestamp when next expired retry is allowed

// Load auto-refresh settings on startup
try { chrome.storage.sync.get('autoRefresh', (data) => {
    if (data.autoRefresh) autoRefreshSettings = data.autoRefresh;
}); } catch (e) {}

// Keep auto-refresh settings in sync when changed from popup (even if popup doesn't send updateAutoRefresh)
try { chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.autoRefresh && changes.autoRefresh.newValue) {
        autoRefreshSettings = changes.autoRefresh.newValue;
    }
    if (area === 'sync' && changes.autoUpdateMarkets !== undefined) {
        const wasOff = !_autoUpdateMarkets;
        _autoUpdateMarkets = changes.autoUpdateMarkets.newValue !== false;
        // When toggled ON from OFF, check market freshness before scheduling
        if (_autoUpdateMarkets && wasOff) _initAutoUpdateMarketsTimer();
    }
    // Clear expired retry cooldown when market data arrives with a future nextJobsResetAt
    if (area === 'local') {
        const marketKeyMap = { marketData: 'home_jobs', darkMarketData: 'dark_jobs', soyuzMarketData: 'soyuz_jobs', usolMarketData: 'usol_jobs' };
        for (const [storageKey, refreshKey] of Object.entries(marketKeyMap)) {
            if (changes[storageKey] && changes[storageKey].newValue) {
                const resetAt = changes[storageKey].newValue.nextJobsResetAt;
                if (resetAt && new Date(resetAt).getTime() > Date.now()) {
                    autoRefreshExpiredRetryAt[refreshKey] = 0; // timer updated — clear cooldown
                }
            }
        }
        // Relay background/popup console logs to IndexedDB
        if (changes.cor3_console_logs && changes.cor3_console_logs.newValue) {
            const oldLen = (changes.cor3_console_logs.oldValue || []).length;
            const newEntries = changes.cor3_console_logs.newValue.slice(oldLen);
            const bgPopupEntries = newEntries.filter(e => e.source !== 'content');
            if (bgPopupEntries.length > 0) {
                try {
                    for (const e of bgPopupEntries) {
                        cor3LogEntry('ext-console', '[' + (e.source || 'unknown') + '] ' + (e.args || ''), e.level || 'log');
                    }
                } catch (err) { /* silently ignore */ }
            }
        }
    }
}); } catch (e) {}

function getMarketTimerSeconds(which) {
    return new Promise((resolve) => {
        if (!isContextValid()) { resolve(null); return; }
        try {
            const key = which === 'home_jobs' ? 'marketData' : which === 'usol_jobs' ? 'usolMarketData' : which === 'soyuz_jobs' ? 'soyuzMarketData' : 'darkMarketData';
            chrome.storage.local.get(key, (result) => {
                const data = result[key];
                if (data && data.nextJobsResetAt) {
                    const diff = new Date(data.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } catch (e) { resolve(null); }
    });
}

async function checkAutoRefresh() {
    try {
        // When context is invalid, we can't read storage but auto-refresh uses
        // window.postMessage which still works. Skip storage-dependent timer checks
        // but keep the interval alive so it resumes if context is restored (page reload).
        if (!isContextValid()) return;
        if (_seqRefreshRunning || _autoJobsActive) return;

        // Check if ANY enabled market timer hit 0 (with 60s retry cooldown for expired timers)
        let needsRefresh = false;
        let expiredMarkets = [];
        const now = Date.now();
        for (const key of ['home_jobs', 'dark_jobs', 'soyuz_jobs', 'usol_jobs']) {
            if (!autoRefreshSettings[key]) continue;
            if (autoRefreshRetryPending[key]) continue;

            const sec = await getMarketTimerSeconds(key);
            if (sec !== null && sec <= 0) {
                // If timer is expired, only retry if 60s cooldown has passed
                if (autoRefreshExpiredRetryAt[key] && now < autoRefreshExpiredRetryAt[key]) continue;
                needsRefresh = true;
                expiredMarkets.push(key);
            }
        }

        if (needsRefresh) {
            _seqRefreshRunning = true;
            // Mark expired markets as pending and set 60s retry cooldown
            for (const key of expiredMarkets) {
                autoRefreshRetryPending[key] = true;
                autoRefreshExpiredRetryAt[key] = now + 60000; // retry again in 60s if still expired
            }

            // Build order: only include expired markets, priority: usol → soyuz → dark → home
            var order = [];
            if (expiredMarkets.includes('usol_jobs')) order.push('usol');
            if (expiredMarkets.includes('soyuz_jobs')) order.push('soyuz');
            if (expiredMarkets.includes('dark_jobs')) order.push('dark');
            if (expiredMarkets.includes('home_jobs')) order.push('home');

            // Trigger sequential refresh (one market at a time)
            _marketRefreshInProgress = true;
            _autoUpdateMarketsLastRefresh = Date.now();
            var msg = { type: 'COR3_REFRESH_ALL_MARKETS_SEQ' };
            if (order.length > 0) msg.order = order;
            window.postMessage(msg, '*');

            // After 30s max, clear the pending flags so next cycle can retry if needed
            setTimeout(() => {
                _seqRefreshRunning = false;
                for (const key of ['home_jobs', 'dark_jobs', 'soyuz_jobs', 'usol_jobs']) {
                    autoRefreshRetryPending[key] = false;
                }
            }, 30000);

            // Listen for completion signal to clear flags early
            function onAllDone(evt) {
                if (evt.data && evt.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
                    window.removeEventListener('message', onAllDone);
                    _seqRefreshRunning = false;
                    for (const key of ['home_jobs', 'dark_jobs', 'soyuz_jobs', 'usol_jobs']) {
                        autoRefreshRetryPending[key] = false;
                    }
                }
            }
            window.addEventListener('message', onAllDone);
        }
    } catch (e) {
        // Don't kill intervals on context invalidation — just skip this cycle
        if (e.message && e.message.includes('Extension context invalidated')) return;
    }
}

// Check auto-refresh every second
autoRefreshIntervalId = setInterval(() => checkAutoRefresh(), 1000);

// --- Auto Decrypt Solver ---
let decryptSolverInjected = false;

function injectDecryptSolver() {
    if (decryptSolverInjected) {
        // Solver already injected, just signal restart
        window.postMessage({ type: 'COR3_START_DECRYPT_SOLVER' }, '*');
        return;
    }
    decryptSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('decrypt-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

function stopDecryptSolver() {
    window.postMessage({ type: 'COR3_STOP_DECRYPT_SOLVER' }, '*');
    decryptSolverInjected = false;
}

// --- Auto Daily Hack Solver ---
let dailyHackInjected = false;

function injectDailyHackSolver() {
    if (dailyHackInjected) {
        window.postMessage({ type: 'COR3_STOP_DAILY_HACK' }, '*');
        dailyHackInjected = false;
        setTimeout(() => injectDailyHackSolver(), 300);
        return;
    }
    dailyHackInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('daily-hack-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

function stopDailyHackSolver() {
    window.postMessage({ type: 'COR3_STOP_DAILY_HACK' }, '*');
    dailyHackInjected = false;
}

// --- Auto ICE Wall Solver ---
let iceWallSolverInjected = false;

function injectIceWallSolver() {
    if (iceWallSolverInjected) {
        // Solver already injected, just signal restart
        window.postMessage({ type: 'COR3_START_ICE_WALL_SOLVER' }, '*');
        return;
    }
    iceWallSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('ice-wall-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

function stopIceWallSolver() {
    window.postMessage({ type: 'COR3_STOP_ICE_WALL_SOLVER' }, '*');
    iceWallSolverInjected = false;
}

// --- Auto Simple Decrypt Solver ---
let simpleDecryptSolverInjected = false;

function injectSimpleDecryptSolver() {
    if (simpleDecryptSolverInjected) {
        window.postMessage({ type: 'COR3_START_SIMPLE_DECRYPT_SOLVER' }, '*');
        return;
    }
    simpleDecryptSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('simple-decrypt-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

function stopSimpleDecryptSolver() {
    window.postMessage({ type: 'COR3_STOP_SIMPLE_DECRYPT_SOLVER' }, '*');
    simpleDecryptSolverInjected = false;
}

// Auto-start solvers if they were enabled before page load
chrome.storage.sync.get(['autoDecryptEnabled', 'autoIceWallEnabled', 'autoSimpleDecryptEnabled'], (data) => {
    if (data.autoDecryptEnabled) {
        injectDecryptSolver();
    }
    if (data.autoIceWallEnabled) {
        injectIceWallSolver();
    }
    if (data.autoSimpleDecryptEnabled) {
        injectSimpleDecryptSolver();
    }
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateAlarms") {
        alarms = request.alarms || [];
        alarmTriggered = {}; // reset triggers on update
        sendResponse({ success: true });
    } else if (request.action === "testAlarm") {
        const vol = request.volume !== undefined ? request.volume : 50;
        if (request.continuous) {
            startContinuousAlarm(vol);
        } else {
            playAlarm(vol);
        }
        sendResponse({ success: true });
    } else if (request.action === "stopAlarm") {
        stopAlarm();
        sendResponse({ success: true });
    } else if (request.action === "requestExpeditions") {
        window.postMessage({ type: 'COR3_REQUEST_EXPEDITIONS' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestStash") {
        window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestLoadout") {
        window.postMessage({ type: 'COR3_REQUEST_LOADOUT' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "equipHardware") {
        window.postMessage({ type: 'COR3_EQUIP_HARDWARE', moduleConfigId: request.moduleConfigId }, '*');
        sendResponse({ success: true });
    } else if (request.action === "equipSoftware") {
        window.postMessage({ type: 'COR3_EQUIP_SOFTWARE', moduleConfigId: request.moduleConfigId }, '*');
        sendResponse({ success: true });
    } else if (request.action === "unequipSoftware") {
        window.postMessage({ type: 'COR3_UNEQUIP_SOFTWARE', moduleConfigId: request.moduleConfigId }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestMarket") {
        window.postMessage({ type: 'COR3_REQUEST_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "refreshMarket") {
        _marketRefreshInProgress = true;
        _autoUpdateMarketsLastRefresh = Date.now();
        setTimeout(() => { _marketRefreshInProgress = false; }, 10000);
        window.postMessage({ type: 'COR3_REFRESH_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestDarkMarket") {
        window.postMessage({ type: 'COR3_REQUEST_DARK_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "refreshDarkMarket") {
        _marketRefreshInProgress = true;
        _autoUpdateMarketsLastRefresh = Date.now();
        setTimeout(() => { _marketRefreshInProgress = false; }, 10000);
        window.postMessage({ type: 'COR3_REFRESH_DARK_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestSoyuzMarket") {
        window.postMessage({ type: 'COR3_REQUEST_SOYUZ_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "refreshSoyuzMarket") {
        _marketRefreshInProgress = true;
        _autoUpdateMarketsLastRefresh = Date.now();
        setTimeout(() => { _marketRefreshInProgress = false; }, 10000);
        window.postMessage({ type: 'COR3_REFRESH_SOYUZ_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestUsolMarket") {
        window.postMessage({ type: 'COR3_REQUEST_USOL_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "refreshUsolMarket") {
        _marketRefreshInProgress = true;
        _autoUpdateMarketsLastRefresh = Date.now();
        setTimeout(() => { _marketRefreshInProgress = false; }, 10000);
        window.postMessage({ type: 'COR3_REFRESH_USOL_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "refreshAllMarketsSeq") {
        _marketRefreshInProgress = true;
        _autoUpdateMarketsLastRefresh = Date.now();
        var msg = { type: 'COR3_REFRESH_ALL_MARKETS_SEQ' };
        if (request.skipLots) msg.skipLots = true;
        if (request.order) msg.order = request.order;
        window.postMessage(msg, '*');
        sendResponse({ success: true });
    } else if (request.action === "leaveStash") {
        window.postMessage({ type: 'COR3_LEAVE_STASH' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "sellItem") {
        window.postMessage({ type: 'COR3_SELL_ITEM', itemId: request.itemId, quantity: request.quantity || 1 }, '*');
        sendResponse({ success: true });
    } else if (request.action === "keepWorkerAlive") {
        window.postMessage({ type: 'COR3_KEEP_ALIVE' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "updateAutoRefresh") {
        if (request.autoRefresh) {
            autoRefreshSettings = request.autoRefresh;
        }
        sendResponse({ success: true });
    } else if (request.action === "toggleDecryptSolver") {
        if (request.enabled) {
            injectDecryptSolver();
        } else {
            stopDecryptSolver();
        }
        sendResponse({ success: true });
    } else if (request.action === "toggleIceWallSolver") {
        if (request.enabled) {
            injectIceWallSolver();
        } else {
            stopIceWallSolver();
        }
        sendResponse({ success: true });
    } else if (request.action === "toggleSimpleDecryptSolver") {
        if (request.enabled) {
            injectSimpleDecryptSolver();
        } else {
            stopSimpleDecryptSolver();
        }
        sendResponse({ success: true });
    } else if (request.action === "toggleDailyHackSolver") {
        if (request.enabled) {
            injectDailyHackSolver();
        } else {
            stopDailyHackSolver();
        }
        sendResponse({ success: true });
    } else if (request.action === "respondDecision") {
        // Relay decision response to content-early.js
        window.postMessage({
            type: 'COR3_RESPOND_DECISION',
            expeditionId: request.expeditionId,
            messageId: request.messageId,
            selectedOption: request.selectedOption
        }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestArchivedExpeditions") {
        // Request archived expeditions
        window.postMessage({ type: 'COR3_REQUEST_ARCHIVED_EXPEDITIONS' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestMercenaries") {
        window.postMessage({ type: 'COR3_REQUEST_MERCENARIES' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestUsolMercenaries") {
        window.postMessage({ type: 'COR3_REQUEST_USOL_MERCENARIES' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestExpeditionConfig") {
        window.postMessage({ type: 'COR3_REQUEST_EXPEDITION_CONFIG', mercenaryId: request.mercenaryId }, '*');
        sendResponse({ success: true });
    } else if (request.action === "launchExpedition") {
        chrome.storage.local.set({ lastExpeditionLaunchData: request.config });
        window.postMessage({ type: 'COR3_LAUNCH_EXPEDITION', config: request.config }, '*');
        sendResponse({ success: true });
    } else if (request.action === "openContainer") {
        window.postMessage({ type: 'COR3_OPEN_CONTAINER', expeditionId: request.expeditionId }, '*');
        sendResponse({ success: true });
    } else if (request.action === "collectAll") {
        window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: request.expeditionId }, '*');
        sendResponse({ success: true });
    } else if (request.action === "fetchDailyOps") {
        // Fetch daily ops in page context using stored bearer token
        chrome.storage.local.get('bearerToken', (result) => {
            const token = result.bearerToken;
            if (!token) {
                sendResponse({ error: 'no token' });
                return;
            }
            fetch('https://svc-corie.cor3.gg/api/user-daily-claim', {
                headers: { 'Authorization': token }
            })
            .then(r => {
                if (r.ok) return r.json();
                if (r.status === 400 || r.status === 401 || r.status === 403) return r.json().then(d => { throw new Error(d.message || 'token_expired'); }).catch(() => { throw new Error('token_expired'); });
                return null;
            })
            .then(data => {
                if (data) {
                    chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now() });
                    fetchDailyRewards(token);
                }
                sendResponse({ data: data });
            })
            .catch(e => { cor3LogError('content.js', e, { action: 'fetchDailyOps' }); sendResponse({ error: e.message || 'fetch failed' }); });
        });
        return true; // keep channel open for async sendResponse
    } else if (request.action === "disableBackground") {
        // Disable background elements (delete them)
        chrome.storage.sync.set({ disableBackground: true });
        deleteBackgroundElements();
        console.log('[COR3 Helper] Background elements deleted');
        sendResponse({ success: true });
    } else if (request.action === "enableBackground") {
        // Enable background elements (just clear the setting, they will be restored on page reload)
        chrome.storage.sync.set({ disableBackground: false });
        console.log('[COR3 Helper] Background elements will be restored on page reload');
        sendResponse({ success: true });
    } else if (request.action === "disableNetworkFog") {
        chrome.storage.sync.set({ disableNetworkFog: true });
        startNetworkFogObserver();
        hideNetworkFogVideos();
        console.log('[COR3 Helper] Network fog disabled');
        sendResponse({ success: true });
    } else if (request.action === "enableNetworkFog") {
        chrome.storage.sync.set({ disableNetworkFog: false });
        stopNetworkFogObserver();
        showNetworkFogVideos();
        console.log('[COR3 Helper] Network fog re-enabled');
        sendResponse({ success: true });
    } else if (request.action === "moveNotificationsLeft") {
        chrome.storage.sync.set({ moveNotificationsLeft: true });
        applyNotificationsLeft();
        console.log('[COR3 Helper] Notifications moved to left');
        sendResponse({ success: true });
    } else if (request.action === "moveNotificationsRight") {
        chrome.storage.sync.set({ moveNotificationsLeft: false });
        removeNotificationsLeft();
        console.log('[COR3 Helper] Notifications moved back to right');
        sendResponse({ success: true });
    } else if (request.action === "enableResizableNetworkMap") {
        chrome.storage.sync.set({ resizableNetworkMap: true });
        applyResizableNetworkMap();
        console.log('[COR3 Helper] Network map made resizable');
        sendResponse({ success: true });
    } else if (request.action === "disableResizableNetworkMap") {
        chrome.storage.sync.set({ resizableNetworkMap: false });
        removeResizableNetworkMap();
        console.log('[COR3 Helper] Network map resize disabled');
        sendResponse({ success: true });
    } else if (request.action === "getVersionFallbacks") {
        // Return version fallbacks from global variables
        sendResponse({
            webVersion: window.__cor3WebVersion,
            systemVersion: window.__cor3SystemVersion,
            patchVersion: window.__cor3PatchVersion
        });
    } else if (request.action === "startAutoJobs") {
        const jobs = request.jobs;
        const settings = request.settings || {};
        const result = _automationEnqueue('auto-jobs', () => {
            _autoJobsActive = true;
            injectAutoJobSolver();
            setTimeout(() => {
                window.postMessage({ type: 'COR3_AUTOJOB_START', jobs: jobs, settings: settings }, '*');
            }, 500);
        });
        sendResponse({ success: true, queueResult: result, queueStatus: _automationQueueStatus() });
    } else if (request.action === "stopAutoJobs") {
        _autoJobsActive = false;
        _automationQueue = _automationQueue.filter(q => q.type !== 'auto-jobs');
        window.postMessage({ type: 'COR3_AUTOJOB_STOP' }, '*');
        _automationFinish('auto-jobs');
        sendResponse({ success: true });
    } else if (request.action === "enableHackSolvers") {
        // Enable all hack solvers (used by background.js before hack.start)
        injectDecryptSolver();
        injectIceWallSolver();
        injectSimpleDecryptSolver();
        sendResponse({ success: true });
    } else if (request.action === "waitForHackDone") {
        // Poll DOM for hack minigame close, relay result to storage for background.js
        const maxWait = request.timeoutMs || 120000;
        let elapsed = 0;
        const interval = 500;
        function isMinigameOpen() {
            return !!(document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
                document.querySelector('[data-sentry-component="IceWallBreakApplication"]') ||
                document.querySelector('[data-component-name="WallBoard"]') ||
                document.querySelector('[data-sentry-component="ConfigHackApplication"]') ||
                document.querySelector('[data-component-name="SimpleDecryptApplication"]') ||
                document.querySelector('[data-sentry-component="SimpleDecryptApplication"]'));
        }
        function pollClose() {
            if (!isMinigameOpen()) {
                chrome.storage.local.set({ _clearIpsHackDone: { done: true, ts: Date.now() } });
                return;
            }
            elapsed += interval;
            if (elapsed >= maxWait) {
                chrome.storage.local.set({ _clearIpsHackDone: { done: false, timeout: true, ts: Date.now() } });
                return;
            }
            setTimeout(pollClose, interval);
        }
        pollClose();
        sendResponse({ success: true });
    } else if (request.action === "dismissFailedJobs") {
        // Clear failed jobs — routed through automation queue
        var dismissJobs = request.jobs || []; // [{marketId, jobId}]
        var dismissMarketKey = request.marketKey || '';
        var result = _automationEnqueue('clear-failed-jobs', function () {
            (async function () {
                try {
                    for (var i = 0; i < dismissJobs.length; i++) {
                        window.postMessage({ type: 'COR3_AUTOJOB_CMD', cmd: 'job.dismiss', data: dismissJobs[i] }, '*');
                        if (i < dismissJobs.length - 1) await new Promise(function (r) { setTimeout(r, 500); });
                    }
                    // Brief delay then finish queue slot
                    await new Promise(function (r) { setTimeout(r, 1000); });
                } catch (e) {
                    console.log('[COR3 Helper] dismissFailedJobs error:', e);
                } finally {
                    _automationFinish('clear-failed-jobs');
                }
            })();
        });
        sendResponse({ success: true, queueResult: result, queueStatus: _automationQueueStatus() });
    } else if (request.action === "autoClearIpsCmd") {
        // Relay auto-clear-ips WS commands to MAIN world
        window.postMessage({ type: 'COR3_AUTOJOB_CMD', cmd: request.cmd, data: request.data || {} }, '*');
        sendResponse({ success: true });
    } else if (request.action === "devtoolsSendWs") {
        // DevTools panel: send a raw WS message via the intercepted socket
        window.postMessage({ type: 'COR3_DEVTOOLS_WS_SEND', message: request.message }, '*');
        sendResponse({ success: true });
    } else if (request.action === "startValuableSearch") {
        const result = _automationEnqueue('auto-valuable', () => {
            injectAutoValuableSeller();
            setTimeout(() => {
                window.postMessage({ type: 'COR3_VALUABLE_START_SEARCH' }, '*');
            }, 500);
        });
        sendResponse({ success: true, queueResult: result, queueStatus: _automationQueueStatus() });
    } else if (request.action === "startValuableSeller") {
        const selServers = request.selectedServers || [];
        const selDownloads = request.selectedDownloads || [];
        const result = _automationEnqueue('auto-valuable', () => {
            injectAutoValuableSeller();
            setTimeout(() => {
                window.postMessage({
                    type: 'COR3_VALUABLE_START_SELLER',
                    selectedServers: selServers,
                    selectedDownloads: selDownloads
                }, '*');
            }, 500);
        });
        sendResponse({ success: true, queueResult: result, queueStatus: _automationQueueStatus() });
    } else if (request.action === "stopValuable") {
        _automationQueue = _automationQueue.filter(q => q.type !== 'auto-valuable');
        window.postMessage({ type: 'COR3_VALUABLE_STOP' }, '*');
        _automationFinish('auto-valuable');
        sendResponse({ success: true });
    } else if (request.action === "startIpSearch") {
        window.postMessage({ type: 'COR3_IP_SEARCH_START' }, '*');
        sendResponse({ success: true });
    }
});

// --- Background Elements Functions ---
function deleteBackgroundElements() {
    // Delete the specific background elements mentioned by the user
    const backgroundElements = [
        '#app-background',
        '#glitch-background',
        '#video-glitch',
        '#video-waves'
    ];

    backgroundElements.forEach(selector => {
        try {
            const element = document.querySelector(selector);
            if (element) {
                element.remove();
                console.log('[COR3 Helper] Deleted background element:', selector);
            }
        } catch (e) {
            // Ignore errors for elements that might not exist
        }
    });
}

// Apply background elements deletion on page load if setting is enabled
chrome.storage.sync.get('disableBackground', (result) => {
    if (result.disableBackground) {
        // Wait a bit for the page to load
        setTimeout(() => {
            deleteBackgroundElements();
        }, 1000);
    }
});

// --- Network Fog Functions ---
let networkFogObserver = null;

function isNetworkMapVisible() {
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
        if (div.textContent.trim() === 'Network map') return true;
    }
    return false;
}

function hideNetworkFogVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
        const src = v.getAttribute('src') || '';
        if (src.includes('/video/network-map/fog.mp4') || src.includes('/video/network-map/fog_layer_2.mp4')) {
            v.style.display = 'none';
            v.pause();
            v.setAttribute('data-cor3-fog-hidden', 'true');
        }
    });
}

function showNetworkFogVideos() {
    const hiddenVideos = document.querySelectorAll('[data-cor3-fog-hidden="true"]');
    hiddenVideos.forEach(v => {
        v.style.display = '';
        v.removeAttribute('data-cor3-fog-hidden');
        v.play().catch(() => {});
    });
}

function startNetworkFogObserver() {
    if (networkFogObserver) return;
    networkFogObserver = new MutationObserver(() => {
        if (isNetworkMapVisible()) {
            hideNetworkFogVideos();
        }
    });
    networkFogObserver.observe(document.body, { childList: true, subtree: true });
}

function stopNetworkFogObserver() {
    if (networkFogObserver) {
        networkFogObserver.disconnect();
        networkFogObserver = null;
    }
}

// Apply network fog hiding on page load if setting is enabled
chrome.storage.sync.get('disableNetworkFog', (result) => {
    if (result.disableNetworkFog) {
        setTimeout(() => {
            hideNetworkFogVideos();
            startNetworkFogObserver();
        }, 1000);
    }
});

// --- Move Notifications to Left ---
const COR3_NOTIF_LEFT_STYLE_ID = 'cor3-notifications-left-style';

function applyNotificationsLeft() {
    if (document.getElementById(COR3_NOTIF_LEFT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = COR3_NOTIF_LEFT_STYLE_ID;
    style.textContent = `
        .Toastify__toast-container--bottom-right {
            left: 16px !important;
            right: auto !important;
            margin-bottom: 35px;
        }
        [data-component-name="NotificationsHistory"] {
            left: 0 !important;
            right: auto !important;
            align-items: flex-start;
        }
        [data-component-name="NotificationsHistory"] > button:first-of-type {
            transform: scaleX(-1);
            display: flex;
        }
        [data-component-name="NotificationsHistory"] .sticker-content {
            color: transparent;               /* hide original text */
            position: relative;
        }
        [data-component-name="NotificationsHistory"] .sticker-content::before {
            content: "Notifications";         /* duplicate the word */
            position: absolute;
            left: 0;
            transform: scaleX(-1);
            color: #FFFFFF;   /* re‑apply the original colour */
            white-space: pre;                 /* keep spacing */
        }
        [data-component-name="NotificationsHistory"] .go3673730358,
        [data-component-name="NotificationsHistory"] > div:last-child {
            border-top-left-radius: 0px;
            border-top-right-radius: 16px;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function removeNotificationsLeft() {
    const el = document.getElementById(COR3_NOTIF_LEFT_STYLE_ID);
    if (el) el.remove();
}

// Apply notifications left on page load if setting is enabled
chrome.storage.sync.get('moveNotificationsLeft', (result) => {
    if (result.moveNotificationsLeft) {
        setTimeout(() => {
            applyNotificationsLeft();
        }, 1000);
    }
});

// --- Resizable Network Map ---
const COR3_RESIZE_MAP_STYLE_ID = 'cor3-resizable-network-map-style';
function applyResizableNetworkMap() {
    if (document.getElementById(COR3_RESIZE_MAP_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = COR3_RESIZE_MAP_STYLE_ID;
    style.textContent = `
        [data-component-name="Application-NETWORK_MAP"] {
            resize: both !important;
            overflow: auto !important;
        }
        [data-component-name="Application-NETWORK_MAP"] [data-component-name="ApplicationWindow"] {
            width: 100% !important;
            height: 100% !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function removeResizableNetworkMap() {
    const el = document.getElementById(COR3_RESIZE_MAP_STYLE_ID);
    if (el) el.remove();
}

chrome.storage.sync.get('resizableNetworkMap', (result) => {
    if (result.resizableNetworkMap) {
        setTimeout(() => {
            applyResizableNetworkMap();
        }, 1000);
    }
});

// --- Auto Job Solver Engine Injection ---
let autoJobSolverInjected = false;

function injectAutoJobSolver() {
    if (autoJobSolverInjected) return;
    autoJobSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('auto-job-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log('[COR3 Helper] Auto Job Solver engine injected');
}

// --- Auto Valuable Seller Engine Injection ---
let autoValuableSellerInjected = false;

function injectAutoValuableSeller() {
    if (autoValuableSellerInjected) return;
    autoValuableSellerInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('auto-valuable-seller.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log('[COR3 Helper] Auto Valuable Seller engine injected');
}

// Serialized batched log writer — prevents read-modify-write races
let _autoJobLogQueue = [];
let _autoJobLogFlushTimer = null;
let _autoJobLogFlushing = false;
function _flushAutoJobLogs() {
    _autoJobLogFlushTimer = null;
    if (_autoJobLogFlushing || _autoJobLogQueue.length === 0 || !isContextValid()) return;
    _autoJobLogFlushing = true;
    const pending = _autoJobLogQueue.splice(0);
    chrome.storage.local.get('autoJobsDebugLogs', (result) => {
        if (!isContextValid()) { _autoJobLogFlushing = false; return; }
        const logs = Array.isArray(result.autoJobsDebugLogs) ? result.autoJobsDebugLogs : [];
        for (const entry of pending) logs.push(entry);
        if (logs.length > 200) logs.splice(0, logs.length - 200);
        chrome.storage.local.set({ autoJobsDebugLogs: logs }, () => {
            _autoJobLogFlushing = false;
            if (_autoJobLogQueue.length > 0) {
                _flushAutoJobLogs();
            }
        });
    });
}
function queueAutoJobLog(msg, level) {
    _autoJobLogQueue.push({ timestamp: new Date().toISOString(), msg: msg, level: level || 'info' });
    if (!_autoJobLogFlushTimer && !_autoJobLogFlushing) {
        _autoJobLogFlushTimer = setTimeout(_flushAutoJobLogs, 100);
    }
    if (typeof cor3LogEntry === 'function') cor3LogEntry('auto-jobs', msg, level || 'info');
}

// Serialized batched log writer for Valuable Seller
let _valuableLogQueue = [];
let _valuableLogFlushTimer = null;
let _valuableLogFlushing = false;
function _flushValuableLogs() {
    _valuableLogFlushTimer = null;
    if (_valuableLogFlushing || _valuableLogQueue.length === 0 || !isContextValid()) return;
    _valuableLogFlushing = true;
    const pending = _valuableLogQueue.splice(0);
    chrome.storage.local.get('valuableDebugLogs', (result) => {
        if (!isContextValid()) { _valuableLogFlushing = false; return; }
        const logs = Array.isArray(result.valuableDebugLogs) ? result.valuableDebugLogs : [];
        for (const entry of pending) logs.push(entry);
        if (logs.length > 200) logs.splice(0, logs.length - 200);
        chrome.storage.local.set({ valuableDebugLogs: logs }, () => {
            _valuableLogFlushing = false;
            if (_valuableLogQueue.length > 0) {
                _flushValuableLogs();
            }
        });
    });
}
function queueValuableLog(msg, level) {
    _valuableLogQueue.push({ timestamp: new Date().toISOString(), msg: msg, level: level || 'info' });
    if (!_valuableLogFlushTimer && !_valuableLogFlushing) {
        _valuableLogFlushTimer = setTimeout(_flushValuableLogs, 100);
    }
    if (typeof cor3LogEntry === 'function') cor3LogEntry('auto-valuable', msg, level || 'info');
}

// Listen for auto-job log/tracker updates from the engine (MAIN world -> content script -> storage)
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isContextValid()) return;

    if (event.data && event.data.type === 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER') {
        // Auto-enable the decrypt solver when auto-job needs it
        chrome.storage.sync.get('autoDecryptEnabled', (result) => {
            if (!result.autoDecryptEnabled) {
                chrome.storage.sync.set({ autoDecryptEnabled: true });
                console.log('[COR3 Helper] Auto Job: Enabling decrypt solver for minigame');
            }
            injectDecryptSolver();
        });
    }
    if (event.data && event.data.type === 'COR3_ICE_WALL_STATUS') {
        chrome.storage.local.set({
            iceWallSolverStatus: {
                message: event.data.message,
                level: event.data.level || 'info',
                timestamp: Date.now()
            }
        });
    }
    if (event.data && event.data.type === 'COR3_SIMPLE_DECRYPT_STATUS') {
        chrome.storage.local.set({
            simpleDecryptSolverStatus: {
                message: event.data.message,
                level: event.data.level || 'info',
                timestamp: Date.now()
            }
        });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_ENABLE_SIMPLE_DECRYPT_SOLVER') {
        chrome.storage.sync.get('autoSimpleDecryptEnabled', (result) => {
            if (!result.autoSimpleDecryptEnabled) {
                chrome.storage.sync.set({ autoSimpleDecryptEnabled: true });
                console.log('[COR3 Helper] Auto Job: Enabling Simple Decrypt solver for minigame');
            }
            injectSimpleDecryptSolver();
        });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_ENABLE_ICE_WALL_SOLVER') {
        // Auto-enable the ICE Wall solver when auto-job needs it
        chrome.storage.sync.get('autoIceWallEnabled', (result) => {
            if (!result.autoIceWallEnabled) {
                chrome.storage.sync.set({ autoIceWallEnabled: true });
                console.log('[COR3 Helper] Auto Job: Enabling ICE Wall solver for minigame');
            }
            injectIceWallSolver();
        });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_LOG') {
        queueAutoJobLog(event.data.msg, event.data.level);
    }
    if (event.data && event.data.type === 'COR3_WS_NETWORK_MAP') {
        chrome.storage.local.set({ serverMaintenanceMap: event.data.servers });
    }
    // Secret Finder: relay log updates and auto-disable toggle on completion
    if (event.data && event.data.type === 'COR3_IP_SEARCH_LOG') {
        if (isContextValid()) {
            try { chrome.storage.local.set({ secretFinderLog: event.data.html }); } catch (e) {}
        }
    }
    if (event.data && event.data.type === 'COR3_IP_SEARCH_DONE') {
        if (isContextValid()) {
            try {
                chrome.storage.local.set({ secretFinderLog: event.data.html });
                chrome.storage.sync.set({ secretFinderEnabled: false });
            } catch (e) {}
        }
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_TRACKER_UPDATE') {
        chrome.storage.local.set({ autoJobsTracker: event.data.tracker });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_DONE') {
        _autoJobsActive = false;
        chrome.storage.local.set({ autoJobsRunning: false });
        _automationFinish('auto-jobs');
    }
    if (event.data && event.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
        _marketRefreshInProgress = false;
        // Signal background.js that sequential refresh is complete
        chrome.storage.local.set({ _allMarketsRefreshed: Date.now() });
    }
    if (event.data && event.data.type === 'COR3_TOKEN_EXPIRED') {
        // Clear in-progress flags so auto-refresh can restart after WS reconnect
        _marketRefreshInProgress = false;
        _seqRefreshRunning = false;
        console.log('[COR3 Helper] Token expired — cleared market refresh flags');
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_SAVE_COMPLETED') {
        // Merge completed job results into storage (accumulate across runs within same reset cycle)
        chrome.storage.local.get('autoJobsCompletedResults', (result) => {
            const existing = result.autoJobsCompletedResults || [];
            const incoming = event.data.jobs || [];
            // Merge: replace existing entries by jobId, append new ones
            const merged = [...existing];
            for (const job of incoming) {
                const idx = merged.findIndex(j => j.jobId === job.jobId);
                if (idx >= 0) merged[idx] = job;
                else merged.push(job);
            }
            chrome.storage.local.set({ autoJobsCompletedResults: merged });
        });
    }
    // --- Auto Valuable Seller: relay log/data/done messages to storage ---
    if (event.data && event.data.type === 'COR3_VALUABLE_LOG') {
        queueValuableLog(event.data.msg, event.data.level);
    }
    if (event.data && event.data.type === 'COR3_VALUABLE_SERVERS_UPDATE') {
        chrome.storage.local.set({ valuableServersData: event.data.data });
    }
    if (event.data && event.data.type === 'COR3_VALUABLE_DOWNLOADS_UPDATE') {
        chrome.storage.local.set({ valuableDownloadsData: event.data.data });
    }
    if (event.data && event.data.type === 'COR3_VALUABLE_DONE') {
        chrome.storage.local.set({ valuableSearchRunning: false, valuableSellerRunning: false });
        _automationFinish('auto-valuable');
    }
    // --- Auto Clear IPs: relay WS responses to storage for background.js ---
    if (event.data && event.data.type === 'COR3_AUTOJOB_SAI_TRANSIT') {
        chrome.storage.local.set({ _clearIpsTransit: { data: event.data.data, error: event.data.error, ts: Date.now() } });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_SAI_TRANSIT_REMOVE') {
        chrome.storage.local.set({ _clearIpsTransitRemove: { data: event.data.data, error: event.data.error, ts: Date.now() } });
    }
    if (event.data && event.data.type === 'COR3_WS_ENDPOINT_RESULT') {
        chrome.storage.local.set({ _clearIpsEndpoint: { success: event.data.success, error: event.data.error, ts: Date.now() } });
    }
    if (event.data && event.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') {
        chrome.storage.local.set({ _clearIpsEndpoint: { success: false, unreachable: true, error: event.data.error, ts: Date.now() } });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_SAI_LOGIN_STATUS') {
        chrome.storage.local.set({ _clearIpsLoginStatus: { data: event.data.data, error: event.data.error, ts: Date.now() } });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_SAI_LOGIN_RESULT') {
        chrome.storage.local.set({ _clearIpsLoginResult: { data: event.data.data, error: event.data.error, ts: Date.now() } });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_SAI_HACK_START') {
        chrome.storage.local.set({ _clearIpsHackStart: { data: event.data.data, error: event.data.error, ts: Date.now() } });
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_SAI_UPDATE') {
        chrome.storage.local.set({ _clearIpsSaiUpdate: { data: event.data.data, ts: Date.now() } });
    }
});

// On page load: check cached expedition data for auto-send trigger
setTimeout(() => {
    chrome.storage.local.get('expeditionsData', (result) => {
        if (result.expeditionsData) {
            console.log('[COR3 Helper] Page load: checking cached expedition data for auto-send');
            checkAutoSendOnExpeditionData(result.expeditionsData);
        }
    });
}, 5000); // delay to let WS connect and settings load

// Listen for autoSendMerc toggle changes to trigger auto-send check
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.autoSendMerc) return;
    const newVal = changes.autoSendMerc.newValue;
    if (newVal && newVal.enabled) {
        console.log('[COR3 Helper] Auto-send mercenary enabled — checking expedition data');
        chrome.storage.local.get('expeditionsData', (result) => {
            if (result.expeditionsData) {
                checkAutoSendOnExpeditionData(result.expeditionsData);
            }
        });
    }
});

// Capture extension errors to IndexedDB for DevTools panel
window.addEventListener('error', (e) => {
    if (typeof cor3LogEntry === 'function') {
        cor3LogEntry('error-logs', (e.filename || '') + ':' + (e.lineno || 0) + ' ' + (e.message || ''), 'error');
    }
});
window.addEventListener('unhandledrejection', (e) => {
    if (typeof cor3LogEntry === 'function') {
        var msg = e.reason ? (e.reason.stack || e.reason.message || String(e.reason)) : 'Unhandled rejection';
        cor3LogEntry('error-logs', msg, 'error');
    }
});

// Resume auto-jobs if they were running before page reload
chrome.storage.local.get(['autoJobsRunning', 'autoJobsQueue'], (data) => {
    if (data.autoJobsRunning && data.autoJobsQueue && data.autoJobsQueue.length > 0) {
        console.log('[COR3 Helper] Resuming auto jobs after page reload');
        injectAutoJobSolver();
        // Refresh market data first so canComplete flags are up-to-date
        window.postMessage({ type: 'COR3_REFRESH_ALL_MARKETS' }, '*');
        setTimeout(() => {
            window.postMessage({ type: 'COR3_AUTOJOB_START', jobs: data.autoJobsQueue, settings: {} }, '*');
        }, 8000); // longer delay on page reload to allow market refresh
    }
});
