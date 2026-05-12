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

// --- Auto Finish All Jobs (background scheduling) ---
const SUPPORTED_JOB_TYPES_BG = [
    'File Decryption', 'IP Injection', 'Data Download', 'Log Deletion',
    'Log Download', 'Decrypt & Extract', 'File Elimination', 'Data Upload', 'IP Cleanup'
];
const LOG_JOB_TYPES_BG = ['Log Deletion', 'Log Download'];

function isJobBuggedBg(job) {
    const sn = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : (job.serverName || '');
    return sn === 'D4RK RM7CE' && LOG_JOB_TYPES_BG.includes(job.name);
}

// Server connection tree — maps each server name to the ordered list of server IDs
// on the path from HOME to that server (excluding HOME, which cannot be in maintenance).
// If ANY server on the path is in maintenance, jobs targeting that server are unreachable.
const SERVER_PATH_MAP = {
    'RM7-E1L3': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' }
    ],
    'RM7-E1L5': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' }
    ],
    'RM7-E1L2CT': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1L2CT', id: '019d53aa-5101-7f08-b3dd-378b0ddcf7d0' }
    ],
    'RM7-E1SCP': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' }
    ],
    'RM7-S4L4': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L4', id: '019d1b0a-13a9-77dd-b41f-3ffb5f671742' }
    ],
    'D4RK RM7CE': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'D4RK RM7CE', id: '019d29c5-4b37-79bf-b23e-304d8ea03c15' }
    ],
    'RM7-N2ECP': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' }
    ],
    'RM7-N2L2': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' }
    ],
    'RM7-N2L3': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' }
    ],
    'RM7-W3NCP': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' }
    ],
    'RM7-N1L1': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
        { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' }
    ]
};

function collectJobsBg(marketData, darkMarketData, completedResults, serverMaintenanceMap, soyuzMarketData) {
    const MARKET_IDS = { home: '019d3ea4-85bd-7389-904d-8f7c85841134', dark: '019d3ea4-85bd-7389-904d-908ba9194aa0', soyuz: '019da731-2db5-7d76-9447-1ea3b9b78001' };
    const SERVER_PRIORITY = ['RM7-N1L1', 'RM7-W3NCP', 'RM7-N2L3', 'RM7-N2L2', 'RM7-N2ECP', 'D4RK RM7CE', 'RM7-S4L4', 'RM7-E1SCP', 'RM7-E1L2CT', 'RM7-E1L5', 'RM7-E1L3'];
    const JOB_TYPE_PRIORITY = ['IP Injection', 'IP Cleanup', 'Data Upload', 'Data Download', 'Log Deletion', 'Log Download', 'File Elimination', 'File Decryption', 'Decrypt & Extract'];
    const maint = serverMaintenanceMap || {};
    const now = Date.now();
    // Build set of job IDs that already failed/bugged — skip them
    const skipIds = new Set();
    if (completedResults && completedResults.length > 0) {
        for (const cr of completedResults) {
            if (cr.status === 'failed' || cr.status === 'bugged') {
                skipIds.add(cr.jobId);
            }
        }
    }
    // Check if ANY server on the path to the target is in maintenance.
    // Returns { blocked: false } or { blocked: true, blockerName, blockerId, maintenanceEndsAt }
    function getPathBlocker(serverName) {
        const path = SERVER_PATH_MAP[serverName];
        if (!path) return { blocked: false };
        for (const srv of path) {
            const info = maint[srv.id];
            if (info && info.isInMaintenance) {
                if (!info.maintenanceEndsAt || new Date(info.maintenanceEndsAt).getTime() > now) {
                    return { blocked: true, blockerName: srv.name, blockerId: srv.id, maintenanceEndsAt: info.maintenanceEndsAt || null };
                }
            }
        }
        return { blocked: false };
    }
    function getServerId(job) {
        return (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
            : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
    }
    const jobs = [];
    const skippedMaintenance = [];
    for (const marketKey of ['dark', 'home', 'soyuz']) {
        const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : soyuzMarketData;
        if (!md) continue;
        const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES_BG.includes(j.name) && !isJobBuggedBg(j) && !skipIds.has(j.id));
        const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES_BG.includes(j.name) && !isJobBuggedBg(j) && !skipIds.has(j.id));
        for (const job of openJobs) {
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = getServerId(job);
            const blocker = getPathBlocker(serverName);
            if (blocker.blocked) {
                skippedMaintenance.push({ serverName, serverId, blockerName: blocker.blockerName, blockerId: blocker.blockerId, maintenanceEndsAt: blocker.maintenanceEndsAt });
                continue;
            }
            jobs.push({
                jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                marketId: MARKET_IDS[marketKey], marketKey,
                rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: false, canComplete: false, status: 'pending'
            });
        }
        for (const job of takenJobs) {
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = getServerId(job);
            const blocker = getPathBlocker(serverName);
            if (blocker.blocked) {
                skippedMaintenance.push({ serverName, serverId, blockerName: blocker.blockerName, blockerId: blocker.blockerId, maintenanceEndsAt: blocker.maintenanceEndsAt });
                continue;
            }
            jobs.push({
                jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                marketId: MARKET_IDS[marketKey], marketKey,
                rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: true, canComplete: !!job.canComplete, status: 'pending'
            });
        }
    }
    jobs.sort((a, b) => {
        const idxA = SERVER_PRIORITY.indexOf(a.serverName);
        const idxB = SERVER_PRIORITY.indexOf(b.serverName);
        // No-server jobs (e.g. File Decryption, serverName='None') sort first (-1)
        const spA = (a.serverName === 'None' || !a.serverName) ? -1 : (idxA >= 0 ? idxA : SERVER_PRIORITY.length);
        const spB = (b.serverName === 'None' || !b.serverName) ? -1 : (idxB >= 0 ? idxB : SERVER_PRIORITY.length);
        const sp = spA - spB;
        if (sp !== 0) return sp;
        const tpA = JOB_TYPE_PRIORITY.indexOf(a.name);
        const tpB = JOB_TYPE_PRIORITY.indexOf(b.name);
        return (tpA >= 0 ? tpA : JOB_TYPE_PRIORITY.length) - (tpB >= 0 ? tpB : JOB_TYPE_PRIORITY.length);
    });
    // Attach maintenance-skipped info for scheduling
    jobs._skippedMaintenance = skippedMaintenance;
    return jobs;
}

