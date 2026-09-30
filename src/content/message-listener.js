// chrome.runtime.onMessage listener — handles messages from popup/background

import { isContextValid, _automationEnqueue, _automationFinish, setAutomationQueue, getAutomationQueue } from './helpers.js';
import { setAlarms, resetAlarmTriggered, playAlarm, startContinuousAlarm, stopAlarm } from './alarms.js';
import { setAutoRefreshSettings } from './auto-refresh.js';
import { setMarketRefreshInProgress, setAutoUpdateMarketsLastRefresh, setAutoJobsActive, _marketRefreshInProgress, _autoUpdateMarketsLastRefresh } from './auto-update-markets.js';
import {
    injectDecryptSolver, stopDecryptSolver,
    injectIceWallSolver, stopIceWallSolver,
    injectSimpleDecryptSolver, stopSimpleDecryptSolver,
    injectDailyHackSolver, stopDailyHackSolver,
    injectAutoJobSolver, injectAutoValuableSeller,
    ensureAntiAfkEnabled
} from './solvers.js';
import {
    deleteBackgroundElements,
    hideNetworkFogVideos, showNetworkFogVideos,
    startNetworkFogObserver, stopNetworkFogObserver,
    applyNotificationsLeft, removeNotificationsLeft
} from './dom-tweaks.js';

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

