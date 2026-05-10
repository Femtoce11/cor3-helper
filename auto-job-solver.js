// auto-job-solver.js
// Runs in MAIN world — orchestrates auto job solving via WS messages.
// Communicates with content-early.js via window.postMessage.

(function () {
    if (window.__cor3AutoJobSolverActive) return;
    window.__cor3AutoJobSolverActive = true;

    let jobQueue = [];
    let running = false;
    let abortFlag = false;
    let currentJobIndex = -1;

    // Known download folder IDs (desktop) — discovered at runtime
    let downloadFolderId = null;

    // D4RK market server ID — must set endpoint before interacting with D4RK jobs
    var DARK_MARKET_SERVER_ID = '019d29c5-4b37-79bf-b23e-304d8ea03c15';
    // SOYUZ market server ID — must set endpoint before interacting with SOYUZ jobs
    var SOYUZ_MARKET_SERVER_ID = '019da6f1-16f7-75a6-b6d3-0b1d5f92a108';

    // Server priority order (furthest first)
    var SERVER_PRIORITY = ['RM7-N1L1', 'RM7-W3NCP', 'RM7-N2L3', 'RM7-N2L2', 'RM7-N2ECP', 'D4RK RM7CE', 'RM7-S4L4', 'RM7-E1SCP', 'RM7-E1L2CT', 'RM7-E1L5', 'RM7-E1L3'];

    // Job type priority (lower index = processed first per server)
    // Transit-affecting jobs first, then simple jobs, then complex multi-step jobs
    var JOB_TYPE_PRIORITY = [
        'IP Injection',
        'IP Cleanup',
        'Data Upload',
        'Data Download',
        'Log Deletion',
        'Log Download',
        'File Elimination',
        'File Decryption',
        'Decrypt & Extract'
    ];

    // Server connection tree — maps each server name to all server IDs on the path
    // from HOME to that server (excluding HOME, which cannot be in maintenance).
    // If ANY server on the path is in maintenance, the target server is unreachable.
    var SERVER_PATH_MAP = {
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

    // Log-related job types that are bugged on D4RK RM7CE (server has no logs tab)
    var LOG_JOB_TYPES = ['Log Deletion', 'Log Download'];

    function isJobBugged(job) {
        return job.serverName === 'D4RK RM7CE' && LOG_JOB_TYPES.indexOf(job.type || job.name) >= 0;
    }

    function getServerPriority(serverName) {
        var idx = SERVER_PRIORITY.indexOf(serverName);
        return idx >= 0 ? idx : SERVER_PRIORITY.length;
    }

    function getJobTypePriority(typeName) {
        var idx = JOB_TYPE_PRIORITY.indexOf(typeName);
        return idx >= 0 ? idx : JOB_TYPE_PRIORITY.length;
    }

    function humanDelay() {
        return 800 + Math.floor(Math.random() * 700);
    }

    function log(msg, level) {
        level = level || 'info';
        console.log('[COR3 AutoJob]', msg);
        window.postMessage({ type: 'COR3_AUTOJOB_LOG', msg: msg, level: level }, '*');
    }

    function updateTracker() {
        window.postMessage({ type: 'COR3_AUTOJOB_TRACKER_UPDATE', tracker: jobQueue }, '*');
    }

    // Save completed/failed/bugged/skipped results incrementally so the debug console
    // can show final statuses even before the entire queue finishes.
    function saveCompletedResultsIncremental() {
        var results = jobQueue.filter(function (j) {
            return j.status === 'done' || j.status === 'failed' || j.status === 'bugged' || j.status === 'skipped';
        }).map(function (j) {
            return {
                jobId: j.jobId, name: j.name, type: j.type,
                serverName: j.serverName, marketKey: j.marketKey,
                status: j.status, reward: j.reward || null,
                error: j.error || null, completedAt: Date.now()
            };
        });
        if (results.length > 0) {
            window.postMessage({ type: 'COR3_AUTOJOB_SAVE_COMPLETED', jobs: results }, '*');
        }
    }

    function signalDone() {
        running = false;
        window.postMessage({ type: 'COR3_AUTOJOB_DONE' }, '*');
    }

    // Send a command to content-early.js
    function sendCmd(cmd, data) {
        window.postMessage({ type: 'COR3_AUTOJOB_CMD', cmd: cmd, data: data || {} }, '*');
    }

    // Ensure the auto-decrypt solver is enabled (content.js will inject it)
    function ensureDecryptSolverEnabled() {
        log('Ensuring auto-decrypt solver is enabled');
        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER' }, '*');
    }

    // Ensure the ICE wall solver is enabled (content.js will inject it)
    function ensureIceWallSolverEnabled() {
        log('Ensuring ICE wall solver is enabled');
        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_ICE_WALL_SOLVER' }, '*');
    }

    // Ensure the Simple decrypt solver is enabled (content.js will inject it)
    function ensureSimpleDecryptSolverEnabled() {
        log('Ensuring Simple decrypt solver is enabled');
        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_SIMPLE_DECRYPT_SOLVER' }, '*');
    }

    // Detect which hack minigame is active by polling the DOM
    function detectHackType(pollMs) {
        pollMs = pollMs || 3000;
        return new Promise(function (resolve) {
            var elapsed = 0;
            var interval = 200;
            function check() {
                if (document.querySelector('[data-component-name="WallBoard"]')) return resolve('ice-wall');
                if (document.querySelector('[data-sentry-component="ConfigHackApplication"]')) return resolve('decrypt');
                if (document.querySelector('[data-component-name="SimpleDecryptApplication"]') ||
                    document.querySelector('[data-sentry-component="SimpleDecryptApplication"]')) return resolve('simple-decrypt');
                elapsed += interval;
                if (elapsed >= pollMs) return resolve(null);
                setTimeout(check, interval);
            }
            check();
        });
    }

    // Wait for a specific postMessage event type, with timeout
    function waitForEvent(eventType, timeoutMs) {
        timeoutMs = timeoutMs || 15000;
        return new Promise(function (resolve, reject) {
            var timer;
            function handler(evt) {
                if (evt.data && evt.data.type === eventType) {
                    window.removeEventListener('message', handler);
                    clearTimeout(timer);
                    resolve(evt.data);
                }
            }
            window.addEventListener('message', handler);
            timer = setTimeout(function () {
                window.removeEventListener('message', handler);
                reject(new Error('Timeout waiting for ' + eventType));
            }, timeoutMs);
        });
    }

    // Delay helper
    function delay(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    // Check if ANY server on the path to serverName is in maintenance.
    // Returns { blocked: false } or { blocked: true, blockerName, remainingMs, endsAt }
    async function checkPathMaintenance(serverName) {
        var path = SERVER_PATH_MAP[serverName];
        if (!path || path.length === 0) return { blocked: false };
        sendCmd('get.map', {});
        try {
            var mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
            if (mapData && mapData.servers) {
                for (var i = 0; i < path.length; i++) {
                    var srv = path[i];
                    var info = mapData.servers[srv.id];
                    if (info && info.isInMaintenance) {
                        var remaining = info.maintenanceEndsAt ? new Date(info.maintenanceEndsAt).getTime() - Date.now() : 0;
                        if (remaining > 0) {
                            return { blocked: true, blockerName: srv.name, endsAt: info.maintenanceEndsAt, remainingMs: remaining };
                        }
                    }
                }
            }
        } catch (e) {
            log('⚠️ Could not fetch network map for maintenance check: ' + e.message, 'warn');
        }
        return { blocked: false };
    }

    // ---- Job Type Handlers ----

    // Reverse lookup: find server name from server ID using SERVER_PATH_MAP
    function getServerNameById(serverId) {
        for (var name in SERVER_PATH_MAP) {
            var path = SERVER_PATH_MAP[name];
            for (var i = 0; i < path.length; i++) {
                if (path[i].id === serverId) return path[i].name;
            }
        }
        return null;
    }

    // Find the path map entry for a target server by its ID
    function getPathForServerId(serverId) {
        for (var name in SERVER_PATH_MAP) {
            var path = SERVER_PATH_MAP[name];
            if (path.length > 0 && path[path.length - 1].id === serverId) {
                return path;
            }
        }
        return null;
    }

    // Internal: send set.endpoint and wait for result
    async function _sendSetEndpoint(serverId) {
        sendCmd('set.endpoint', { serverId: serverId });
        return await new Promise(function (resolve) {
            var timer;
            function endpointHandler(evt) {
                if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                    cleanup();
                    // Check if the endpoint result is a no-path or maintenance error
                    if (evt.data.success === false && evt.data.error &&
                        (evt.data.error.message === 'no-path-to-server' || evt.data.error.message === 'server-in-maintenance')) {
                        resolve({ ok: false, unreachable: true, errorMsg: evt.data.error.message });
                    } else {
                        resolve({ ok: true, data: evt.data });
                    }
                }
                if (evt.data && (evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE' || evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE')) {
                    cleanup();
                    resolve({ ok: false, unreachable: true });
                }
            }
            function cleanup() {
                window.removeEventListener('message', endpointHandler);
                clearTimeout(timer);
            }
            window.addEventListener('message', endpointHandler);
            timer = setTimeout(function () {
                window.removeEventListener('message', endpointHandler);
                resolve({ ok: true, timeout: true }); // timeout is non-fatal
            }, 10000);
        });
    }

    // Step: Set endpoint to target server, with path-through hack on failure
    async function stepSetEndpoint(serverId) {
        log('Setting endpoint to server ' + serverId);
        var raceResult = await _sendSetEndpoint(serverId);

        if (raceResult.unreachable) {
            // Try path-through: hack intermediate servers on the path
            var path = getPathForServerId(serverId);
            if (!path || path.length <= 1) {
                throw new Error('Server unreachable (no path to server) — may be in maintenance');
            }
            log('⚡ Server unreachable — attempting path-through hack (' + path.length + ' servers on path)');
            // Walk through each intermediate server (excluding the target itself which is the last)
            for (var pi = 0; pi < path.length - 1; pi++) {
                var intermediate = path[pi];
                log('⚡ Path-through: setting endpoint to ' + intermediate.name + ' (' + (pi + 1) + '/' + (path.length - 1) + ')');
                var intResult = await _sendSetEndpoint(intermediate.id);
                if (intResult.unreachable) {
                    log('⚡ Path-through: ' + intermediate.name + ' also unreachable — maintenance?', 'warn');
                    throw new Error('Path-through failed: ' + intermediate.name + ' unreachable');
                }
                await delay(humanDelay());
                // Login/hack to this intermediate server
                try {
                    await stepLogin(intermediate.id);
                } catch (e) {
                    log('⚡ Path-through: login/hack failed on ' + intermediate.name + ': ' + e.message, 'warn');
                    throw new Error('Path-through failed: could not login to ' + intermediate.name);
                }
                await delay(humanDelay());
            }
            // Retry the original endpoint
            log('⚡ Path-through complete — retrying endpoint to target server');
            raceResult = await _sendSetEndpoint(serverId);
            if (raceResult.unreachable) {
                throw new Error('Server still unreachable after path-through hack');
            }
        }

        if (raceResult.timeout) {
            log('Endpoint set timeout (may already be set)', 'warn');
        }
        await delay(humanDelay());
    }

    // Step: Login to server (use existing access or hack)
    async function stepLogin(serverId) {
        log('Checking login status for server ' + serverId);
        sendCmd('get.login.status', { serverId: serverId });
        var loginData;
        try {
            loginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
        } catch (e) {
            throw new Error('Failed to get login status: ' + e.message);
        }

        if (loginData.error) {
            throw new Error('Login status error: ' + JSON.stringify(loginData.error));
        }

        var data = loginData.data;
        // Check for active access
        if (data && data.activeAccesses && data.activeAccesses.length > 0) {
            var accessId = data.activeAccesses[0].id;
            log('Using existing access: ' + accessId);
            sendCmd('login.with-access', { serverId: serverId, accessGrantId: accessId });
            var loginResult;
            try {
                loginResult = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
            } catch (e) {
                throw new Error('Login with access timed out');
            }
            if (loginResult.error || !(loginResult.data && loginResult.data.success)) {
                throw new Error('Login with access failed');
            }
            log('Logged in via existing access', 'success');
        } else {
            // Need to hack
            log('No active access — starting hack');
            sendCmd('hack.start', { serverId: serverId });
            var hackResult;
            try {
                hackResult = await waitForEvent('COR3_AUTOJOB_SAI_HACK_START', 30000);
            } catch (e) {
                throw new Error('Hack start timed out');
            }
            if (hackResult.error) {
                throw new Error('Hack failed: ' + (hackResult.error.message || JSON.stringify(hackResult.error)));
            }
            // Hack minigame started — solvers will handle it
            ensureDecryptSolverEnabled();
            ensureIceWallSolverEnabled();
            ensureSimpleDecryptSolverEnabled();
            log('Hack minigame started, waiting for solver to complete...');

            // Detect which hack minigame appeared to set appropriate timeout
            var hackSolverTimeout = 30000; // default 30s for decrypt/simple
            var hackType = await detectHackType(3000);
            if (hackType === 'ice-wall') {
                hackSolverTimeout = 120000; // 2 minutes for ICE Wall
                log('ICE Wall hack detected — waiting up to 2 minutes');
            } else if (hackType) {
                log(hackType + ' hack detected');
            }

            // Wait for SAI update — solver often finishes so fast the event is missed
            var saiUpdateReceived = false;
            try {
                await waitForEvent('COR3_AUTOJOB_SAI_UPDATE', hackSolverTimeout);
                saiUpdateReceived = true;
            } catch (e) {
                log('SAI update not received in ' + (hackSolverTimeout / 1000) + 's — checking login status directly', 'warn');
            }
            if (saiUpdateReceived) {
                log('Hack completed', 'success');
            }
            // After hack (or timeout), check login status to see if we have access
            await delay(humanDelay());
            var maxRetries = 3;
            var loggedIn = false;
            for (var attempt = 0; attempt < maxRetries; attempt++) {
                sendCmd('get.login.status', { serverId: serverId });
                try {
                    loginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000);
                } catch (e) {
                    log('Login status not received after hack (attempt ' + (attempt + 1) + '/' + maxRetries + '), retrying...', 'warn');
                    continue;
                }
                if (loginData.data && loginData.data.activeAccesses && loginData.data.activeAccesses.length > 0) {
                    var aid = loginData.data.activeAccesses[0].id;
                    sendCmd('login.with-access', { serverId: serverId, accessGrantId: aid });
                    try {
                        await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
                    } catch (e) { /* proceed anyway */ }
                    loggedIn = true;
                    if (!saiUpdateReceived) log('Hack completed (confirmed via login status)', 'success');
                    break;
                } else {
                    log('No active access after hack (attempt ' + (attempt + 1) + '/' + maxRetries + '), retrying...', 'warn');
                    await delay(3000);
                }
            }
            if (!loggedIn) {
                throw new Error('No active access after hack (' + maxRetries + ' attempts) — hack may have failed');
            }
        }
        await delay(humanDelay());
    }

    // Step: Take a job from market (tracks deposit paid)
    // After taking, refreshes market data and updates job.conditions from recentJobs
    async function stepTakeJob(job) {
        // If job is already taken, skip take step
        if (job.alreadyTaken) {
            log('Job already taken — skipping take step');
            return;
        }
        log('Taking job ' + job.jobId);

        // Listen for deposit deduction (receive.credits with negative amount)
        var depositPaid = 0;
        var depositHandler = function (evt) {
            if (evt.data && evt.data.type === 'COR3_AUTOJOB_PROFILE_CREDITS' && evt.data.data) {
                if (evt.data.data.amount < 0) {
                    depositPaid = Math.abs(evt.data.data.amount);
                }
            }
        };
        window.addEventListener('message', depositHandler);

        // Listen for desktop file event to capture downloadFolderId and fileInfo dynamically
        var capturedFileInfo = null;
        var fileHandler = function (evt) {
            if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.data && evt.data.data.file) {
                var fileData = evt.data.data.file;
                capturedFileInfo = fileData;
                log('Captured file info: ' + fileData.name + ' (id: ' + fileData.id + ')');
                var fId = fileData.folderId;
                if (fId) {
                    downloadFolderId = fId;
                    log('Captured download folder ID: ' + fId);
                }
            }
        };
        window.addEventListener('message', fileHandler);

        sendCmd('job.take', { marketId: job.marketId, jobId: job.jobId });
        try {
            var result = await waitForEvent('COR3_AUTOJOB_JOB_TAKEN', 10000);
            if (result.error) {
                window.removeEventListener('message', depositHandler);
                window.removeEventListener('message', fileHandler);
                throw new Error('Job take error: ' + JSON.stringify(result.error));
            }
        } catch (e) {
            window.removeEventListener('message', depositHandler);
            window.removeEventListener('message', fileHandler);
            throw new Error('Failed to take job: ' + e.message);
        }
        window.removeEventListener('message', depositHandler);

        if (depositPaid > 0) {
            job.depositPaid = depositPaid;
            log('Job taken (deposit: ' + depositPaid + ' credits)', 'success');
        } else {
            log('Job taken successfully', 'success');
        }
        await delay(humanDelay());

        // Refresh market data to get updated conditions from recentJobs
        log('Refreshing market data for job conditions...');
        sendCmd('get.jobs', { marketId: job.marketId });
        // Listen for market data response to update job conditions
        var updatedConditions = await new Promise(function (resolve) {
            var timer;
            function handler(evt) {
                if (evt.data && (evt.data.type === 'COR3_WS_MARKET' || evt.data.type === 'COR3_WS_DARK_MARKET' || evt.data.type === 'COR3_WS_SOYUZ_MARKET')) {
                    var md = evt.data.market;
                    if (md && md.recentJobs) {
                        var rj = md.recentJobs.find(function (j) { return j.id === job.jobId; });
                        if (rj) {
                            cleanup();
                            resolve(rj);
                            return;
                        }
                    }
                }
            }
            function cleanup() {
                window.removeEventListener('message', handler);
                clearTimeout(timer);
            }
            window.addEventListener('message', handler);
            timer = setTimeout(function () {
                window.removeEventListener('message', handler);
                resolve(null);
            }, 5000);
        });

        // Stop listening for file events now that market refresh is done
        window.removeEventListener('message', fileHandler);

        // Store captured file info on the job for use by solvers
        if (capturedFileInfo) {
            job.fileInfo = capturedFileInfo;
        }

        if (updatedConditions) {
            // Update job conditions from recentJobs (this has the full details like IPs)
            if (updatedConditions.conditions && updatedConditions.conditions.items) {
                job.conditions = updatedConditions.conditions.items;
                log('Updated job conditions from server');
            }
            if (updatedConditions.canComplete !== undefined) {
                job.canComplete = updatedConditions.canComplete;
            }
        }
    }

    // Step: Get market jobs and check if job canComplete
    async function stepCheckJobComplete(marketId, jobId) {
        log('Checking job completion status');
        sendCmd('get.jobs', { marketId: marketId });
        // Wait for market data to arrive via existing market handler
        await delay(1000);
        // We return true/false but for now we'll try to complete
        return true;
    }

    // Step: Complete job and claim reward
    // job object is passed to use expected rewards as fallback
    async function stepCompleteJob(job) {
        log('Completing job and claiming reward');

        // Listen for profile events that carry the actual reward data
        var earnedCredits = 0;
        var earnedRenown = 0;
        var profileHandler = function (evt) {
            if (!evt.data) return;
            if (evt.data.type === 'COR3_AUTOJOB_PROFILE_PROGRESS' && evt.data.data) {
                earnedRenown = evt.data.data.amount || 0;
            }
            if (evt.data.type === 'COR3_AUTOJOB_PROFILE_CREDITS' && evt.data.data) {
                earnedCredits = evt.data.data.amount || 0;
            }
        };
        window.addEventListener('message', profileHandler);

        sendCmd('job.complete', { marketId: job.marketId, jobId: job.jobId });
        try {
            var result = await waitForEvent('COR3_AUTOJOB_JOB_COMPLETED', 20000);
            window.removeEventListener('message', profileHandler);

            if (result.error) {
                var errMsg = result.error.message || 'Unknown completion error';
                if (result.error.failedConditions && result.error.failedConditions.length > 0) {
                    errMsg += ': ' + result.error.failedConditions.join('; ');
                }
                log('Job completion error: ' + JSON.stringify(result.error), 'error');
                throw new Error(errMsg);
            }

            // Server responds with {status:"ok"} — actual rewards come from profile events
            // Use earned values from profile events, fall back to job's expected rewards
            var grossCredits = earnedCredits || job.rewardCredits || 0;
            var deposit = job.depositPaid || 0;
            var netCredits = grossCredits - deposit;
            var reputation = job.rewardReputation || 0;
            var renown = earnedRenown || 0;
            log('Job completed!', 'success');

            return {
                credits: netCredits,
                reputation: reputation,
                renown: renown,
                grossCredits: grossCredits,
                deposit: deposit
            };
        } catch (e) {
            window.removeEventListener('message', profileHandler);
            log('Job completion timed out: ' + e.message, 'error');
        }
        return null;
    }

    // Step: Discover Downloads folder ID
    // 1. Check local cache
    // 2. Check global cache set by content-early.js (from WS or HTTP polling intercept)
    // 3. Poll the global every 500ms for up to 5s (data may arrive from polling transport)
    // 4. Last resort: send explicit WS command and wait for postMessage response
    async function stepDiscoverDownloadFolder() {
        if (downloadFolderId) return downloadFolderId;

        // Check if content-early.js already captured it (from WS or polling)
        if (window.__cor3DownloadFolderId) {
            downloadFolderId = window.__cor3DownloadFolderId;
            log('Using cached Downloads folder ID: ' + downloadFolderId);
            return downloadFolderId;
        }

        // Poll the global — the HTTP polling interceptor may set it shortly
        log('Waiting for Downloads folder ID from polling/WS...');
        for (var attempt = 0; attempt < 10; attempt++) {
            await delay(500);
            if (window.__cor3DownloadFolderId) {
                downloadFolderId = window.__cor3DownloadFolderId;
                log('Got Downloads folder ID from polling: ' + downloadFolderId);
                return downloadFolderId;
            }
        }

        // Last resort: send explicit desktop.get.options WS command
        log('Sending explicit desktop.get.options command...');
        sendCmd('desktop.get.options', {});
        var result = await new Promise(function (resolve) {
            var timer;
            function handler(evt) {
                if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_OPTIONS') {
                    cleanup();
                    resolve(evt.data.data || null);
                }
            }
            function cleanup() {
                window.removeEventListener('message', handler);
                clearTimeout(timer);
            }
            window.addEventListener('message', handler);
            timer = setTimeout(function () {
                window.removeEventListener('message', handler);
                log('desktop.get.options WS command timed out after 8s', 'warn');
                resolve(null);
            }, 8000);
        });

        // Also check global one more time (polling response may have set it while we waited)
        if (!result && window.__cor3DownloadFolderId) {
            downloadFolderId = window.__cor3DownloadFolderId;
            log('Got Downloads folder ID from global after WS attempt: ' + downloadFolderId);
            return downloadFolderId;
        }

        if (result) {
            log('desktop.get.options response — folders: ' + (result.folders ? result.folders.length : 0) + ', files: ' + (result.files ? result.files.length : 0));
            if (result.folders) {
                var dlFolder = result.folders.find(function (f) { return f.name === 'Downloads'; });
                if (dlFolder) {
                    downloadFolderId = dlFolder.id;
                    log('Discovered Downloads folder ID: ' + dlFolder.id);
                    return dlFolder.id;
                }
                log('No "Downloads" folder found in: ' + result.folders.map(function(f) { return f.name; }).join(', '), 'warn');
            }
        } else {
            log('desktop.get.options returned null/empty', 'warn');
        }
        log('Could not discover Downloads folder ID', 'warn');
        return null;
    }

    // Helper: Extract file info from job conditions (for already-taken jobs)
    // Looks in conditions.details.files for file ID and name
    function extractFileInfoFromConditions(job) {
        if (!job.conditions) return null;
        for (var i = 0; i < job.conditions.length; i++) {
            var cond = job.conditions[i];
            if (cond.type === 'DecryptFile' && cond.details && cond.details.files && cond.details.files.length > 0) {
                return cond.details.files[0];
            }
        }
        return null;
    }

    // ---- File Decryption Job ----
    async function solveFileDecryption(job) {
        log('=== File Decryption: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Determine fileInfo — from take event, or from conditions for already-taken jobs
        var fileInfo = job.fileInfo || null;
        if (!fileInfo) {
            var condFile = extractFileInfoFromConditions(job);
            if (condFile) {
                fileInfo = condFile;
                log('Got file info from conditions: ' + condFile.name + ' (id: ' + condFile.id + ')');
            }
        }

        // 3. Ensure we have the Downloads folder ID
        if (!downloadFolderId) {
            await stepDiscoverDownloadFolder();
        }
        if (!downloadFolderId) {
            throw new Error('Download folder ID not found — could not discover Downloads folder');
        }

        // 4. Open download folder on desktop to find the encrypted file
        log('Opening download folder');
        await delay(humanDelay());
        sendCmd('open.folder', { folderId: downloadFolderId });

        var folderData;
        try {
            folderData = await waitForEvent('COR3_AUTOJOB_DESKTOP_FOLDER', 10000);
        } catch (e) {
            throw new Error('Failed to open download folder');
        }

        // Find the encrypted file — match by ID from fileInfo, or find newest
        var targetFile = null;
        if (folderData && folderData.data && folderData.data.files) {
            var files = folderData.data.files;
            if (fileInfo && fileInfo.id) {
                targetFile = files.find(function (f) { return f.id === fileInfo.id; });
            }
            if (!targetFile) {
                // Find the newest file (isNew flag or last in array)
                targetFile = files.find(function (f) { return f.isNew; }) || files[files.length - 1];
            }
        }

        if (!targetFile) {
            throw new Error('No encrypted file found in download folder');
        }

        // 5. Open file to trigger decrypt minigame
        ensureDecryptSolverEnabled();
        log('Opening file: ' + targetFile.name + ' — decrypt solver will handle minigame');
        sendCmd('open.file', { fileId: targetFile.id });

        // Wait for minigame to start and auto-solver to complete
        try {
            await waitForEvent('COR3_AUTOJOB_MINIGAME_START', 10000);
        } catch (e) {
            log('Minigame start not detected (solver may handle it directly)', 'warn');
        }

        // Wait for the solver to finish (file gets decrypted -> market update)
        log('Waiting for decrypt solver to complete...');
        await delay(5000);

        // 6. Refresh job list and complete
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- IP Injection Job ----
    async function solveIPInjection(job) {
        log('=== IP Injection: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for IP Injection job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Set endpoint to target server
        await stepSetEndpoint(job.serverId);

        // 3. Login to server
        await stepLogin(job.serverId);

        // 4. Get transit data
        log('Getting transit data');
        sendCmd('get.transit', { serverId: job.serverId });
        var transitData;
        try {
            transitData = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT', 10000);
        } catch (e) {
            throw new Error('Failed to get transit data');
        }

        if (transitData.error) {
            throw new Error('Transit error: ' + JSON.stringify(transitData.error));
        }

        // 5. Add the IPs from the job conditions
        var ipsToInject = [];
        if (job.conditions) {
            for (var c of job.conditions) {
                // Check details.ips array (primary source)
                if (c.details && c.details.ips && c.details.ips.length > 0) {
                    ipsToInject = c.details.ips;
                    break;
                }
                if (c.ip) {
                    ipsToInject.push(c.ip);
                    break;
                }
                if (c.targetIp) {
                    ipsToInject.push(c.targetIp);
                    break;
                }
            }
        }

        if (ipsToInject.length === 0) {
            throw new Error('Could not determine IPs to inject from job conditions');
        }

        for (var ipIdx = 0; ipIdx < ipsToInject.length; ipIdx++) {
            var ip = ipsToInject[ipIdx];
            log('Injecting IP (' + (ipIdx + 1) + '/' + ipsToInject.length + '): ' + ip);
            sendCmd('transit.add', { serverId: job.serverId, ip: ip, description: '' });

            try {
                var addResult = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT_ADD', 10000);
                if (addResult.error) {
                    var errMsg = addResult.error.message || '';
                    // IP already exists on server — skip to next IP
                    if (errMsg === 'sai-transit-ip-duplicate') {
                        log('IP ' + ip + ' already exists on server — skipping', 'warn');
                        if (ipIdx < ipsToInject.length - 1) await delay(humanDelay());
                        continue;
                    }
                    // Server IP limit reached — cannot add more IPs, skip this job
                    if (errMsg === 'sai-transit-ip-limit') {
                        var limit = addResult.error.limit || 20;
                        throw new Error('Server IP limit reached (' + limit + ' IPs max). Clear old IPs via Auto Clear Generated IPs toggle.');
                    }
                    throw new Error('IP injection failed for ' + ip + ': ' + JSON.stringify(addResult.error));
                }
            } catch (e) {
                if (e.message.indexOf('Server IP limit reached') === 0) throw e;
                throw new Error('IP injection timed out for ' + ip + ': ' + e.message);
            }
            if (ipIdx < ipsToInject.length - 1) await delay(humanDelay());
        }

        log('All IPs injected successfully', 'success');
        await delay(humanDelay());

        // 6. Complete job
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- Data Download Job ----
    async function solveDataDownload(job) {
        log('=== Data Download: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for Data Download job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Set endpoint
        await stepSetEndpoint(job.serverId);

        // 3. Login
        await stepLogin(job.serverId);

        // 4. Get files list
        log('Getting server files');
        sendCmd('get.files', { serverId: job.serverId });
        var filesData;
        try {
            filesData = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
        } catch (e) {
            throw new Error('Failed to get server files');
        }

        if (filesData.error) {
            throw new Error('Files error: ' + JSON.stringify(filesData.error));
        }

        // 5. Find the job file (has jobId matching ours)
        var jobFile = null;
        if (filesData.data && filesData.data.files) {
            jobFile = filesData.data.files.find(function (f) {
                return f.jobId === job.jobId;
            });
        }

        if (!jobFile) {
            // File may already be downloaded — skip to decrypt/complete
            log('Job file not found on server (may already be downloaded)', 'warn');
        } else {
            // 6. Download the file
            log('Downloading file: ' + jobFile.name);
            sendCmd('file.download', { serverId: job.serverId, fileId: jobFile.fileId });

            try {
                var dlResult = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DOWNLOAD', 10000);
                if (dlResult.error) {
                    // May already be downloaded
                    log('File download response: ' + JSON.stringify(dlResult.error), 'warn');
                }
            } catch (e) {
                log('File download timed out (may already be downloaded)', 'warn');
            }

            log('File downloaded', 'success');
        }
        await delay(humanDelay());

        // 7. Check if job is completable or needs decryption
        // Refresh market to check canComplete
        sendCmd('get.jobs', { marketId: job.marketId });
        await delay(1000);

        // Try to complete — if it fails, we may need to decrypt
        var reward = await stepCompleteJob(job);
        if (reward) return reward;

        // If not completed, might need decryption step
        log('Job not yet complete — checking if decryption needed');

        if (!downloadFolderId) {
            await stepDiscoverDownloadFolder();
        }
        if (!downloadFolderId) {
            throw new Error('Download folder ID not found — could not discover Downloads folder');
        }

        sendCmd('open.folder', { folderId: downloadFolderId });
        var folderData;
        try {
            folderData = await waitForEvent('COR3_AUTOJOB_DESKTOP_FOLDER', 10000);
        } catch (e) {
            log('Could not open download folder for decryption', 'warn');
            return null;
        }

        if (folderData && folderData.data && folderData.data.files && folderData.data.files.length > 0) {
            var encFile = folderData.data.files.find(function (f) { return f.isNew; }) || folderData.data.files[folderData.data.files.length - 1];
            if (encFile) {
                ensureDecryptSolverEnabled();
                log('Opening file for decryption: ' + encFile.name);
                sendCmd('open.file', { fileId: encFile.id });
                try {
                    await waitForEvent('COR3_AUTOJOB_MINIGAME_START', 10000);
                } catch (e) { /* solver may handle directly */ }
                log('Waiting for decrypt solver...');
                await delay(5000);

                // Try completing again
                reward = await stepCompleteJob(job);
            }
        }

        return reward;
    }

    // ---- Log Deletion Job ----
    async function solveLogDeletion(job) {
        log('=== Log Deletion: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for Log Deletion job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Set endpoint
        await stepSetEndpoint(job.serverId);

        // 3. Login
        await stepLogin(job.serverId);

        // 4. Get logs
        log('Getting server logs');
        sendCmd('get.logs', { serverId: job.serverId });
        var logsData;
        try {
            logsData = await waitForEvent('COR3_AUTOJOB_SAI_LOGS', 10000);
        } catch (e) {
            throw new Error('Failed to get server logs');
        }

        if (logsData.error) {
            throw new Error('Logs error: ' + JSON.stringify(logsData.error));
        }

        // 5. Find the job log (has jobId matching ours)
        var jobLog = null;
        if (logsData.data && logsData.data.logs) {
            jobLog = logsData.data.logs.find(function (l) {
                return l.jobId === job.jobId;
            });
        }

        if (!jobLog) {
            // Log may already be deleted — try completing
            log('Job log not found on server (may already be deleted)', 'warn');
            var reward = await stepCompleteJob(job);
            return reward;
        }

        // 6. Delete the log
        log('Deleting log seq ' + jobLog.seq + ': ' + jobLog.message);
        sendCmd('log.delete', { serverId: job.serverId, seq: jobLog.seq });

        try {
            var delResult = await waitForEvent('COR3_AUTOJOB_SAI_LOG_DELETE', 10000);
            if (delResult.error) {
                throw new Error('Log delete failed: ' + JSON.stringify(delResult.error));
            }
        } catch (e) {
            throw new Error('Log delete timed out: ' + e.message);
        }

        log('Log deleted', 'success');
        await delay(humanDelay());

        // 7. Complete job
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- Log Download Job ----
    async function solveLogDownload(job) {
        log('=== Log Download: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for Log Download job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Set endpoint
        await stepSetEndpoint(job.serverId);

        // 3. Login
        await stepLogin(job.serverId);

        // 4. Get logs
        log('Getting server logs');
        sendCmd('get.logs', { serverId: job.serverId });
        var logsData;
        try {
            logsData = await waitForEvent('COR3_AUTOJOB_SAI_LOGS', 10000);
        } catch (e) {
            throw new Error('Failed to get server logs');
        }

        if (logsData.error) {
            throw new Error('Logs error: ' + JSON.stringify(logsData.error));
        }

        // 5. Find the job log (has jobId matching ours)
        var jobLog = null;
        if (logsData.data && logsData.data.logs) {
            jobLog = logsData.data.logs.find(function (l) {
                return l.jobId === job.jobId;
            });
        }

        if (!jobLog) {
            // Log may already be downloaded — try completing
            log('Job log not found on server (may already be downloaded)', 'warn');
            var reward = await stepCompleteJob(job);
            return reward;
        }

        // 6. Download the log
        log('Downloading log seq ' + jobLog.seq + ': ' + jobLog.message);
        sendCmd('log.download', { serverId: job.serverId, seq: jobLog.seq });

        try {
            var dlResult = await waitForEvent('COR3_AUTOJOB_SAI_LOG_DOWNLOAD', 10000);
            if (dlResult.error) {
                // May already be downloaded
                log('Log download response: ' + JSON.stringify(dlResult.error), 'warn');
            }
        } catch (e) {
            log('Log download timed out (may already be downloaded)', 'warn');
        }

        log('Log downloaded', 'success');
        await delay(humanDelay());

        // 7. Complete job
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- Decrypt & Extract Job ----
    async function solveDecryptExtract(job) {
        log('=== Decrypt & Extract: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for Decrypt & Extract job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Set endpoint
        await stepSetEndpoint(job.serverId);

        // 3. Login
        await stepLogin(job.serverId);

        // 4. Get files list
        log('Getting server files');
        sendCmd('get.files', { serverId: job.serverId });
        var filesData;
        try {
            filesData = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
        } catch (e) {
            throw new Error('Failed to get server files');
        }

        if (filesData.error) {
            throw new Error('Files error: ' + JSON.stringify(filesData.error));
        }

        // 5. Find the job file
        var jobFile = null;
        if (filesData.data && filesData.data.files) {
            jobFile = filesData.data.files.find(function (f) {
                return f.jobId === job.jobId;
            });
        }

        var fileAlreadyDownloaded = false;
        if (!jobFile) {
            // File may already be downloaded — skip to decrypt step
            log('Job file not found on server (may already be downloaded)', 'warn');
            fileAlreadyDownloaded = true;
        } else {
            // 6. Download the file
            log('Downloading file: ' + jobFile.name);
            sendCmd('file.download', { serverId: job.serverId, fileId: jobFile.fileId });

            try {
                var dlResult = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DOWNLOAD', 10000);
                if (dlResult.error) {
                    log('File download response: ' + JSON.stringify(dlResult.error), 'warn');
                }
            } catch (e) {
                log('File download timed out (may already be downloaded)', 'warn');
            }

            log('File downloaded — now opening for decryption', 'success');
        }
        await delay(humanDelay());

        // 7. Open download folder and decrypt file
        if (!downloadFolderId) {
            await stepDiscoverDownloadFolder();
        }
        if (!downloadFolderId) {
            throw new Error('Download folder ID not found — could not discover Downloads folder');
        }

        sendCmd('open.folder', { folderId: downloadFolderId });
        var folderData;
        try {
            folderData = await waitForEvent('COR3_AUTOJOB_DESKTOP_FOLDER', 10000);
        } catch (e) {
            throw new Error('Failed to open download folder for decryption');
        }

        var encFile = null;
        if (folderData && folderData.data && folderData.data.files) {
            // Find newest file (usually the one just downloaded)
            encFile = folderData.data.files.find(function (f) { return f.isNew; }) ||
                      folderData.data.files[folderData.data.files.length - 1];
        }

        if (!encFile) {
            throw new Error('No file found in download folder for decryption');
        }

        // 8. Open file to trigger decrypt minigame
        ensureDecryptSolverEnabled();
        log('Opening file for decryption: ' + encFile.name);
        sendCmd('open.file', { fileId: encFile.id });

        try {
            await waitForEvent('COR3_AUTOJOB_MINIGAME_START', 10000);
        } catch (e) {
            log('Minigame start not detected (solver may handle directly)', 'warn');
        }

        log('Waiting for decrypt solver to complete...');
        await delay(5000);

        // 9. Complete job
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- File Elimination (DeleteFile) Job ----
    async function solveFileElimination(job) {
        log('=== File Elimination: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for File Elimination job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Set endpoint
        await stepSetEndpoint(job.serverId);

        // 3. Login
        await stepLogin(job.serverId);

        // 4. Get files list
        log('Getting server files');
        sendCmd('get.files', { serverId: job.serverId });
        var filesData;
        try {
            filesData = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
        } catch (e) {
            throw new Error('Failed to get server files');
        }

        if (filesData.error) {
            throw new Error('Files error: ' + JSON.stringify(filesData.error));
        }

        // 5. Find the job file (source=="job" and jobId matches, or match by fileIds from conditions)
        var jobFile = null;
        var targetFileIds = [];
        if (job.conditions) {
            for (var c = 0; c < job.conditions.length; c++) {
                if (job.conditions[c].type === 'DeleteFile' && job.conditions[c].details && job.conditions[c].details.fileIds) {
                    targetFileIds = job.conditions[c].details.fileIds;
                    break;
                }
            }
        }
        if (filesData.data && filesData.data.files) {
            // First try matching by jobId
            jobFile = filesData.data.files.find(function (f) { return f.jobId === job.jobId; });
            // Then try matching by fileIds from conditions
            if (!jobFile && targetFileIds.length > 0) {
                jobFile = filesData.data.files.find(function (f) { return targetFileIds.indexOf(f.fileId) >= 0; });
            }
            // Fallback: match by source="job"
            if (!jobFile) {
                jobFile = filesData.data.files.find(function (f) { return f.source === 'job'; });
            }
        }

        if (!jobFile) {
            log('Job file not found on server (may already be deleted)', 'warn');
            var reward = await stepCompleteJob(job);
            return reward;
        }

        // 6. Delete the file
        log('Deleting file: ' + jobFile.name + ' (fileId: ' + jobFile.fileId + ')');
        sendCmd('file.delete', { serverId: job.serverId, fileId: jobFile.fileId });

        try {
            var delResult = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DELETE', 10000);
            if (delResult.error) {
                throw new Error('File delete failed: ' + JSON.stringify(delResult.error));
            }
        } catch (e) {
            throw new Error('File delete timed out: ' + e.message);
        }

        log('File deleted', 'success');
        await delay(humanDelay());

        // 7. Complete job
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- Data Upload (UploadFile) Job ----
    async function solveDataUpload(job) {
        log('=== Data Upload: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for Data Upload job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // Determine file info from fileInfo (captured at take) or from conditions
        var uploadFile = job.fileInfo || null;
        if (!uploadFile && job.conditions) {
            for (var c = 0; c < job.conditions.length; c++) {
                if (job.conditions[c].type === 'UploadFile' && job.conditions[c].details && job.conditions[c].details.files && job.conditions[c].details.files.length > 0) {
                    uploadFile = job.conditions[c].details.files[0];
                    break;
                }
            }
        }
        if (!uploadFile) {
            throw new Error('Could not determine file to upload from job conditions');
        }

        // 2. Set endpoint
        await stepSetEndpoint(job.serverId);

        // 3. Login
        await stepLogin(job.serverId);

        // 4. Get files list (to see server state)
        log('Getting server files');
        sendCmd('get.files', { serverId: job.serverId });
        try {
            await waitForEvent('COR3_AUTOJOB_SAI_FILES', 10000);
        } catch (e) {
            log('Failed to get server files (non-fatal)', 'warn');
        }
        await delay(humanDelay());

        // 5. Upload the file
        log('Uploading file: ' + uploadFile.name);
        sendCmd('file.upload', { serverId: job.serverId, name: uploadFile.name, sizeMb: 0 });

        // Wait for file.upload SAI response confirming the upload
        try {
            await waitForEvent('COR3_AUTOJOB_SAI_FILE_UPLOAD', 10000);
            log('File upload confirmed by server', 'success');
        } catch (e) {
            log('File upload response not received (trying to complete anyway)', 'warn');
        }
        await delay(humanDelay());

        // 6. Complete job
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- IP Cleanup (DeleteIps) Job ----
    async function solveIPCleanup(job) {
        log('=== IP Cleanup: ' + job.jobId + ' ===');

        // 1. Take the job
        await stepTakeJob(job);

        if (!job.serverId) {
            throw new Error('No target server for IP Cleanup job');
        }

        // If already taken and completable, try completing first
        if (job.alreadyTaken && job.canComplete) {
            log('Job already taken and completable — completing now');
            var earlyReward = await stepCompleteJob(job);
            if (earlyReward) return earlyReward;
            log('Completion failed — continuing with remaining steps');
        } else if (job.alreadyTaken) {
            log('Job already taken but not yet completable — continuing with remaining steps');
        }

        // 2. Set endpoint
        await stepSetEndpoint(job.serverId);

        // 3. Login
        await stepLogin(job.serverId);

        // 4. Get transit data
        log('Getting transit data');
        sendCmd('get.transit', { serverId: job.serverId });
        var transitData;
        try {
            transitData = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT', 10000);
        } catch (e) {
            throw new Error('Failed to get transit data');
        }

        if (transitData.error) {
            throw new Error('Transit error: ' + JSON.stringify(transitData.error));
        }

        // 5. Determine IPs to remove — from conditions first, then from transit data (source="job")
        var ipsToRemove = [];
        if (job.conditions) {
            for (var c = 0; c < job.conditions.length; c++) {
                if (job.conditions[c].type === 'DeleteIps' && job.conditions[c].details && job.conditions[c].details.ips) {
                    ipsToRemove = job.conditions[c].details.ips;
                    break;
                }
            }
        }

        // Fallback: find IPs with source="job" and matching jobId in transit data
        if (ipsToRemove.length === 0 && transitData.data && transitData.data.ips) {
            var jobIps = transitData.data.ips.filter(function (entry) {
                return entry.source === 'job' && entry.jobId === job.jobId;
            });
            ipsToRemove = jobIps.map(function (entry) { return entry.ip; });
            if (ipsToRemove.length > 0) {
                log('Found ' + ipsToRemove.length + ' IP(s) to remove from transit data (source=job)');
            }
        }

        if (ipsToRemove.length === 0) {
            throw new Error('Could not determine IPs to remove from job conditions or transit data');
        }

        for (var ipIdx = 0; ipIdx < ipsToRemove.length; ipIdx++) {
            var ip = ipsToRemove[ipIdx];
            log('Removing IP (' + (ipIdx + 1) + '/' + ipsToRemove.length + '): ' + ip);
            sendCmd('transit.remove', { serverId: job.serverId, ip: ip });

            try {
                var rmResult = await waitForEvent('COR3_AUTOJOB_SAI_TRANSIT_REMOVE', 10000);
                if (rmResult.error) {
                    throw new Error('IP removal failed for ' + ip + ': ' + JSON.stringify(rmResult.error));
                }
            } catch (e) {
                throw new Error('IP removal timed out for ' + ip + ': ' + e.message);
            }
            if (ipIdx < ipsToRemove.length - 1) await delay(humanDelay());
        }

        log('All IPs removed successfully', 'success');
        await delay(humanDelay());

        // 6. Complete job
        var reward = await stepCompleteJob(job);
        return reward;
    }

    // ---- Main job dispatcher ----
    async function solveJob(job) {
        var type = job.type || job.name;
        switch (type) {
            case 'File Decryption':
                return await solveFileDecryption(job);
            case 'IP Injection':
                return await solveIPInjection(job);
            case 'Data Download':
                return await solveDataDownload(job);
            case 'Log Deletion':
                return await solveLogDeletion(job);
            case 'Log Download':
                return await solveLogDownload(job);
            case 'Decrypt & Extract':
                return await solveDecryptExtract(job);
            case 'File Elimination':
                return await solveFileElimination(job);
            case 'Data Upload':
                return await solveDataUpload(job);
            case 'IP Cleanup':
                return await solveIPCleanup(job);
            default:
                throw new Error('Unsupported job type: ' + type);
        }
    }

    // ---- Main loop ----
    async function processQueue() {
        if (running) return;
        running = true;
        abortFlag = false;

        // Sort jobs by server priority (furthest first), then by job type priority within same server
        jobQueue.sort(function (a, b) {
            var pa = getServerPriority(a.serverName || '');
            var pb = getServerPriority(b.serverName || '');
            if (pa !== pb) return pa - pb;
            var ta = getJobTypePriority(a.type || a.name || '');
            var tb = getJobTypePriority(b.type || b.name || '');
            return ta - tb;
        });

        log('Auto Job Solver started — processing ' + jobQueue.length + ' job(s)');
        updateTracker();

        // Pre-start: check all servers for maintenance and skip unreachable jobs
        log('Checking server maintenance status...');
        sendCmd('get.map', {});
        try {
            var preMapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
            if (preMapData && preMapData.servers) {
                var now = Date.now();
                var skippedCount = 0;
                for (var m = 0; m < jobQueue.length; m++) {
                    var mj = jobQueue[m];
                    if (mj.status !== 'pending') continue;
                    var path = SERVER_PATH_MAP[mj.serverName];
                    if (!path) continue;
                    for (var p = 0; p < path.length; p++) {
                        var srv = path[p];
                        var srvInfo = preMapData.servers[srv.id];
                        if (srvInfo && srvInfo.isInMaintenance) {
                            var rem = srvInfo.maintenanceEndsAt ? new Date(srvInfo.maintenanceEndsAt).getTime() - now : 0;
                            if (rem > 0) {
                                var mMins = Math.ceil(rem / 60000);
                                var mMsg = srv.name === mj.serverName
                                    ? mj.serverName + ' in maintenance'
                                    : mj.serverName + ' unreachable (' + srv.name + ' in maintenance)';
                                mj.status = 'skipped';
                                mj.error = mMsg + ' (~' + mMins + 'm remaining)';
                                log('⚠️ Skipping job: ' + mj.name + ' — ' + mMsg + ' (~' + mMins + 'm left)', 'warn');
                                skippedCount++;
                                break;
                            }
                        }
                    }
                }
                if (skippedCount > 0) {
                    updateTracker();
                    saveCompletedResultsIncremental();
                    log(skippedCount + ' job(s) skipped due to server maintenance');
                } else {
                    log('All servers reachable — no maintenance detected');
                }
            }
        } catch (e) {
            log('⚠️ Could not fetch network map for pre-start maintenance check: ' + e.message + ' — continuing anyway', 'warn');
        }

        // Auto-claim any already-completed jobs first
        var completedJobs = jobQueue.filter(function (j) { return j.canComplete; });
        if (completedJobs.length > 0) {
            log('Found ' + completedJobs.length + ' completable job(s) — claiming rewards first');
            for (var c = 0; c < completedJobs.length; c++) {
                if (abortFlag) break;
                var cj = completedJobs[c];
                cj.status = 'running';
                updateTracker();
                try {
                    // Set endpoint for D4RK/SOYUZ market jobs before completing
                    if (cj.marketKey === 'dark') {
                        await stepSetEndpoint(DARK_MARKET_SERVER_ID);
                    } else if (cj.marketKey === 'soyuz') {
                        await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
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
                // Human delay + market refresh after each auto-claim
                await delay(humanDelay());
                sendCmd('get.jobs', { marketId: cj.marketId });
                await delay(1000);
            }
        }

        for (var i = 0; i < jobQueue.length; i++) {
            if (abortFlag) {
                log('Auto Jobs aborted by user', 'warn');
                break;
            }

            currentJobIndex = i;
            var job = jobQueue[i];

            if (job.status === 'done' || job.status === 'failed' || job.status === 'skipped' || job.status === 'bugged') {
                continue;
            }

            // Skip bugged jobs (e.g. log jobs on D4RK RM7CE — server has no logs tab)
            if (isJobBugged(job)) {
                job.status = 'bugged';
                job.error = 'Bugged: ' + (job.type || job.name) + ' on D4RK RM7CE (logs tab unavailable)';
                log('⚠️ Skipping bugged job: ' + job.name + ' on D4RK RM7CE — logs tab not available', 'warn');
                updateTracker();
                continue;
            }

            // Skip jobs whose target server (or any server on the path to it) is in maintenance
            if (job.serverName) {
                var pathCheck = await checkPathMaintenance(job.serverName);
                if (pathCheck.blocked) {
                    var mins = Math.ceil(pathCheck.remainingMs / 60000);
                    var blockerMsg = pathCheck.blockerName === job.serverName
                        ? job.serverName + ' in maintenance'
                        : job.serverName + ' unreachable (' + pathCheck.blockerName + ' in maintenance)';
                    job.status = 'skipped';
                    job.error = blockerMsg + ' (~' + mins + 'm remaining)';
                    log('⚠️ Skipping job: ' + job.name + ' — ' + blockerMsg + ' (~' + mins + 'm left)', 'warn');
                    updateTracker();
                    continue;
                }
            }

            job.status = 'running';
            updateTracker();

            try {
                // Set endpoint for D4RK/SOYUZ market jobs before processing
                if (job.marketKey === 'dark') {
                    await stepSetEndpoint(DARK_MARKET_SERVER_ID);
                } else if (job.marketKey === 'soyuz') {
                    await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
                }
                log('Processing job ' + (i + 1) + '/' + jobQueue.length + ': ' + job.name + ' on ' + (job.serverName || 'None'));
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
                job.status = 'failed';
                job.error = e.message;
                log('❌ Job failed: ' + job.name + ' — ' + e.message, 'error');
            }

            updateTracker();
            saveCompletedResultsIncremental();

            // Human delay after job completion to avoid "too many requests"
            await delay(humanDelay());

            // Refresh market data so UI updates (completed jobs disappear)
            sendCmd('get.jobs', { marketId: job.marketId });
            await delay(1000);

            // Delay between jobs
            if (i < jobQueue.length - 1 && !abortFlag) {
                var interJobDelay = 2000 + Math.floor(Math.random() * 1500);
                log('Waiting ' + Math.round(interJobDelay / 1000) + 's before next job...');
                await delay(interJobDelay);
            }
        }

        // Summary
        var doneCount = jobQueue.filter(function (j) { return j.status === 'done'; }).length;
        var failedCount = jobQueue.filter(function (j) { return j.status === 'failed'; }).length;
        var buggedCount = jobQueue.filter(function (j) { return j.status === 'bugged'; }).length;
        var skippedCount = jobQueue.filter(function (j) { return j.status === 'skipped'; }).length;
        var totalCredits = jobQueue.reduce(function (sum, j) { return sum + (j.reward ? j.reward.credits : 0); }, 0);
        var totalDeposit = jobQueue.reduce(function (sum, j) { return sum + (j.reward ? (j.reward.deposit || 0) : (j.depositPaid || 0)); }, 0);
        var totalRep = jobQueue.reduce(function (sum, j) { return sum + (j.reward ? j.reward.reputation : 0); }, 0);
        var totalRenown = jobQueue.reduce(function (sum, j) { return sum + (j.reward ? j.reward.renown : 0); }, 0);

        var depositStr = totalDeposit > 0 ? ' (deposits: -' + totalDeposit + ')' : '';
        var buggedStr = buggedCount > 0 ? ', ' + buggedCount + ' bugged' : '';
        var skippedStr = skippedCount > 0 ? ', ' + skippedCount + ' skipped (maintenance)' : '';
        log('=== Auto Jobs Complete: ' + doneCount + ' done, ' + failedCount + ' failed' + buggedStr + skippedStr + '. Net: 💰' + totalCredits + depositStr + ' ⭐' + totalRep + ' 🏅' + totalRenown + ' ===', 'success');

        // Save completed/failed/bugged job results to storage for debug console persistence
        var completedResults = jobQueue.map(function (j) {
            return {
                jobId: j.jobId,
                name: j.name,
                type: j.type,
                serverName: j.serverName,
                marketKey: j.marketKey,
                status: j.status,
                reward: j.reward || null,
                error: j.error || null,
                completedAt: Date.now()
            };
        });
        window.postMessage({ type: 'COR3_AUTOJOB_SAVE_COMPLETED', jobs: completedResults }, '*');

        // Refresh all markets sequentially at the end to ensure UI is fully updated
        log('Refreshing all markets sequentially...');
        window.postMessage({ type: 'COR3_REFRESH_ALL_MARKETS_SEQ', skipLots: true }, '*');
        // Wait for completion signal (max 30s)
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

        signalDone();
    }

    // ---- Listen for start/stop commands ----
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;

        if (event.data && event.data.type === 'COR3_AUTOJOB_START') {
            jobQueue = event.data.jobs || [];
            processQueue();
        }

        if (event.data && event.data.type === 'COR3_AUTOJOB_STOP') {
            abortFlag = true;
            log('Stop signal received — aborting after current step', 'warn');
        }
    });

    console.log('[COR3 Helper] Auto Job Solver engine loaded');
})();