const BG_AUTO_JOBS_MAX_LOGS = 200;
async function bgAutoJobLog(msg, level) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = { time: timeStr, msg, level: level || 'info' };
    // Append directly to persisted debug logs array (works even when popup is closed)
    try {
        const data = await chrome.storage.local.get('autoJobsDebugLogs');
        const logs = Array.isArray(data.autoJobsDebugLogs) ? data.autoJobsDebugLogs : [];
        logs.push(entry);
        if (logs.length > BG_AUTO_JOBS_MAX_LOGS) logs.splice(0, logs.length - BG_AUTO_JOBS_MAX_LOGS);
        await chrome.storage.local.set({ autoJobsDebugLogs: logs });
    } catch (e) { /* storage error — ignore */ }
}

// Debounce scheduleAutoFinishAllBg to prevent duplicate calls from multiple storage triggers
let _scheduleAutoFinishDebounceTimer = null;
function scheduleAutoFinishAllBgDebounced() {
    if (_scheduleAutoFinishDebounceTimer) clearTimeout(_scheduleAutoFinishDebounceTimer);
    _scheduleAutoFinishDebounceTimer = setTimeout(() => {
        _scheduleAutoFinishDebounceTimer = null;
        scheduleAutoFinishAllBg();
    }, 2000);
}