export function setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "updateAlarms") {
            setAlarms(request.alarms || []);
            resetAlarmTriggered();
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
        } else if (request.action === "requestNetworkMap") {
            window.postMessage({ type: 'COR3_REQUEST_NETWORK_MAP' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "devTcTestReachability") {
            window.postMessage({ type: 'COR3_DEV_TC_TEST_REACHABILITY', serverId: request.serverId }, '*');
            sendResponse({ success: true });
        } else if (request.action === "requestStash") {
            window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "requestSpecialists") {
            window.postMessage({ type: 'COR3_REQUEST_SPECIALISTS' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "purchaseSpecialist") {
            window.postMessage({ type: 'COR3_PURCHASE_SPECIALIST', specialistType: request.specialistType, kind: request.kind, level: request.level, priceId: request.priceId }, '*');
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
            setMarketRefreshInProgress(true);
            setAutoUpdateMarketsLastRefresh(Date.now());
            setTimeout(() => { setMarketRefreshInProgress(false); }, 10000);
            window.postMessage({ type: 'COR3_REFRESH_MARKET' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "requestDarkMarket") {
            window.postMessage({ type: 'COR3_REQUEST_DARK_MARKET' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "refreshDarkMarket") {
            setMarketRefreshInProgress(true);
            setAutoUpdateMarketsLastRefresh(Date.now());
            setTimeout(() => { setMarketRefreshInProgress(false); }, 10000);
            window.postMessage({ type: 'COR3_REFRESH_DARK_MARKET' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "requestSoyuzMarket") {
            window.postMessage({ type: 'COR3_REQUEST_SOYUZ_MARKET' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "refreshSoyuzMarket") {
            setMarketRefreshInProgress(true);
            setAutoUpdateMarketsLastRefresh(Date.now());
            setTimeout(() => { setMarketRefreshInProgress(false); }, 10000);
            window.postMessage({ type: 'COR3_REFRESH_SOYUZ_MARKET' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "requestUsolMarket") {
            window.postMessage({ type: 'COR3_REQUEST_USOL_MARKET' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "refreshUsolMarket") {
            setMarketRefreshInProgress(true);
            setAutoUpdateMarketsLastRefresh(Date.now());
            setTimeout(() => { setMarketRefreshInProgress(false); }, 10000);
            window.postMessage({ type: 'COR3_REFRESH_USOL_MARKET' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "refreshAllMarketsSeq") {
            setMarketRefreshInProgress(true);
            setAutoUpdateMarketsLastRefresh(Date.now());
            var msg = { type: 'COR3_REFRESH_ALL_MARKETS_SEQ' };
            if (request.skipLots) msg.skipLots = true;
            if (request.order) msg.order = request.order;
            window.postMessage(msg, '*');
            sendResponse({ success: true });
        } else if (request.action === "leaveStash") {
            window.postMessage({ type: 'COR3_LEAVE_STASH' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "sellItem") {
            window.postMessage({ type: 'COR3_SELL_ITEM', itemId: request.itemId, quantity: request.quantity || 1, skipStashRefresh: !!request.skipStashRefresh }, '*');
            sendResponse({ success: true });
        } else if (request.action === "batchSellItems") {
            // Drive batch through the proven single-sell path, skipping per-sell stash
            // refresh; one explicit stash refresh is requested afterwards by the popup.
            const items = request.items || [];
            console.log('[COR3 Helper] batchSellItems requested, n=', Array.isArray(items) ? items.length : 0);
            if (!Array.isArray(items) || items.length === 0) {
                sendResponse({ success: true, count: 0 });
                return;
            }
            let bi = 0;
            (function sellNextOne() {
                if (bi >= items.length) {
                    sendResponse({ success: true, count: items.length });
                    return;
                }
                const it = items[bi++];
                window.postMessage({ type: 'COR3_SELL_ITEM', itemId: it.itemId, quantity: it.quantity || 1, skipStashRefresh: true }, '*');
                setTimeout(sellNextOne, 800 + Math.floor(Math.random() * 200));
            })();
            return true; // async sendResponse when the batch finishes
        } else if (request.action === "keepWorkerAlive") {
            window.postMessage({ type: 'COR3_KEEP_ALIVE' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "updateAutoRefresh") {
            if (request.autoRefresh) {
                setAutoRefreshSettings(request.autoRefresh);
            }
            sendResponse({ success: true });
        } else if (request.action === "toggleDecryptSolver") {
            if (request.enabled) {
                ensureAntiAfkEnabled();
                injectDecryptSolver();
            } else {
                stopDecryptSolver();
            }
            sendResponse({ success: true });
        } else if (request.action === "toggleIceWallSolver") {
            if (request.enabled) {
                ensureAntiAfkEnabled();
                injectIceWallSolver();
            } else {
                stopIceWallSolver();
            }
            sendResponse({ success: true });
        } else if (request.action === "toggleSimpleDecryptSolver") {
            if (request.enabled) {
                ensureAntiAfkEnabled();
                injectSimpleDecryptSolver();
            } else {
                stopSimpleDecryptSolver();
            }
            sendResponse({ success: true });
        } else if (request.action === "toggleDailyHackSolver") {
            if (request.enabled) {
                chrome.storage.local.get('bearerToken', (result) => {
                    const token = result.bearerToken;
                    if (!token) {
                        ensureAntiAfkEnabled();
                        injectDailyHackSolver();
                        return;
                    }
                    fetch('https://svc-corie.cor3.gg/api/user-daily-claim', { headers: { 'Authorization': token } })
                        .then(r => r.ok ? r.json() : null)
                        .then(data => {
                            if (data) {
                                chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now() });
                                fetchDailyRewards(token);
                            }
                            if (data && data.hasClaimedToday) {
                                console.log('[COR3 Helper] Daily already claimed — skipping solver');
                                chrome.storage.sync.set({ autoDailyHackEnabled: false });
                                chrome.storage.local.set({ dailyHackLog: 'Daily already claimed today — skipping automation.', dailyHackLogUpdatedAt: Date.now() });
                                return;
                            }
                            ensureAntiAfkEnabled();
                            injectDailyHackSolver();
                        })
                        .catch(() => {
                            ensureAntiAfkEnabled();
                            injectDailyHackSolver();
                        });
                });
            } else {
                stopDailyHackSolver();
            }
            sendResponse({ success: true });
        } else if (request.action === "respondDecision") {
            window.postMessage({
                type: 'COR3_RESPOND_DECISION',
                expeditionId: request.expeditionId,
                messageId: request.messageId,
                selectedOption: request.selectedOption
            }, '*');
            sendResponse({ success: true });
        } else if (request.action === "requestArchivedExpeditions") {
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
            chrome.storage.sync.set({ disableBackground: true });
            deleteBackgroundElements();
            console.log('[COR3 Helper] Background elements deleted');
            sendResponse({ success: true });
        } else if (request.action === "enableBackground") {
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
        } else if (request.action === "getVersionFallbacks") {
            sendResponse({
                webVersion: window.__cor3WebVersion,
                systemVersion: window.__cor3SystemVersion,
                patchVersion: window.__cor3PatchVersion
            });
        } else if (request.action === "startAutoJobs") {
            ensureAntiAfkEnabled();
            const jobs = request.jobs;
            const settings = request.settings || {};
            const result = _automationEnqueue('auto-jobs', () => {
                setAutoJobsActive(true);
                injectAutoJobSolver();
                setTimeout(() => {
                    chrome.storage.local.get('autoJobsLockedJobs', (lockData) => {
                        var lockedJobs = lockData.autoJobsLockedJobs;
                        if (lockedJobs && lockedJobs.length > 0) {
                            var now = Date.now();
                            var stillLocked = lockedJobs.filter(j => j.lockExpiresAt && new Date(j.lockExpiresAt).getTime() > now);
                            var expired = lockedJobs.length - stillLocked.length;
                            settings.lockedJobs = stillLocked;
                            chrome.storage.local.set({ autoJobsLockedJobs: stillLocked });
                            if (expired > 0) console.log('[COR3 Helper] Pruned ' + expired + ' expired lock(s) from autoJobsLockedJobs');
                            if (stillLocked.length > 0) console.log('[COR3 Helper] Passing ' + stillLocked.length + ' locked job(s) to solver');
                        }
                        window.postMessage({ type: 'COR3_AUTOJOB_START', jobs: jobs, settings: settings }, '*');
                    });
                }, 500);
            });
            sendResponse({ success: true, queueResult: result, queueStatus: import('./helpers.js').then(m => m._automationQueueStatus()) });
        } else if (request.action === "stopAutoJobs") {
            setAutoJobsActive(false);
            setAutomationQueue(getAutomationQueue().filter(q => q.type !== 'auto-jobs'));
            window.postMessage({ type: 'COR3_AUTOJOB_STOP' }, '*');
            _automationFinish('auto-jobs');
            sendResponse({ success: true });
        } else if (request.action === "enableHackSolvers") {
            ensureAntiAfkEnabled();
            injectDecryptSolver();
            injectIceWallSolver();
            injectSimpleDecryptSolver();
            sendResponse({ success: true });
        } else if (request.action === "dismissFailedJobs") {
            var dismissJobs = request.jobs || [];
            var dismissMarketKey = request.marketKey || '';
            var dismissStorageKey = { home: 'marketData', dark: 'darkMarketData', soyuz: 'soyuzMarketData', usol: 'usolMarketData' }[dismissMarketKey] || '';
            var dismissRefreshType = { home: 'COR3_REFRESH_MARKET', dark: 'COR3_REFRESH_DARK_MARKET', soyuz: 'COR3_REFRESH_SOYUZ_MARKET', usol: 'COR3_REFRESH_USOL_MARKET' }[dismissMarketKey] || '';
            var result = _automationEnqueue('clear-failed-jobs', function () {
                (async function () {
                    try {
                        for (var i = 0; i < dismissJobs.length; i++) {
                            window.postMessage({ type: 'COR3_AUTOJOB_CMD', cmd: 'job.dismiss', data: dismissJobs[i] }, '*');
                            if (dismissStorageKey) {
                                var fresh = await chrome.storage.local.get(dismissStorageKey);
                                var freshMd = fresh[dismissStorageKey];
                                if (freshMd && freshMd.recentJobs) {
                                    freshMd.recentJobs = freshMd.recentJobs.filter(function (j) { return j.id !== dismissJobs[i].jobId; });
                                    await chrome.storage.local.set({ [dismissStorageKey]: freshMd });
                                }
                            }
                            await new Promise(function (r) { setTimeout(r, 500); });
                        }
                        await new Promise(function (r) { setTimeout(r, 2000); });
                        if (dismissRefreshType) {
                            setMarketRefreshInProgress(true);
                            setAutoUpdateMarketsLastRefresh(Date.now());
                            setTimeout(function () { setMarketRefreshInProgress(false); }, 10000);
                            window.postMessage({ type: dismissRefreshType }, '*');
                        }
                    } catch (e) {
                        console.log('[COR3 Helper] dismissFailedJobs error:', e);
                    } finally {
                        _automationFinish('clear-failed-jobs');
                    }
                })();
            });
            sendResponse({ success: true, queueResult: result });
        } else if (request.action === "devtoolsSendWs") {
            window.postMessage({ type: 'COR3_DEVTOOLS_WS_SEND', message: request.message }, '*');
            sendResponse({ success: true });
        } else if (request.action === "startValuableSearch") {
            ensureAntiAfkEnabled();
            const result = _automationEnqueue('auto-valuable', () => {
                injectAutoValuableSeller();
                setTimeout(() => {
                    window.postMessage({ type: 'COR3_VALUABLE_START_SEARCH' }, '*');
                }, 500);
            });
            sendResponse({ success: true, queueResult: result });
        } else if (request.action === "startValuableSeller") {
            ensureAntiAfkEnabled();
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
            sendResponse({ success: true, queueResult: result });
        } else if (request.action === "stopValuable") {
            setAutomationQueue(getAutomationQueue().filter(q => q.type !== 'auto-valuable'));
            window.postMessage({ type: 'COR3_VALUABLE_STOP' }, '*');
            _automationFinish('auto-valuable');
            sendResponse({ success: true });
        } else if (request.action === "forceMaintenanceBatch") {
            injectAutoValuableSeller();
            setTimeout(() => {
                window.postMessage({
                    type: 'COR3_VALUABLE_FORCE_MAINTENANCE_BATCH',
                    servers: request.servers
                }, '*');
            }, 500);
            sendResponse({ success: true });
        } else if (request.action === "startIpSearch") {
            window.postMessage({ type: 'COR3_IP_SEARCH_START' }, '*');
            sendResponse({ success: true });
        } else if (request.action === "fetchDailyOps") {
            window.postMessage({ type: 'COR3_FETCH_DAILY_OPS' }, '*');
            sendResponse({ success: true });
        }
    });
}
