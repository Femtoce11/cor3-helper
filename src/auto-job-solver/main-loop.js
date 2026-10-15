// Auto Job Solver — main loop (processQueue + message listener).

import { MARKET_SERVER_NAMES } from '../shared/server-constants.js';
import { humanDelay } from '../shared/ws-utils.js';
import { friendlyError } from '../shared/error-map.js';
import { getServerTypeName } from '../shared/loadout-resolver.js';
import { state, serverMap, sendCmd, delay, log, DARK_MARKET_SERVER_ID, SOYUZ_MARKET_SERVER_ID, USOL_MARKET_SERVER_ID, SERVER_PATH_MAP } from './state.js';
import { getServerPriority, getJobTypePriority, isJobBugged, updateTracker, saveCompletedResultsIncremental, signalDone, fetchMapData, checkPathMaintenance, invalidateLoadoutCache, ensureLoadoutForJob } from './helpers.js';
import { stepSetEndpoint, stepLogin, stepCompleteJob } from './steps.js';
import { solveJob } from './solvers.js';
import { waitForIceWallStuckClear, waitForMinigameWindow } from '../shared/hack-utils.js';

export async function processQueue() {
    if (state.running) {
        log('Auto Job Solver already running — ignoring duplicate start', 'warn');
        return;
    }

    if (state.abortFlag) {
        log('Stop signal received before start — aborting', 'warn');
        signalDone();
        return;
    }
    state.running = true;
    state.abortFlag = false;

    try {

    // Wait if initial page load fetch is still in progress
    var waitAttempts = 0;
    while (window.__cor3InitialFetchInProgress && waitAttempts < 10 && !state.abortFlag) {
        waitAttempts++;
        log('Initial page load in progress — delaying auto-jobs start (attempt ' + waitAttempts + '/10, waiting 10s)...', 'warn');
        await new Promise(function (r) { setTimeout(r, 10000); });
    }
    if (state.abortFlag) { signalDone(); return; }
    if (window.__cor3InitialFetchInProgress) {
        log('⚠️ Initial page load still in progress after 100s — proceeding anyway', 'warn');
    }
    state.tokenExpired = false;
    state._lastLoadoutServerType = null;
    state._lastEndpointServerId = null;
    invalidateLoadoutCache();

    // Sort jobs by server priority (furthest first), then by server type (to group
    // servers needing the same hack software together, minimizing loadout swaps),
    // then by job type priority within same server
    state.jobQueue.sort(function (a, b) {
        var pa = getServerPriority(a.serverName || '');
        var pb = getServerPriority(b.serverName || '');
        if (pa !== pb) return pa - pb;
        var sta = (a.serverId ? getServerTypeName(a.serverId) : '') || '';
        var stb = (b.serverId ? getServerTypeName(b.serverId) : '') || '';
        if (sta !== stb) return sta < stb ? -1 : 1;
        var ta = getJobTypePriority(a.type || a.name || '');
        var tb = getJobTypePriority(b.type || b.name || '');
        return ta - tb;
    });

    log('Auto Job Solver started — processing ' + state.jobQueue.length + ' job(s)');

    // Apply locked-job states from ICE Wall reload (if any)
    var lockedJobs = state.solverSettings && state.solverSettings.lockedJobs;
    if (lockedJobs && lockedJobs.length > 0) {
        var now = Date.now();
        var appliedCount = 0;
        for (var lk = 0; lk < lockedJobs.length; lk++) {
            var locked = lockedJobs[lk];
            var matchingJob = state.jobQueue.find(function (j) { return j.jobId === locked.jobId; });
            if (!matchingJob) {
                log('Locked job ' + locked.jobId + ' no longer in queue — ignoring', 'warn');
                continue;
            }
            if (locked.lockExpiresAt && new Date(locked.lockExpiresAt).getTime() > now) {
                var lockMins = Math.ceil((new Date(locked.lockExpiresAt).getTime() - now) / 60000);
                matchingJob.status = 'skipped';
                matchingJob.error = 'Minigame locked (~' + lockMins + 'm remaining)';
                matchingJob.lockExpiresAt = locked.lockExpiresAt;
                log('⚠️ Marked job as skipped (minigame locked): ' + matchingJob.name + ' — lock expires in ~' + lockMins + 'm', 'warn');
                appliedCount++;
            } else {
                log('Lock expired for job: ' + (matchingJob.name || locked.jobId) + ' — keeping as pending');
            }
        }
        if (appliedCount > 0) log(appliedCount + ' job(s) marked as skipped from previous ICE Wall lockout');
    }

    updateTracker();

    // Pre-start: check all servers for maintenance and skip unreachable jobs
    log('Checking server maintenance status...');
    state._cachedMapData = null;
    try {
        await fetchMapData(true);
        if (serverMap.isReady()) {
            var skippedCount = 0;
            for (var m = 0; m < state.jobQueue.length; m++) {
                var mj = state.jobQueue[m];
                if (mj.status !== 'pending') continue;
                var mCheck = serverMap.checkPathMaintenance(mj.serverName);
                if (mCheck.blocked && mCheck.blockerName !== 'no-path') {
                    var mMins = Math.ceil((mCheck.remainingMs || 0) / 60000);
                    var mMsg = mCheck.blockerName === mj.serverName
                        ? mj.serverName + ' in maintenance'
                        : mj.serverName + ' unreachable (' + mCheck.blockerName + ' in maintenance)';
                    mj.status = 'skipped';
                    mj.error = mMsg + ' (~' + mMins + 'm remaining)';
                    mj.maintenanceEndsAt = mCheck.endsAt || null;
                    log('\u26a0\ufe0f Skipping job: ' + mj.name + ' \u2014 ' + mMsg + ' (~' + mMins + 'm left)', 'warn');
                    skippedCount++;
                }
            }
            if (skippedCount > 0) {
                updateTracker();
                saveCompletedResultsIncremental();
                log(skippedCount + ' job(s) skipped due to server maintenance');
            } else {
                log('All servers reachable \u2014 no maintenance detected');
            }
        }
    } catch (e) {
        log('\u26a0\ufe0f Could not fetch network map for pre-start maintenance check: ' + e.message + ' \u2014 continuing anyway', 'warn');
    }

    // Auto-claim any already-completed jobs first
    var completedJobs = state.jobQueue.filter(function (j) { return j.canComplete; });
    if (completedJobs.length > 0) {
        log('Found ' + completedJobs.length + ' completable job(s) — claiming rewards first');
        for (var c = 0; c < completedJobs.length; c++) {
            if (state.abortFlag) break;
            var cj = completedJobs[c];
            cj.status = 'running';
            updateTracker();
            try {
                if (cj.marketKey === 'dark') {
                    await stepSetEndpoint(DARK_MARKET_SERVER_ID);
                } else if (cj.marketKey === 'soyuz') {
                    await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
                } else if (cj.marketKey === 'usol') {
                    await stepSetEndpoint(USOL_MARKET_SERVER_ID);
                }
                var cReward = await stepCompleteJob(cj);
                if (cReward) {
                    cj.status = 'done';
                    cj.reward = cReward;
                    log('✅ Claimed reward for completed job: ' + cj.name + ' — 💰' + cReward.credits, 'success');
                } else {
                    cj.status = 'failed';
                    cj.error = 'Job completion returned no reward';
                    log('Job completion returned no reward: ' + cj.name, 'warn');
                }
            } catch (e) {
                cj.status = 'failed';
                cj.error = e.message;
                log('❌ Failed to claim reward: ' + cj.name + ' — ' + e.message, 'error');
            }
            updateTracker();
            saveCompletedResultsIncremental();
            await delay(humanDelay());
            sendCmd('get.jobs', { marketId: cj.marketId });
            await delay(1000);
        }
    }

    for (var i = 0; i < state.jobQueue.length; i++) {
        if (state.abortFlag) {
            log('Auto Jobs aborted by user', 'warn');
            break;
        }

        state.currentJobIndex = i;
        var job = state.jobQueue[i];

        if (job.status === 'done' || job.status === 'failed' || job.status === 'skipped' || job.status === 'bugged') {
            continue;
        }

        if (isJobBugged(job)) {
            job.status = 'bugged';
            job.error = 'Bugged: ' + (job.type || job.name) + ' on D4RK RM7CE (logs tab unavailable)';
            log('⚠️ Skipping bugged job: ' + job.name + ' on D4RK RM7CE — logs tab not available', 'warn');
            updateTracker();
            continue;
        }

        if (job.serverName) {
            var pathCheck = await checkPathMaintenance(job.serverName);
            if (pathCheck.blocked) {
                var mins = Math.ceil(pathCheck.remainingMs / 60000);
                var blockerMsg = pathCheck.blockerName === job.serverName
                    ? job.serverName + ' in maintenance'
                    : job.serverName + ' unreachable (' + pathCheck.blockerName + ' in maintenance)';
                job.status = 'skipped';
                job.error = blockerMsg + ' (~' + mins + 'm remaining)';
                job.maintenanceEndsAt = pathCheck.endsAt || null;
                log('⚠️ Skipping job: ' + job.name + ' — ' + blockerMsg + ' (~' + mins + 'm left)', 'warn');
                updateTracker();
                continue;
            }
        }

        job.status = 'running';
        state._currentJobRef = job;
        updateTracker();

        try {
            await ensureLoadoutForJob(job);
        } catch (loadoutErr) {
            log('Loadout pre-check warning: ' + loadoutErr.message + ' — proceeding anyway', 'warn');
        }

        var checkingAccessBeforeTake = false;
        try {
            if (!job.alreadyTaken && job.serverId) {
                checkingAccessBeforeTake = true;
                log('Checking target access before taking job: ' + (job.serverName || job.serverId));
                await stepSetEndpoint(job.serverId);
                await stepLogin(job.serverId);
                checkingAccessBeforeTake = false;
                log('Target access confirmed before taking job', 'success');
            }

            if (job.marketKey === 'dark') {
                await stepSetEndpoint(DARK_MARKET_SERVER_ID);
            } else if (job.marketKey === 'soyuz') {
                await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
            } else if (job.marketKey === 'usol') {
                await stepSetEndpoint(USOL_MARKET_SERVER_ID);
            }
            log('Processing job ' + (i + 1) + '/' + state.jobQueue.length + ': ' + (job.name || job.type));
            var reward = await solveJob(job);
            if (reward) {
                job.status = 'done';
                job.reward = reward;
                log('✅ Job completed: ' + job.name + ' — 💰' + reward.credits + ' ⭐' + reward.reputation + ' 🏅' + reward.renown, 'success');
            } else {
                job.status = 'failed';
                job.error = 'Job completion returned no reward';
                log('Job completion returned no reward: ' + job.name, 'warn');
            }
        } catch (e) {
            var errText = friendlyError(e.message);
            if (e.message && (e.message.includes('job-not-found-refresh') || e.message.includes('job-not-found') || e.message.includes('Job is not available'))) {
                job.status = 'skipped';
                job.error = 'Job no longer available (stale data)';
                log('⚠️ Job skipped (stale): ' + job.name + ' — refreshing all market data', 'warn');
                updateTracker();
                saveCompletedResultsIncremental();
                log('Refreshing all market data after stale job detected...');
                window.postMessage({ type: 'COR3_REFRESH_ALL_MARKETS_SEQ', skipLots: true }, '*');
                await new Promise(function (resolve) {
                    var refreshTimer = setTimeout(resolve, 30000);
                    function onRefreshDone(evt) {
                        if (evt.data && evt.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
                            window.removeEventListener('message', onRefreshDone);
                            clearTimeout(refreshTimer);
                            resolve();
                        }
                    }
                    window.addEventListener('message', onRefreshDone);
                });
                log('All market data refreshed — continuing with remaining jobs');
                state._currentJobRef = null;
                continue;
            }
            if (e.message === 'Aborted' || state.abortFlag) {
                job.status = 'skipped';
                job.error = 'Aborted by user';
                log('⚠️ Job aborted: ' + job.name, 'warn');
                state._currentJobRef = null;
                updateTracker();
                break;
            }
            if (e.message && (e.message.includes('token-expired') || e.message.includes('invalid-access-token'))) {
                job.status = 'skipped';
                job.error = errText;
                state.abortFlag = true;
                state.tokenExpired = true;
                log('⚠️ Job skipped (token expired): ' + job.name + ' — ' + errText, 'warn');
            } else if (e.message && e.message.includes('minigame-locked')) {
                job.lockExpiresAt = e.lockExpiresAt || null;
                log('🔒 Minigame locked — waiting up to 5s for minigame window to appear...', 'warn');
                var minigameType = await waitForMinigameWindow(5000);
                if (minigameType === 'icewall') {
                    log('ICE Wall minigame detected — checking for stuck state...', 'warn');
                    var iceWallResult = await waitForIceWallStuckClear(log, 10000);
                    if (iceWallResult.reloaded) {
                        job.status = 'skipped';
                        job.error = errText;
                        updateTracker();
                        saveCompletedResultsIncremental();
                        state._currentJobRef = null;
                        log('Requesting page reload to clear ICE Wall stuck UI — locked job: ' + job.name, 'warn');
                        window.postMessage({
                            type: 'COR3_AUTOJOB_ICE_WALL_RELOAD',
                            lockedJob: { jobId: job.jobId, lockExpiresAt: job.lockExpiresAt || null }
                        }, '*');
                        state.running = false;
                        return;
                    }
                    job.status = 'skipped';
                    job.error = errText;
                    log('⚠️ Job skipped (ICE Wall minigame locked, cleared): ' + job.name + ' — ' + errText, 'warn');
                } else {
                    job.status = 'skipped';
                    job.error = errText;
                    if (minigameType) {
                        log('⚠️ Job skipped (minigame locked, type: ' + minigameType + '): ' + job.name + ' — ' + errText, 'warn');
                    } else {
                        log('⚠️ Job skipped (minigame locked, no window detected): ' + job.name + ' — ' + errText, 'warn');
                    }
                }
            } else if (e.message && e.message.includes('Market not reachable')) {
                job.status = 'skipped';
                var marketServerName = MARKET_SERVER_NAMES[job.marketKey] || null;
                if (marketServerName) {
                    var mktCheck = await checkPathMaintenance(marketServerName);
                    if (mktCheck.blocked) {
                        var mktMins = Math.ceil(mktCheck.remainingMs / 60000);
                        job.error = 'Market unreachable (' + mktCheck.blockerName + ' in maintenance, ~' + mktMins + 'm remaining)';
                        job.maintenanceEndsAt = mktCheck.endsAt || null;
                        log('⚠️ Job skipped (market unreachable): ' + job.name + ' — ' + mktCheck.blockerName + ' in maintenance (~' + mktMins + 'm left)', 'warn');
                    } else {
                        job.error = errText;
                        job.maintenanceEndsAt = null;
                        log('⚠️ Job skipped (market unreachable): ' + job.name + ' — ' + errText, 'warn');
                    }
                } else {
                    job.error = errText;
                    job.maintenanceEndsAt = null;
                    log('⚠️ Job skipped (market unreachable): ' + job.name + ' — ' + errText, 'warn');
                }
            } else if (e.message && (e.message.includes('maintenance') || e.message.includes('unreachable'))) {
                job.status = 'skipped';
                job.error = errText;
                job.maintenanceEndsAt = null;
                log('⚠️ Job skipped (unreachable): ' + job.name + ' — ' + errText, 'warn');
            } else if (e.message && (e.message.includes('internal-error') || e.message.includes('Internal server error'))) {
                job.status = 'pending';
                job.error = null;
                log('⚠️ Internal server error on job: ' + job.name + ' — delaying entire process for 5 minutes before retrying...', 'warn');
                updateTracker();
                for (var waitMin = 5; waitMin > 0 && !state.abortFlag; waitMin--) {
                    log('⏳ Waiting ' + waitMin + ' minute(s) before resuming...', 'info');
                    await delay(60000);
                }
                if (!state.abortFlag) {
                    log('Resuming after internal server error delay — retrying job: ' + job.name);
                    i--;
                }
                state._currentJobRef = null;
                continue;
            } else if (e.message && (e.message.includes('Timeout') || e.message.includes('timed out') || e.message.includes('timeout'))) {
                job.status = 'skipped';
                job.error = errText + ' (will retry next run)';
                log('⚠️ Job skipped (timeout): ' + job.name + ' — ' + errText, 'warn');
            } else if (e.message && e.message.includes('rate-limited')) {
                job.status = 'skipped';
                job.error = errText + ' (will retry next run)';
                log('⚠️ Job skipped (rate limited): ' + job.name + ' — ' + errText, 'warn');
            } else if (checkingAccessBeforeTake) {
                job.status = 'skipped';
                job.error = 'Access pre-check failed: ' + errText;
                log('⚠️ Job skipped before taking: ' + job.name + ' — ' + errText, 'warn');
            } else {
                job.status = 'failed';
                job.error = errText;
                log('❌ Job failed: ' + job.name + ' — ' + errText, 'error');
            }
        }

        state._currentJobRef = null;
        updateTracker();
        saveCompletedResultsIncremental();

        if (state.abortFlag) break;
        try {
            await delay(humanDelay());
            sendCmd('get.jobs', { marketId: job.marketId });
            await delay(1000);
            if (i < state.jobQueue.length - 1 && !state.abortFlag) {
                var interJobDelay = 2000 + Math.floor(Math.random() * 1500);
                log('Waiting ' + Math.round(interJobDelay / 1000) + 's before next job...');
                await delay(interJobDelay);
            }
        } catch (delayErr) {
            if (state.abortFlag) break;
        }
    }

    // Summary
    var doneCount = state.jobQueue.filter(function (j) { return j.status === 'done'; }).length;
    var failedCount = state.jobQueue.filter(function (j) { return j.status === 'failed'; }).length;
    var buggedCount = state.jobQueue.filter(function (j) { return j.status === 'bugged'; }).length;
    var skippedCount = state.jobQueue.filter(function (j) { return j.status === 'skipped'; }).length;
    var totalCredits = state.jobQueue.reduce(function (sum, j) { return sum + (j.reward ? j.reward.credits : 0); }, 0);
    var totalDeposit = state.jobQueue.reduce(function (sum, j) { return sum + (j.reward ? (j.reward.deposit || 0) : (j.depositPaid || 0)); }, 0);
    var totalRep = state.jobQueue.reduce(function (sum, j) { return sum + (j.reward ? j.reward.reputation : 0); }, 0);
    var totalRenown = state.jobQueue.reduce(function (sum, j) { return sum + (j.reward ? j.reward.renown : 0); }, 0);

    var depositStr = totalDeposit > 0 ? ' (deposits: -' + totalDeposit + ')' : '';
    var buggedStr = buggedCount > 0 ? ', ' + buggedCount + ' bugged' : '';
    var skippedStr = skippedCount > 0 ? ', ' + skippedCount + ' skipped' : '';
    log('=== Auto Jobs Complete: ' + doneCount + ' done, ' + failedCount + ' failed' + buggedStr + skippedStr + '. Net: 💰' + totalCredits + depositStr + ' ⭐' + totalRep + ' 🏅' + totalRenown + ' ===', 'success');

    var completedResults = state.jobQueue.map(function (j) {
        return {
            jobId: j.jobId, name: j.name, type: j.type, serverName: j.serverName,
            marketKey: j.marketKey, status: j.status, reward: j.reward || null,
            error: j.error || null, completedAt: Date.now(),
            maintenanceEndsAt: j.maintenanceEndsAt || null,
            lockExpiresAt: j.lockExpiresAt || null
        };
    });
    window.postMessage({ type: 'COR3_AUTOJOB_SAVE_COMPLETED', jobs: completedResults }, '*');

    if (!state.abortFlag) {
        await new Promise(function (r) { setTimeout(r, 500); });
        log('Refreshing all markets sequentially...');
        window.postMessage({ type: 'COR3_REFRESH_ALL_MARKETS_SEQ', skipLots: true }, '*');
        await new Promise(function (resolve) {
            var timer = setTimeout(resolve, 30000);
            function onDone(evt) {
                if (evt.data && evt.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
                    window.removeEventListener('message', onDone);
                    clearTimeout(timer);
                    resolve();
                }
            }
            window.addEventListener('message', onDone);
        });
        log('Market refresh complete.');
    }

    } catch (queueErr) {
        if (queueErr && queueErr.message !== 'Aborted') {
            log('Unexpected error in processQueue: ' + queueErr.message, 'error');
        }
    } finally {
        signalDone();
    }
}