async function scheduleAutoFinishAllBg() {
    const settings = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
    if (!settings.autoFinishAllJobsEnabled) {
        await chrome.alarms.clear('autoFinishAllJobs');
        return;
    }

    const { marketData, darkMarketData, soyuzMarketData, autoJobsRunning, serverMaintenanceMap } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData', 'autoJobsRunning', 'serverMaintenanceMap']);

    // If jobs are currently running, don't schedule — will be called again when they finish
    if (autoJobsRunning) {
        return;
    }

    // If an alarm is already pending, don't re-check (prevents duplicate "jobs available" messages)
    const existingAlarm = await chrome.alarms.get('autoFinishAllJobs');
    if (existingAlarm) {
        return;
    }

    // Check if jobs are available now (exclude previously failed/bugged and in-maintenance)
    const { autoJobsCompletedResults: crSched } = await chrome.storage.local.get('autoJobsCompletedResults');
    const availableNow = collectJobsBg(marketData, darkMarketData, crSched || [], serverMaintenanceMap, soyuzMarketData);
    if (availableNow.length > 0) {
        bgAutoJobLog('🔄 Auto Finish All: jobs available now — starting in 10s');
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: 10 / 60 });
        return;
    }

    // Find the earliest of: job reset time or maintenance end time for skipped servers
    let minWaitMs = Infinity;
    const now = Date.now();
    let scheduledReason = '';

    // Job reset times
    for (const md of [marketData, darkMarketData, soyuzMarketData]) {
        if (md && md.nextJobsResetAt) {
            const diff = new Date(md.nextJobsResetAt).getTime() - now;
            if (diff > 0 && diff < minWaitMs) {
                minWaitMs = diff;
                scheduledReason = 'job reset';
            }
        }
    }

    // Maintenance end times for blocker servers on path to skipped jobs
    const skipped = availableNow._skippedMaintenance || [];
    if (skipped.length > 0) {
        const seenBlockerIds = new Set();
        for (const s of skipped) {
            if (seenBlockerIds.has(s.blockerId)) continue;
            seenBlockerIds.add(s.blockerId);
            if (s.maintenanceEndsAt) {
                const diff = new Date(s.maintenanceEndsAt).getTime() - now;
                if (diff > 0 && diff < minWaitMs) {
                    minWaitMs = diff;
                    scheduledReason = `${s.blockerName} maintenance end`;
                }
            }
        }
        // Log which target servers are blocked and by which path servers
        const blockedPairs = [...new Set(skipped.map(s =>
            s.blockerName === s.serverName ? s.serverName : `${s.serverName} (blocked by ${s.blockerName})`
        ))].join(', ');
        bgAutoJobLog(`🔄 Auto Finish All: skipped jobs due to maintenance: ${blockedPairs}`, 'warn');
    }

    if (minWaitMs < Infinity) {
        const waitMs = minWaitMs + 15000; // 15s buffer
        const mins = Math.max(waitMs / 60000, 0.25);
        bgAutoJobLog(`🔄 Auto Finish All: next run scheduled in ${Math.floor(waitMs / 60000)}m ${Math.floor((waitMs % 60000) / 1000)}s (${scheduledReason})`);
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: mins });
    } else {
        bgAutoJobLog('🔄 Auto Finish All: no reset timer found — checking again in 5m');
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: 5 });
    }
}

