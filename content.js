// content.js

// --- Listen for decision data relayed from content-early.js (MAIN world) ---
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
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
        chrome.storage.local.set({ stashData: event.data.stash });
    }
    if (event.data && event.data.type === 'COR3_WS_MARKET') {
        chrome.storage.local.set({ marketData: event.data.market });
    }
    if (event.data && event.data.type === 'COR3_WS_DARK_MARKET') {
        chrome.storage.local.set({ darkMarketData: event.data.market, darkMarketAvailable: true });
    }
    if (event.data && event.data.type === 'COR3_WS_DARK_MARKET_UNAVAILABLE') {
        chrome.storage.local.set({ darkMarketData: null, darkMarketAvailable: false });
    }
    if (event.data && event.data.type === 'COR3_BEARER_TOKEN') {
        chrome.storage.local.set({ bearerToken: event.data.token });
    }
});

let alarmEnabled = false;
let alarmVolume = 50;
let continuousAlarm = false;
let alarmTimerSource = 'daily';
let alarmThresholdSeconds = 60;
let alarmTriggered = false;
let audioContext = null;
let continuousInterval = null;
let isAlarmActive = false;

// Load settings
chrome.storage.sync.get(['alarmEnabled', 'alarmVolume', 'continuousAlarm', 'alarmTimerSource', 'alarmThresholdMinutes', 'alarmThresholdSeconds'], (data) => {
    alarmEnabled = data.alarmEnabled || false;
    alarmVolume = data.alarmVolume !== undefined ? data.alarmVolume : 50;
    continuousAlarm = data.continuousAlarm || false;
    alarmTimerSource = data.alarmTimerSource || 'daily';
    const mins = data.alarmThresholdMinutes !== undefined ? data.alarmThresholdMinutes : 1;
    const secs = data.alarmThresholdSeconds !== undefined ? data.alarmThresholdSeconds : 0;
    alarmThresholdSeconds = mins * 60 + secs;
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

function startContinuousAlarm() {
    if (continuousInterval) clearInterval(continuousInterval);
    isAlarmActive = true;
    chrome.runtime.sendMessage({ action: "alarmActiveStatus", isActive: true }).catch(()=>{});
    playAlarm(alarmVolume);
    continuousInterval = setInterval(() => {
        playAlarm(alarmVolume);
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

function getWatchedTimerRemainingSeconds() {
    return new Promise((resolve) => {
        if (alarmTimerSource === 'daily') {
            chrome.storage.local.get('dailyOpsData', (result) => {
                if (result.dailyOpsData && result.dailyOpsData.nextTaskTime) {
                    const diff = new Date(result.dailyOpsData.nextTaskTime).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (alarmTimerSource === 'home_jobs') {
            chrome.storage.local.get('marketData', (result) => {
                if (result.marketData && result.marketData.nextJobsResetAt) {
                    const diff = new Date(result.marketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (alarmTimerSource === 'dark_jobs') {
            chrome.storage.local.get('darkMarketData', (result) => {
                if (result.darkMarketData && result.darkMarketData.nextJobsResetAt) {
                    const diff = new Date(result.darkMarketData.nextJobsResetAt).getTime() - Date.now();
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

async function checkAlarm() {
    if (!alarmEnabled || alarmThresholdSeconds <= 0) return;
    const remaining = await getWatchedTimerRemainingSeconds();
    if (remaining === null) return;

    if (remaining <= alarmThresholdSeconds && remaining > 0 && !alarmTriggered) {
        alarmTriggered = true;
        if (continuousAlarm) {
            startContinuousAlarm();
        } else {
            playAlarm(alarmVolume);
        }
    } else if (remaining > alarmThresholdSeconds) {
        alarmTriggered = false;
    }
}

// Check alarm every second
setInterval(() => checkAlarm(), 1000);

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "updateSettings") {
        if (request.settings.alarmEnabled !== undefined) alarmEnabled = request.settings.alarmEnabled;
        if (request.settings.alarmVolume !== undefined) alarmVolume = request.settings.alarmVolume;
        if (request.settings.continuousAlarm !== undefined) {
            continuousAlarm = request.settings.continuousAlarm;
            if (!continuousAlarm && isAlarmActive) {
                stopAlarm();
            }
        }
        if (request.settings.alarmTimerSource !== undefined) {
            alarmTimerSource = request.settings.alarmTimerSource;
            alarmTriggered = false; // reset trigger on source change
        }
        if (request.settings.alarmThresholdSeconds !== undefined) {
            alarmThresholdSeconds = request.settings.alarmThresholdSeconds;
            alarmTriggered = false; // reset trigger on threshold change
        }
        sendResponse({ success: true });
    } else if (request.action === "testAlarm") {
        if (continuousAlarm) {
            startContinuousAlarm();
        } else {
            playAlarm(alarmVolume);
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
    } else if (request.action === "leaveMarketRoom") {
        window.postMessage({ type: 'COR3_LEAVE_MARKET_ROOM' }, '*');
        sendResponse({ success: true });
    } else if (request.action === "leaveStash") {
        window.postMessage({ type: 'COR3_LEAVE_STASH' }, '*');
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
                    chrome.storage.local.set({ dailyOpsData: data });
                }
                sendResponse({ data: data });
            })
            .catch(() => sendResponse({ error: 'fetch failed' }));
        });
        return true; // keep channel open for async sendResponse
    }
});
