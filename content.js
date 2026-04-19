// content.js

// --- Listen for decision data relayed from content-early.js (MAIN world) ---
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const now = Date.now();
    if (event.data && event.data.type === 'COR3_WS_EXPEDITIONS') {
        chrome.storage.local.set({ expeditionsData: event.data.expeditions, expeditionsDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_DECISIONS') {
        const newDecisions = event.data.decisions;
        chrome.storage.local.get('expeditionDecisions', (stored) => {
            const existing = stored.expeditionDecisions || [];
            const existingIds = new Set(existing.map(d => d.messageId));
            for (const d of newDecisions) {
                if (!existingIds.has(d.messageId)) {
                    existing.push(d);
                }
            }
            chrome.storage.local.set({ expeditionDecisions: existing });
        });
    }
    if (event.data && event.data.type === 'COR3_WS_STASH') {
        chrome.storage.local.set({ stashData: event.data.stash, stashDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_MARKET') {
        chrome.storage.local.set({ marketData: event.data.market, marketDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_DARK_MARKET') {
        chrome.storage.local.set({ darkMarketData: event.data.market, darkMarketAvailable: true, darkMarketDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_WS_DARK_MARKET_UNAVAILABLE') {
        chrome.storage.local.set({ darkMarketData: null, darkMarketAvailable: false, darkMarketDataUpdatedAt: now });
    }
    if (event.data && event.data.type === 'COR3_BEARER_TOKEN') {
        chrome.storage.local.set({ bearerToken: event.data.token });
    }
    // Auto-fetch daily ops on page load (triggered from content-early.js)
    if (event.data && event.data.type === 'COR3_FETCH_DAILY_OPS') {
        chrome.storage.local.get('bearerToken', (result) => {
            const token = result.bearerToken;
            if (!token) return;
            fetch('https://svc-corie.cor3.gg/api/user-daily-claim', {
                headers: { 'Authorization': token }
            })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data) {
                    chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now() });
                }
            })
            .catch(() => {});
        });
    }
});

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

async function checkAlarms() {
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
}

// Check alarms every second
setInterval(() => checkAlarms(), 1000);

// --- Auto-Refresh for Market Job Timers ---
let autoRefreshSettings = { home_jobs: false, dark_jobs: false };
let autoRefreshRetryPending = { home_jobs: false, dark_jobs: false };

// Load auto-refresh settings on startup
chrome.storage.sync.get('autoRefresh', (data) => {
    if (data.autoRefresh) autoRefreshSettings = data.autoRefresh;
});

function getMarketTimerSeconds(which) {
    return new Promise((resolve) => {
        const key = which === 'home_jobs' ? 'marketData' : 'darkMarketData';
        chrome.storage.local.get(key, (result) => {
            const data = result[key];
            if (data && data.nextJobsResetAt) {
                const diff = new Date(data.nextJobsResetAt).getTime() - Date.now();
                resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
            } else {
                resolve(null);
            }
        });
    });
}

function doAutoRefreshMarket(which) {
    if (which === 'home_jobs') {
        window.postMessage({ type: 'COR3_REFRESH_MARKET' }, '*');
    } else {
        window.postMessage({ type: 'COR3_REFRESH_DARK_MARKET' }, '*');
    }
}

async function checkAutoRefresh() {
    for (const key of ['home_jobs', 'dark_jobs']) {
        if (!autoRefreshSettings[key]) continue;
        if (autoRefreshRetryPending[key]) continue;

        const sec = await getMarketTimerSeconds(key);
        if (sec !== null && sec <= 0) {
            autoRefreshRetryPending[key] = true;
            doAutoRefreshMarket(key);

            // After 10s, re-check. If still 0, retry.
            setTimeout(async () => {
                autoRefreshRetryPending[key] = false;
                const newSec = await getMarketTimerSeconds(key);
                if (newSec !== null && newSec <= 0) {
                    // Will be picked up by next checkAutoRefresh cycle
                }
            }, 10000);
        }
    }
}

// Check auto-refresh every second
setInterval(() => checkAutoRefresh(), 1000);

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

// Auto-start solver if it was enabled before page load
chrome.storage.sync.get('autoDecryptEnabled', (data) => {
    if (data.autoDecryptEnabled) {
        injectDecryptSolver();
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
    } else if (request.action === "requestMarket") {
        window.postMessage({ type: 'COR3_REQUEST_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "refreshMarket") {
        window.postMessage({ type: 'COR3_REFRESH_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "requestDarkMarket") {
        window.postMessage({ type: 'COR3_REQUEST_DARK_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "refreshDarkMarket") {
        window.postMessage({ type: 'COR3_REFRESH_DARK_MARKET' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "leaveStash") {
        window.postMessage({ type: 'COR3_LEAVE_STASH' }, '*');
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
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data) {
                    chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now() });
                }
                sendResponse({ data: data });
            })
            .catch(() => sendResponse({ error: 'fetch failed' }));
        });
        return true; // keep channel open for async sendResponse
    }
});