async function runAutoFinishAllBg() {
    const settings = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
    if (!settings.autoFinishAllJobsEnabled) return;

    const { autoJobsRunning } = await chrome.storage.local.get('autoJobsRunning');
    if (autoJobsRunning) {
        // Jobs still running — don't interfere; storage listener will re-schedule when done
        return;
    }

    const tab = await getCor3Tab();
    if (!tab) {
        bgAutoJobLog('🔄 Auto Finish All: no cor3.gg tab found — retrying in 1m', 'warn');
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: 1 });
        return;
    }

    // Refresh network map to get latest server maintenance data
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'autoClearIpsCmd', cmd: 'get.map', data: {} });
    } catch (e) { /* best effort */ }
    await new Promise(r => setTimeout(r, 2000));

    // Try up to 3 times with ~1 min intervals to find jobs after reset
    for (let attempt = 1; attempt <= 3; attempt++) {
        // Re-check if jobs started running (e.g. manual start) during our wait
        const runCheck = await chrome.storage.local.get('autoJobsRunning');
        if (runCheck.autoJobsRunning) return;

        // Determine which markets need refresh (timer expired or no data)
        const { marketData: mdCheck, darkMarketData: dmdCheck, soyuzMarketData: smdCheck } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData']);
        const nowCheck = Date.now();
        const expiredMarkets = [];
        if (!mdCheck || !mdCheck.nextJobsResetAt || new Date(mdCheck.nextJobsResetAt).getTime() <= nowCheck) expiredMarkets.push('home');
        if (!dmdCheck || !dmdCheck.nextJobsResetAt || new Date(dmdCheck.nextJobsResetAt).getTime() <= nowCheck) expiredMarkets.push('dark');
        if (!smdCheck || !smdCheck.nextJobsResetAt || new Date(smdCheck.nextJobsResetAt).getTime() <= nowCheck) expiredMarkets.push('soyuz');

        // Order: soyuz → dark → home (furthest first)
        const refreshOrder = [];
        if (expiredMarkets.includes('soyuz')) refreshOrder.push('soyuz');
        if (expiredMarkets.includes('dark')) refreshOrder.push('dark');
        if (expiredMarkets.includes('home')) refreshOrder.push('home');

        bgAutoJobLog(`🔄 Auto Finish All: refreshing ${refreshOrder.length > 0 ? refreshOrder.join(', ') : 'all'} market data (attempt ${attempt}/3)...`);
        try {
            // Use sequential refresh for only the expired markets
            const refreshMsg = { action: "refreshAllMarketsSeq", skipLots: true };
            if (refreshOrder.length > 0) refreshMsg.order = refreshOrder;
            await chrome.tabs.sendMessage(tab.id, refreshMsg);
        } catch (e) {
            bgAutoJobLog('🔄 Auto Finish All: failed to refresh markets — ' + (e.message || e), 'error');
            scheduleAutoFinishAllBg();
            return;
        }

        // Wait for sequential refresh to complete (listen for COR3_ALL_MARKETS_REFRESHED via storage relay)
        // The signal is relayed by content.js to storage key _allMarketsRefreshed
        await new Promise(r => {
            let done = false;
            const listener = (changes, area) => {
                if (area === 'local' && changes._allMarketsRefreshed) {
                    done = true;
                    chrome.storage.onChanged.removeListener(listener);
                    clearTimeout(tmr);
                    r();
                }
            };
            chrome.storage.onChanged.addListener(listener);
            const tmr = setTimeout(() => {
                if (!done) {
                    chrome.storage.onChanged.removeListener(listener);
                    r(); // timeout fallback
                }
            }, 30000);
        });

        const { marketData, darkMarketData, soyuzMarketData, autoJobsCompletedResults: crRun, serverMaintenanceMap } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData', 'autoJobsCompletedResults', 'serverMaintenanceMap']);
        const jobsToRun = collectJobsBg(marketData, darkMarketData, crRun || [], serverMaintenanceMap, soyuzMarketData);

        if (jobsToRun.length > 0) {
            const skippedList = jobsToRun._skippedMaintenance || [];
            if (skippedList.length > 0) {
                const blockedPairs = [...new Set(skippedList.map(s =>
                    s.blockerName === s.serverName ? s.serverName : `${s.serverName} (blocked by ${s.blockerName})`
                ))].join(', ');
                bgAutoJobLog(`🔄 Auto Finish All: skipped ${skippedList.length} job(s) due to maintenance: ${blockedPairs}`, 'warn');
            }
            bgAutoJobLog(`🔄 Auto Finish All: starting ${jobsToRun.length} job(s)`);
            // Merge with existing tracker: keep previously completed/failed jobs
            const { autoJobsTracker: existingTracker } = await chrome.storage.local.get('autoJobsTracker');
            const newJobIds = new Set(jobsToRun.map(j => j.jobId));
            const previousJobs = (existingTracker || []).filter(j =>
                !newJobIds.has(j.jobId) && (j.status === 'done' || j.status === 'failed')
            );
            const mergedTracker = [...previousJobs, ...jobsToRun];
            await chrome.storage.local.set({ autoJobsRunning: true, autoJobsQueue: jobsToRun, autoJobsTracker: mergedTracker });
            try {
                await chrome.tabs.sendMessage(tab.id, { action: "startAutoJobs", jobs: jobsToRun });
            } catch (e) {
                bgAutoJobLog('🔄 Auto Finish All: failed to start — ' + (e.message || e), 'error');
                await chrome.storage.local.set({ autoJobsRunning: false });
            }
            // After jobs complete, storage listener will trigger re-schedule
            // (scheduleAutoFinishAllBg will check for remaining maintenance-skipped jobs)
            return;
        }

        // Check if only bugged/maintenance jobs remain
        const allUnfiltered = [];
        for (const md of [marketData, darkMarketData, soyuzMarketData]) {
            if (!md) continue;
            const open = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES_BG.includes(j.name));
            const taken = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES_BG.includes(j.name));
            allUnfiltered.push(...open, ...taken);
        }
        if (allUnfiltered.length > 0) {
            const skipped = jobsToRun._skippedMaintenance || [];
            if (skipped.length > 0) {
                const blockedPairs = [...new Set(skipped.map(s =>
                    s.blockerName === s.serverName ? s.serverName : `${s.serverName} (blocked by ${s.blockerName})`
                ))].join(', ');
                bgAutoJobLog(`🔄 Auto Finish All: remaining jobs blocked by maintenance: ${blockedPairs} — scheduling at maintenance end or reset.`, 'warn');
            } else {
                bgAutoJobLog('🔄 Auto Finish All: only bugged/failed jobs remain — waiting for next reset.', 'warn');
            }
            scheduleAutoFinishAllBg();
            return;
        }

        if (attempt < 3) {
            // Re-check updated job timers: if all markets now have future reset times,
            // reschedule at the earliest reset instead of waiting 60s for another attempt
            const { marketData: mdTimerCheck, darkMarketData: dmdTimerCheck, soyuzMarketData: smdTimerCheck } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData']);
            const nowTimerCheck = Date.now();
            let allFuture = true;
            let earliestResetMs = Infinity;
            for (const md of [mdTimerCheck, dmdTimerCheck, smdTimerCheck]) {
                if (!md || !md.nextJobsResetAt) { allFuture = false; break; }
                const resetMs = new Date(md.nextJobsResetAt).getTime();
                if (resetMs <= nowTimerCheck) { allFuture = false; break; }
                if (resetMs < earliestResetMs) earliestResetMs = resetMs;
            }
            if (allFuture && earliestResetMs < Infinity) {
                // All markets have future timers — no point retrying, schedule at earliest reset
                const waitMs = earliestResetMs - nowTimerCheck + 15000;
                const mins = Math.max(waitMs / 60000, 0.25);
                bgAutoJobLog(`🔄 Auto Finish All: all markets have future reset timers — scheduling next run in ${Math.floor(waitMs / 60000)}m ${Math.floor((waitMs % 60000) / 1000)}s`);
                await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: mins });
                return;
            }

            bgAutoJobLog(`🔄 Auto Finish All: no jobs found yet, retrying in 60s (attempt ${attempt}/3)...`, 'warn');
            await new Promise(r => setTimeout(r, 60000));
            // Re-check if still enabled
            const recheck = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
            if (!recheck.autoFinishAllJobsEnabled) return;
        }
    }

    bgAutoJobLog('🔄 Auto Finish All: no jobs found after 3 attempts — scheduling next check at reset');
    scheduleAutoFinishAllBg();
}

