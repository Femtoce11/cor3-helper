// background.js
// Service worker for background tasks (keep-alive, decision monitoring, expedition polling)

importScripts('errors.js');

// --- Helpers ---
async function getCor3Tab() {
    try {
        const [tab] = await chrome.tabs.query({ url: "*://*.cor3.gg/*" });
        return tab || null;
    } catch (e) { return null; }
}

// --- Keep-alive ---
async function keepWorkerAlive() {
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "keepWorkerAlive" });
        }
    } catch (e) {
        console.log('[COR3 Helper] Keep-alive failed:', e);
        cor3LogError('background.js', e, { action: 'keepWorkerAlive' });
    }
}
keepWorkerAlive();
setInterval(keepWorkerAlive, 30000);

// --- Auto-choose scoring (mirrors popup.js logic, reads modifiers from storage) ---
const autoChosenDecisions = new Set();

function calcOptionScoreBg(opt, expeditionRiskScore, lootMod, riskMod) {
    return Math.round((opt.lootModifier * lootMod) + ((opt.riskModifier * riskMod) * (((expeditionRiskScore + Math.abs(opt.riskModifier)) / 10) || 1)));
}

async function checkAutoChooseBackground() {
    try {
        // Read settings from storage
        const settings = await chrome.storage.sync.get('decisionModifiers');
        const mods = settings.decisionModifiers || {};
        if (!mods.autoChoose) return;

        const modifiersEnabled = mods.enabled !== false;
        const lootMod = modifiersEnabled ? (mods.loot ?? 3) : 1;
        const riskMod = modifiersEnabled ? (mods.risk ?? -2) : -1;

        const { expeditionDecisions } = await chrome.storage.local.get('expeditionDecisions');
        const decisions = expeditionDecisions || [];
        if (decisions.length === 0) return;

        for (const d of decisions) {
            if (d.isResolved || !d.decisionDeadline || !Array.isArray(d.decisionOptions)) continue;
            if (autoChosenDecisions.has(d.messageId)) continue;
            const dl = new Date(d.decisionDeadline);
            const remaining = dl - Date.now();
            if (remaining <= 0) continue; // expired
            if (remaining > 60000) continue; // wait until < 1 minute remaining

            // Pick highest score
            let bestOpt = null;
            let bestScore = -Infinity;
            for (const opt of d.decisionOptions) {
                const score = calcOptionScoreBg(opt, d.riskScore, lootMod, riskMod);
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
                        console.log(`[COR3 Helper BG] Auto-chose "${bestOpt.label}" (score: ${bestScore})`);
                        // Refresh expedition data after a delay
                        setTimeout(() => requestExpeditionsFromBg(), 3000);
                    }
                } catch (e) { /* silent */ }
            }
        }
    } catch (e) {
        console.log('[COR3 Helper] Background auto-choose failed:', e);
        cor3LogError('background.js', e, { action: 'checkAutoChooseBackground' });
    }
}

// Decision timer monitoring every 10 seconds — runs entirely in background
setInterval(checkAutoChooseBackground, 10000);

// --- Expedition polling (every 30 seconds if auto-features enabled) ---
async function requestExpeditionsFromBg() {
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
        }
    } catch (e) { /* silent */ }
}

async function expeditionPolling() {
    try {
        const settings = await chrome.storage.sync.get(['decisionModifiers', 'autoSendMerc']);
        const autoChooseEnabled = settings.decisionModifiers ? !!settings.decisionModifiers.autoChoose : false;
        const autoSendEnabled = settings.autoSendMerc ? !!settings.autoSendMerc.enabled : false;

        if (autoChooseEnabled || autoSendEnabled) {
            await requestExpeditionsFromBg();
        }
    } catch (e) { /* silent */ }
}
setInterval(expeditionPolling, 30000);

// --- Message listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "alarmActiveStatus") {
        sendResponse({ success: true });
        return true;
    }
});