// --- Auto Clear Generated IPs (background) ---
// Servers to clear IPs from (skip D4RK RM7CE — often in maintenance)
const CLEAR_IP_SERVERS = [
    { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
    { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
    { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
    { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
    { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
    { name: 'RM7-S4L4', id: '019d1b0a-13a9-77dd-b41f-3ffb5f671742' },
    { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
    { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
    { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' }
];
const GENERATED_IP_PREFIXES = ['10.', '172.', '192.', '198.'];
const MAX_IPS_TO_KEEP = 10;
const CLEAR_IPS_INTERVAL_MINUTES = 180; // 3 hours

// Helper: send a WS command via content.js and wait for a storage-relayed response
function sendClearIpsCmd(tab, cmd, data) {
    return chrome.tabs.sendMessage(tab.id, { action: 'autoClearIpsCmd', cmd, data });
}

// Helper: wait for a specific event type from auto-job WS relay (stored briefly in storage)
function waitForClearIpsEvent(eventKey, timeoutMs) {
    return new Promise((resolve, reject) => {
        const listener = (changes, area) => {
            if (area === 'local' && changes[eventKey]) {
                chrome.storage.onChanged.removeListener(listener);
                clearTimeout(timer);
                resolve(changes[eventKey].newValue);
            }
        };
        chrome.storage.onChanged.addListener(listener);
        const timer = setTimeout(() => {
            chrome.storage.onChanged.removeListener(listener);
            reject(new Error('Timeout waiting for ' + eventKey));
        }, timeoutMs || 15000);
    });
}

async function scheduleAutoClearIpsBg() {
    const settings = await chrome.storage.sync.get('autoClearIpsEnabled');
    if (!settings.autoClearIpsEnabled) {
        await chrome.alarms.clear('autoClearIps');
        return;
    }
    // Check if already scheduled
    const existing = await chrome.alarms.get('autoClearIps');
    if (!existing) {
        bgAutoJobLog('🧹 Auto Clear IPs: scheduling first run in 30s');
        await chrome.alarms.create('autoClearIps', { delayInMinutes: 0.5 });
    }
}

async function clearIpsLoginToServer(tab, server) {
    // 1. Get login status
    await chrome.storage.local.remove('_clearIpsLoginStatus');
    await sendClearIpsCmd(tab, 'get.login.status', { serverId: server.id });
    let loginStatus;
    try {
        loginStatus = await waitForClearIpsEvent('_clearIpsLoginStatus', 10000);
    } catch (e) {
        throw new Error('Login status timeout');
    }
    if (loginStatus.error) {
        throw new Error('Login status error: ' + JSON.stringify(loginStatus.error));
    }

    const data = loginStatus.data;
    if (data && data.activeAccesses && data.activeAccesses.length > 0) {
        // Use existing access
        const accessId = data.activeAccesses[0].id;
        bgAutoJobLog(`🧹 ${server.name}: using existing access`);
        await chrome.storage.local.remove('_clearIpsLoginResult');
        await sendClearIpsCmd(tab, 'login.with-access', { serverId: server.id, accessGrantId: accessId });
        try {
            const lr = await waitForClearIpsEvent('_clearIpsLoginResult', 10000);
            if (lr.error || !(lr.data && lr.data.success)) {
                throw new Error('Login with access failed');
            }
        } catch (e) {
            throw new Error('Login with access failed: ' + e.message);
        }
    } else {
        // Need to hack — enable solvers BEFORE starting hack
        bgAutoJobLog(`🧹 ${server.name}: no access — hacking...`);
        try {
            await chrome.tabs.sendMessage(tab.id, { action: 'enableHackSolvers' });
        } catch (e) { /* best effort */ }
        await new Promise(r => setTimeout(r, 300));
        await chrome.storage.local.remove(['_clearIpsHackStart', '_clearIpsSaiUpdate']);
        await sendClearIpsCmd(tab, 'hack.start', { serverId: server.id });
        let hackResult;
        try {
            hackResult = await waitForClearIpsEvent('_clearIpsHackStart', 30000);
        } catch (e) {
            throw new Error('Hack start timeout');
        }
        if (hackResult.error) {
            throw new Error('Hack failed: ' + (hackResult.error.message || JSON.stringify(hackResult.error)));
        }
        // Hack minigame started — wait for SAI update (solver completes hack)
        bgAutoJobLog(`🧹 ${server.name}: hack started, waiting for solver...`);
        try {
            await waitForClearIpsEvent('_clearIpsSaiUpdate', 120000);
            bgAutoJobLog(`🧹 ${server.name}: hack completed (SAI update received)`);
        } catch (e) {
            bgAutoJobLog(`🧹 ${server.name}: SAI update timeout — checking login status`, 'warn');
        }
        await new Promise(r => setTimeout(r, 1000));

        // After hack, get login status again and use access
        for (let attempt = 1; attempt <= 3; attempt++) {
            await chrome.storage.local.remove('_clearIpsLoginStatus');
            await sendClearIpsCmd(tab, 'get.login.status', { serverId: server.id });
            try {
                loginStatus = await waitForClearIpsEvent('_clearIpsLoginStatus', 5000);
            } catch (e) {
                if (attempt < 3) { await new Promise(r => setTimeout(r, 3000)); continue; }
                throw new Error('Login status timeout after hack');
            }
            if (loginStatus.data && loginStatus.data.activeAccesses && loginStatus.data.activeAccesses.length > 0) {
                const aid = loginStatus.data.activeAccesses[0].id;
                await chrome.storage.local.remove('_clearIpsLoginResult');
                await sendClearIpsCmd(tab, 'login.with-access', { serverId: server.id, accessGrantId: aid });
                try { await waitForClearIpsEvent('_clearIpsLoginResult', 10000); } catch (e) { /* proceed */ }
                return; // logged in
            }
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
        }
        throw new Error('No access after hack (3 attempts)');
    }
}

async function runAutoClearIpsBg() {
    const settings = await chrome.storage.sync.get('autoClearIpsEnabled');
    if (!settings.autoClearIpsEnabled) return;

    // Don't run while auto jobs are running
    const { autoJobsRunning } = await chrome.storage.local.get('autoJobsRunning');
    if (autoJobsRunning) {
        bgAutoJobLog('🧹 Auto Clear IPs: jobs running, retrying in 5m');
        await chrome.alarms.create('autoClearIps', { delayInMinutes: 5 });
        return;
    }

    const tab = await getCor3Tab();
    if (!tab) {
        bgAutoJobLog('🧹 Auto Clear IPs: no cor3.gg tab — retrying in 5m', 'warn');
        await chrome.alarms.create('autoClearIps', { delayInMinutes: 5 });
        return;
    }

    bgAutoJobLog('🧹 Auto Clear IPs: starting cleanup...');
    let totalDeleted = 0;

    for (let si = 0; si < CLEAR_IP_SERVERS.length; si++) {
        const server = CLEAR_IP_SERVERS[si];

        // Re-check settings each iteration
        const recheck = await chrome.storage.sync.get('autoClearIpsEnabled');
        if (!recheck.autoClearIpsEnabled) return;

        try {
            // 1. Set endpoint
            await chrome.storage.local.remove('_clearIpsEndpoint');
            await sendClearIpsCmd(tab, 'set.endpoint', { serverId: server.id });
            let endpointResult;
            try {
                endpointResult = await waitForClearIpsEvent('_clearIpsEndpoint', 10000);
            } catch (e) {
                // Timeout — may already be set, continue
            }
            if (endpointResult && endpointResult.unreachable) {
                bgAutoJobLog(`🧹 ${server.name}: unreachable — skipping`, 'warn');
                continue;
            }
            await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 1000)));

            // 2. Login (get login status → use access or hack → login)
            try {
                await clearIpsLoginToServer(tab, server);
            } catch (e) {
                bgAutoJobLog(`🧹 ${server.name}: login failed — ${e.message}`, 'warn');
                continue;
            }
            await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 500)));

            // 3. Get transit data
            await chrome.storage.local.remove('_clearIpsTransit');
            await sendClearIpsCmd(tab, 'get.transit', { serverId: server.id });
            let transitResult;
            try {
                transitResult = await waitForClearIpsEvent('_clearIpsTransit', 10000);
            } catch (e) {
                bgAutoJobLog(`🧹 ${server.name}: transit timeout — skipping`, 'warn');
                continue;
            }

            if (!transitResult || transitResult.error) {
                const errMsg = transitResult && transitResult.error ? (transitResult.error.message || JSON.stringify(transitResult.error)) : 'unknown';
                bgAutoJobLog(`🧹 ${server.name}: transit error (${errMsg}) — skipping`, 'warn');
                continue;
            }

            // 4. Filter generated IPs
            // Transit data may be an array directly or an object with a nested array (e.g. {transit: [...]})
            let allIps = [];
            const td = transitResult.data;
            bgAutoJobLog(`🧹 ${server.name}: transit data type=${Array.isArray(td) ? 'array' : typeof td}, keys=${td && typeof td === 'object' && !Array.isArray(td) ? Object.keys(td).join(',') : 'n/a'}`);
            if (Array.isArray(td)) {
                allIps = td;
            } else if (td && typeof td === 'object') {
                // Try common nested keys
                allIps = td.transit || td.ips || td.entries || (Object.values(td).find(v => Array.isArray(v))) || [];
            }
            if (!Array.isArray(allIps)) {
                bgAutoJobLog(`🧹 ${server.name}: unexpected transit data format — skipping`, 'warn');
                continue;
            }
            const generatedIps = allIps.filter(ip => {
                const addr = ip.ip || '';
                return GENERATED_IP_PREFIXES.some(p => addr.startsWith(p));
            });

            if (generatedIps.length <= MAX_IPS_TO_KEEP) {
                bgAutoJobLog(`🧹 ${server.name}: ${generatedIps.length} IPs (≤${MAX_IPS_TO_KEEP}) — OK`);
                continue;
            }

            // 5. Delete excess IPs (keep last MAX_IPS_TO_KEEP, delete from start)
            const toDelete = generatedIps.slice(0, generatedIps.length - MAX_IPS_TO_KEEP);
            bgAutoJobLog(`🧹 ${server.name}: ${generatedIps.length} IPs — deleting ${toDelete.length} excess`);

            for (let i = 0; i < toDelete.length; i++) {
                const ip = toDelete[i];
                await chrome.storage.local.remove('_clearIpsTransitRemove');
                await sendClearIpsCmd(tab, 'transit.remove', { serverId: server.id, ip: ip.ip });
                try {
                    const removeResult = await waitForClearIpsEvent('_clearIpsTransitRemove', 10000);
                    if (removeResult && !removeResult.error) {
                        totalDeleted++;
                        bgAutoJobLog(`🧹 IP deleted -> ` + ip.ip);
                    } else if (removeResult && removeResult.error) {
                        const errMsg = removeResult.error.message || removeResult.error;
                        if (errMsg === 'sai-access-denied') {
                            bgAutoJobLog(`🧹 ${server.name}: access denied (server entered maintenance) — skipping to next server`, 'warn');
                            break;
                        }
                        bgAutoJobLog(`🧹 ${server.name}: failed to remove ${ip.ip} (${errMsg})`, 'warn');
                    } else {
                        bgAutoJobLog(`🧹 ${server.name}: failed to remove ${ip.ip}`, 'warn');
                    }
                } catch (e) {
                    bgAutoJobLog(`🧹 ${server.name}: timeout removing ${ip.ip}`, 'warn');
                }
                await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 500)));
            }

        } catch (e) {
            bgAutoJobLog(`🧹 ${server.name}: error — ${e.message}`, 'error');
        }

        // Human-like delay between servers
        if (si < CLEAR_IP_SERVERS.length - 1) {
            await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 2000)));
        }
    }

    // Cleanup temp storage keys
    await chrome.storage.local.remove([
        '_clearIpsTransit', '_clearIpsTransitRemove', '_clearIpsEndpoint',
        '_clearIpsLoginStatus', '_clearIpsLoginResult', '_clearIpsHackStart', '_clearIpsSaiUpdate'
    ]);

    // Schedule next run
    bgAutoJobLog(`🧹 Auto Clear IPs: done (${totalDeleted} IPs removed). Next in ${CLEAR_IPS_INTERVAL_MINUTES / 60}h`);
    await chrome.alarms.create('autoClearIps', { delayInMinutes: CLEAR_IPS_INTERVAL_MINUTES });
}

// Listen for chrome.alarms
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'autoFinishAllJobs') {
        runAutoFinishAllBg();
    }
    if (alarm.name === 'autoClearIps') {
        runAutoClearIpsBg();
    }
});

// Re-schedule when autoJobsRunning changes to false (jobs completed)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.autoJobsRunning) {
        if (!changes.autoJobsRunning.newValue) {
            // Jobs finished — auto-job-solver already refreshed markets, just schedule next run
            (async () => {
                try {
                    const settings = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
                    if (!settings.autoFinishAllJobsEnabled) return;
                } catch (e) { /* best effort */ }
                scheduleAutoFinishAllBgDebounced();
            })();
        }
    }
    // Only re-schedule when nextJobsResetAt actually changes (new reset cycle), not on every market data update
    if (area === 'local' && (changes.marketData || changes.darkMarketData || changes.soyuzMarketData)) {
        const resetChanged = (change) => {
            if (!change) return false;
            const oldReset = change.oldValue && change.oldValue.nextJobsResetAt;
            const newReset = change.newValue && change.newValue.nextJobsResetAt;
            return newReset && newReset !== oldReset;
        };
        const homeReset = resetChanged(changes.marketData);
        const darkReset = resetChanged(changes.darkMarketData);
        const soyuzReset = resetChanged(changes.soyuzMarketData);
        if (homeReset || darkReset || soyuzReset) {
            // Clear old tracker/completedResults for reset markets (works even when popup is closed)
            chrome.storage.local.get(['autoJobsTracker', 'autoJobsCompletedResults'], (result) => {
                let tracker = Array.isArray(result.autoJobsTracker) ? result.autoJobsTracker : [];
                let cr = Array.isArray(result.autoJobsCompletedResults) ? result.autoJobsCompletedResults : [];
                if (homeReset) {
                    tracker = tracker.filter(j => (j.marketKey || 'home') !== 'home');
                    cr = cr.filter(j => j.marketKey !== 'home');
                }
                if (darkReset) {
                    tracker = tracker.filter(j => j.marketKey !== 'dark');
                    cr = cr.filter(j => j.marketKey !== 'dark');
                }
                if (soyuzReset) {
                    tracker = tracker.filter(j => j.marketKey !== 'soyuz');
                    cr = cr.filter(j => j.marketKey !== 'soyuz');
                }
                chrome.storage.local.set({ autoJobsTracker: tracker, autoJobsCompletedResults: cr });
            });
            chrome.storage.sync.get('autoFinishAllJobsEnabled', (data) => {
                if (data.autoFinishAllJobsEnabled) scheduleAutoFinishAllBgDebounced();
            });
        }
    }
});

// Schedule on startup if enabled
scheduleAutoFinishAllBg();
scheduleAutoClearIpsBg();

// --- Message listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "alarmActiveStatus") {
        sendResponse({ success: true });
        return true;
    }
    if (request.action === "scheduleAutoFinishAll") {
        scheduleAutoFinishAllBg();
        sendResponse({ success: true });
        return true;
    }
    if (request.action === "scheduleAutoClearIps") {
        scheduleAutoClearIpsBg();
        sendResponse({ success: true });
        return true;
    }
});
