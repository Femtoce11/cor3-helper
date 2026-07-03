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
    let tokenExpired = false;
    let solverSettings = {};
    let _currentJobRef = null; // Track current job for loadout retry context

    window.addEventListener('message', function (evt) {
        if (evt.data && evt.data.type === 'COR3_TOKEN_EXPIRED') {
            tokenExpired = true;
            if (running) {
                abortFlag = true;
                log('⚠️ Session token expired — aborting auto jobs (will reconnect)', 'warn');
            }
        }
    });

    // Known download folder IDs (desktop) — discovered at runtime
    let downloadFolderId = null;

    // D4RK market server ID — must set endpoint before interacting with D4RK jobs
    var DARK_MARKET_SERVER_ID = '019d29c5-4b37-79bf-b23e-304d8ea03c15';
    // SOYUZ market server ID — must set endpoint before interacting with SOYUZ jobs
    var SOYUZ_MARKET_SERVER_ID = '019da6f1-16f7-75a6-b6d3-0b1d5f92a108';
    // USOL market server ID — must set endpoint before interacting with USOL jobs
    var USOL_MARKET_SERVER_ID = '019e4052-c317-7388-9d71-883ffb1560cd';

    // Track the last endpoint server ID to avoid duplicate set.endpoint calls
    var _lastEndpointServerId = null;

    // Server priority order (furthest first)
    var SERVER_PRIORITY = ['URM7-H', 'URM7-M', 'URM7-S5L2', 'B43274N', 'B43272N', 'B43271N', 'D4RK RM7EG', 'SRM7-N3L2', 'SRM7-M', 'SRM7-N4L2', 'SRM7-N3L1', 'RM7-N1L1', 'RM7-W3NCP', 'RM7-N2L3', 'RM7-N2L2', 'RM7-N2ECP', 'D4RK RM7CE', 'RM7-S4WCP', 'RM7-S4L3', 'RM7-S4L1', 'RM7-S4L4', 'RM7-S4L2', 'RM7-E1SCP', 'RM7-E1L2CT', 'RM7-E1L5', 'RM7-E1L3'];

    // Job type priority (lower index = processed first per server)
    // Transit-affecting jobs last, simple first
    var JOB_TYPE_PRIORITY = [
        'File Decryption',
        'Log Deletion',
        'File Elimination',
        'Log Download',
        'Data Download',
        'Decrypt & Extract',
        'IP Injection',
        'IP Cleanup',
        'Data Upload'
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
        ],
        'SRM7-N3L1': [
            { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
            { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
            { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
            { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
            { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
            { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
            { name: 'SRM7-N3L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a107' }
        ],
        'SRM7-N4L2': [
            { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
            { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
            { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
            { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
            { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
            { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
            { name: 'SRM7-N3L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a107' },
            { name: 'SRM7-N4L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a10a' }
        ],
        'SRM7-M': [
            { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
            { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
            { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
            { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
            { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
            { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
            { name: 'SRM7-N3L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a107' },
            { name: 'SRM7-M', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108' }
        ],
        'SRM7-N3L2': [
            { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
            { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
            { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
            { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
            { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
            { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
            { name: 'SRM7-N3L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a107' },
            { name: 'SRM7-M', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108' },
            { name: 'SRM7-N3L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a109' }
        ],
        'RM7-S4L2': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' }
        ],
        'RM7-S4L3': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
            { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' }
        ],
        'RM7-S4L1': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'RM7-S4L4', id: '019d1b0a-13a9-77dd-b41f-3ffb5f671742' },
            { name: 'RM7-S4L1', id: '019e4052-c315-71df-80da-4e334b96c9e6' }
        ],
        'RM7-S4WCP': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
            { name: 'RM7-S4WCP', id: '019e4052-c316-73aa-81f6-448645a38c9e' }
        ],
        'D4RK RM7EG': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' },
            { name: 'D4RK RM7MI', id: '019d29c5-4b37-79bf-b23e-304d8ea03c15' },
            { name: 'D4RK RM7EG', id: '019e4052-c316-73aa-81f6-483e50247e61' }
        ],
        'B43271N': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1L2CT', id: '019d53aa-5101-7f08-b3dd-378b0ddcf7d0' },
            { name: 'B43271N', id: '019e4052-c316-73aa-81f6-567c9a8f5738' }
        ],
        'B43272N': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1L2CT', id: '019d53aa-5101-7f08-b3dd-378b0ddcf7d0' },
            { name: 'B43271N', id: '019e4052-c316-73aa-81f6-567c9a8f5738' },
            { name: 'B43272N', id: '019e4052-c316-73aa-81f6-5aa82fc72bdd' }
        ],
        'B43274N': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' },
            { name: 'D4RK RM7MI', id: '019d29c5-4b37-79bf-b23e-304d8ea03c15' },
            { name: 'D4RK RM7EG', id: '019e4052-c316-73aa-81f6-483e50247e61' },
            { name: 'B43274N', id: '019e4052-c316-73aa-81f6-60ec61b61f0a' }
        ],
        'URM7-S5L2': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
            { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' },
            { name: 'URM7-S5L2', id: '019e4052-c317-7388-9d71-85b98a02d5fb' }
        ],
        'URM7-M': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
            { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' },
            { name: 'URM7-S5L2', id: '019e4052-c317-7388-9d71-85b98a02d5fb' },
            { name: 'URM7-M', id: '019e4052-c317-7388-9d71-883ffb1560cd' }
        ],
        'URM7-H': [
            { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
            { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
            { name: 'RM7-S4L4', id: '019d1b0a-13a9-77dd-b41f-3ffb5f671742' },
            { name: 'RM7-S4L1', id: '019e4052-c315-71df-80da-4e334b96c9e6' },
            { name: 'URM7-H', id: '019e4052-c317-7388-9d71-8fed6faaaf99' }
        ]
    };

    // Log-related job types that are bugged on D4RK RM7CE (server has no logs tab)
    var LOG_JOB_TYPES = ['Log Deletion', 'Log Download'];

    function isJobBugged(job) {
        return job.serverName === 'D4RK RM7CE' && LOG_JOB_TYPES.indexOf(job.type || job.name) >= 0;
    }

    function getServerPriority(serverName) {
        if (!serverName || serverName === 'None') return -1; // No-server jobs (e.g. File Decryption) always first
        var idx = SERVER_PRIORITY.indexOf(serverName);
        return idx >= 0 ? idx : SERVER_PRIORITY.length;
    }

    function getJobTypePriority(typeName) {
        var idx = JOB_TYPE_PRIORITY.indexOf(typeName);
        return idx >= 0 ? idx : JOB_TYPE_PRIORITY.length;
    }

    var MARKET_DISPLAY_NAMES = { home: 'HOME', dark: 'D4RK', soyuz: 'SOYUZ', usol: 'USOL' };
    var MARKET_ID_TO_NAME = {
        '019d3ea4-85bd-7389-904d-8f7c85841134': 'HOME',
        '019d3ea4-85bd-7389-904d-908ba9194aa0': 'D4RK',
        '019da731-2db5-7d76-9447-1ea3b9b78001': 'SOYUZ',
        '019e4065-6ae8-760d-8724-58ab4f2cf7d7': 'USOL'
    };
    function getMarketNameById(marketId) {
        return MARKET_ID_TO_NAME[marketId] || marketId;
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
                error: j.error || null, completedAt: Date.now(),
                maintenanceEndsAt: j.maintenanceEndsAt || null
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
        pollMs = pollMs || 5000;
        return new Promise(function (resolve) {
            var elapsed = 0;
            var interval = 200;
            function check() {
                if (document.querySelector('[data-component-name="WallBoard"]') ||
                    document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
                    document.querySelector('[data-sentry-component="IceWallBreakApplication"]')) return resolve('ice-wall');
                if (document.querySelector('[data-sentry-component="ConfigHackApplication"]')) return resolve('decrypt');
                if (document.querySelector('[data-component-name="SimpleDecryptApplication"]') ||
                    document.querySelector('[data-sentry-component="SimpleDecryptApplication"]')) return resolve('simple-decrypt');
                elapsed += interval;
                if (elapsed >= pollMs) return resolve(null);
                safeTimeout(check, interval);
            }
            check();
        });
    }

    // Check if any hack minigame dialog is currently visible in the DOM
    function isHackMinigameOpen() {
        return !!(document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
            document.querySelector('[data-sentry-component="IceWallBreakApplication"]') ||
            document.querySelector('[data-component-name="WallBoard"]') ||
            document.querySelector('[data-sentry-component="ConfigHackApplication"]') ||
            document.querySelector('[data-component-name="SimpleDecryptApplication"]') ||
            document.querySelector('[data-sentry-component="SimpleDecryptApplication"]'));
    }

    // Wait for all hack minigame dialogs to close (max waitMs)
    function waitForHackMinigameClose(waitMs) {
        waitMs = waitMs || 120000;
        return new Promise(function (resolve) {
            var elapsed = 0;
            var interval = 300;
            function check() {
                if (!isHackMinigameOpen()) return resolve(true);
                elapsed += interval;
                if (elapsed >= waitMs) return resolve(false);
                safeTimeout(check, interval);
            }
            check();
        });
    }

    async function waitForHackToBeDone() {
        log('Hack minigame started, waiting for solver to complete...');
        // Detect which hack minigame appeared to set appropriate timeout
        var hackSolverTimeout = 60000; // default 60s for decrypt/simple-decrypt
        var hackType = await detectHackType(5000);
        if (hackType === 'ice-wall') {
            hackSolverTimeout = 120000; // 2 minutes for ICE Wall
            log('ICE Wall hack detected — waiting up to 2 minutes');
        } else if (hackType) {
            log(hackType + ' hack detected — waiting up to 60s');
        } else {
            log('Could not detect hack type — using default 60s timeout', 'warn');
        }

        // Wait for SAI update OR minigame close (whichever comes first)
        // Only poll for minigame close if we confirmed the minigame rendered (hackType detected)
        var saiUpdateReceived = false;
        var canPollClose = !!hackType; // only poll DOM close if we saw it appear
        try {
            await new Promise(function (resolve, reject) {
                var done = false;
                // Listen for SAI update event
                function onEvent(evt) {
                    if (evt.data && evt.data.type === 'COR3_AUTOJOB_SAI_UPDATE') {
                        if (!done) { done = true; window.removeEventListener('message', onEvent); safeClearTimeout(pollTimerId); safeClearTimeout(timeoutTimerId); saiUpdateReceived = true; resolve(); }
                    }
                }
                window.addEventListener('message', onEvent);
                // Poll for minigame close (solver finished but SAI event missed)
                var pollTimerId = 0;
                if (canPollClose) {
                    function pollClose() {
                        if (done) return;
                        if (!isHackMinigameOpen()) {
                            if (!done) { done = true; window.removeEventListener('message', onEvent); safeClearTimeout(timeoutTimerId); resolve(); }
                        } else {
                            pollTimerId = safeTimeout(pollClose, 500);
                        }
                    }
                    pollTimerId = safeTimeout(pollClose, 500);
                }
                // Hard timeout
                var timeoutTimerId = safeTimeout(function () {
                    if (!done) { done = true; window.removeEventListener('message', onEvent); safeClearTimeout(pollTimerId); reject(new Error('timeout')); }
                }, hackSolverTimeout);
            });
        } catch (e) {
            log('Hack solver did not complete in ' + (hackSolverTimeout / 1000) + 's — checking login status directly', 'warn');
        }
        if (saiUpdateReceived) {
            log('Hack completed (SAI update)', 'success');
        } else if (canPollClose && !isHackMinigameOpen()) {
            log('Hack completed (minigame closed)', 'success');
        }

        // Wait for minigame dialog to fully close before proceeding
        if (isHackMinigameOpen()) {
            log('Waiting for hack minigame dialog to close...');
            await waitForHackMinigameClose(30000);
        }
    }

    // Throttle-resistant tick: uses MessageChannel to bypass Chrome's
    // background-tab setTimeout clamping (which forces 60s minimum).
    var _mcChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
    var _mcCallbacks = [];
    if (_mcChannel) {
        _mcChannel.port1.onmessage = function () {
            var cbs = _mcCallbacks.slice();
            _mcCallbacks.length = 0;
            for (var i = 0; i < cbs.length; i++) cbs[i]();
        };
    }
    function nextTick(fn) {
        if (_mcChannel) {
            _mcCallbacks.push(fn);
            _mcChannel.port2.postMessage(0);
        } else {
            setTimeout(fn, 0);
        }
    }

    var _safeTimeoutId = 0;
    var _safeTimeouts = {};
    function safeTimeout(fn, ms) {
        var id = ++_safeTimeoutId;
        var target = Date.now() + ms;
        _safeTimeouts[id] = true;
        function tick() {
            if (!_safeTimeouts[id]) return;
            if (Date.now() >= target) { delete _safeTimeouts[id]; fn(); return; }
            var rem = target - Date.now();
            if (rem > 200) { setTimeout(function () { nextTick(tick); }, Math.min(rem - 50, 1000)); }
            else { nextTick(tick); }
        }
        nextTick(tick);
        return id;
    }
    function safeClearTimeout(id) { delete _safeTimeouts[id]; }

    // Delay helper — resistant to Chrome background-tab throttling
    function delay(ms) {
        return new Promise(function (resolve) {
            var target = Date.now() + ms;
            function check() {
                if (Date.now() >= target) { resolve(); return; }
                var remaining = target - Date.now();
                if (remaining > 200) {
                    setTimeout(function () { nextTick(check); }, Math.min(remaining - 50, 1000));
                } else {
                    nextTick(check);
                }
            }
            nextTick(check);
        });
    }

    // Wait for a specific postMessage event type, with timeout
    function waitForEvent(eventType, timeoutMs) {
        timeoutMs = timeoutMs || 15000;
        return new Promise(function (resolve, reject) {
            var done = false;
            var deadline = Date.now() + timeoutMs;
            function handler(evt) {
                if (evt.data && evt.data.type === eventType) {
                    if (done) return;
                    done = true;
                    window.removeEventListener('message', handler);
                    resolve(evt.data);
                }
            }
            window.addEventListener('message', handler);
            function checkTimeout() {
                if (done) return;
                if (Date.now() >= deadline) {
                    done = true;
                    window.removeEventListener('message', handler);
                    reject(new Error('Timeout waiting for ' + eventType));
                    return;
                }
                var remaining = deadline - Date.now();
                if (remaining > 200) {
                    setTimeout(function () { nextTick(checkTimeout); }, Math.min(remaining - 50, 1000));
                } else {
                    nextTick(checkTimeout);
                }
            }
            nextTick(checkTimeout);
        });
    }

    var _cachedMapData = null; // cached network map to avoid duplicate get.map requests

    // Fetch (or use cached) network map data
    async function fetchMapData() {
        if (_cachedMapData) return _cachedMapData;
        sendCmd('get.map', {});
        try {
            var mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
            if (mapData && mapData.servers) {
                _cachedMapData = mapData;
            }
            return mapData;
        } catch (e) {
            log('⚠️ Could not fetch network map: ' + e.message, 'warn');
            return null;
        }
    }

    // Check if ANY server on the path to serverName is in maintenance.
    // Returns { blocked: false } or { blocked: true, blockerName, remainingMs, endsAt }
    async function checkPathMaintenance(serverName) {
        var path = SERVER_PATH_MAP[serverName];
        if (!path || path.length === 0) return { blocked: false };
        var mapData = await fetchMapData();
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
        return { blocked: false };
    }

    // Human-friendly error message mappings for common server errors
    var ERROR_MAP = {
        'sai-transit-ip-duplicate': 'IP already exists on server',
        'sai-transit-ip-limit': 'Server IP limit reached',
        'no-path-to-server': 'No path to server (unreachable)',
        'server-in-maintenance': 'Server is in maintenance',
        'sai-missing-software': 'Missing required software',
        'missing-software': 'Missing required software',
        'sai-hack-impossible': 'Not enough hack power',
        'sai-no-hack-software': 'No hacking software',
        'cannot-read-sai-file': 'Cannot read SAI file',
        'invalid-access-token': 'Access token expired or invalid',
        'token-expired': 'Session token expired',
        'job-already-taken': 'Job already taken previously',
        'job-not-found': 'Job no longer available',
        'job-expired': 'Job has expired',
        'job-conditions-not-met': 'Job conditions not met',
        'sai-file-not-found': 'File not found on server',
        'sai-log-not-found': 'Log not found on server',
        'sai-access-denied': 'Access denied to server',
        'rate-limited': 'Rate limited — too many requests',
        'file-not-found': 'File not found on server/folder',
        'market-not-reachable': 'Market not reachable',
        'Error: File is encrypted': 'Unable to decrypt that file extension. Please install the appropriate decryption software',
        'insufficient_power': 'Insufficient decrypt power for this file',
        'insufficient-power': 'Insufficient decrypt power for this file'
    };
    function friendlyError(errMsg, failedConditions) {
        if (!errMsg) return 'Unknown error';
        var friendly = '';
        // Check for exact match first
        if (ERROR_MAP[errMsg]) {
            friendly = ERROR_MAP[errMsg];
        } else {
            // Check for partial match (error message contains a known key)
            var keys = Object.keys(ERROR_MAP);
            for (var i = 0; i < keys.length; i++) {
                if (errMsg.indexOf(keys[i]) >= 0) {
                    friendly = ERROR_MAP[keys[i]];
                    break;
                }
            }
        }
        if (!friendly) friendly = errMsg;
        if (failedConditions && Array.isArray(failedConditions) && failedConditions.length > 0) {
            friendly += ' (' + failedConditions.join(', ') + ')';
        }
        return friendly;
    }

    // ---- Loadout Resolver (Group 1) ----

    var RESOURCE_KEYS = ['cpu_frequency', 'cpu_cores', 'gpu_power', 'gpu_memory', 'ram_frequency', 'ram_memory'];

    // Parse consuming array: 2-value = [min,max] (base=0), 3-value = [base,min,max]
    function parseConsuming(vals) {
        if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
        if (vals.length === 2) return { base: 0, min: vals[0], max: vals[1] };
        return { base: vals[0], min: vals[1], max: vals[2] };
    }

    // Normalize specs to always be an array
    function normSpecs(sw) {
        if (!sw || !sw.specs) return [];
        return Array.isArray(sw.specs) ? sw.specs : [sw.specs];
    }

    // Calculate full loadout analysis (mirrors simulator.html calculateAnalysis)
    function calculateAnalysis(loadout, softwareIds) {
        var hw = loadout.equippedHardware || {};
        var allSoftware = loadout.ownedSoftware || [];
        var installed = allSoftware.filter(function (sw) { return softwareIds.indexOf(sw.id) >= 0; });

        // Supply
        var supply = {};
        if (hw.cpu) {
            supply.cpu_frequency = hw.cpu.specs.cpuFrequency || 0;
            supply.cpu_cores = hw.cpu.specs.cpuCores || 0;
        }
        if (hw.gpu) {
            supply.gpu_power = hw.gpu.specs.gpuPower || 0;
            supply.gpu_memory = hw.gpu.specs.gpuMemory || 0;
        }
        if (hw.ram) {
            supply.ram_frequency = hw.ram.specs.ramFrequency || 0;
            supply.ram_memory = hw.ram.specs.ramMemory || 0;
        }
        if (hw.psu) {
            supply.psu_power = hw.psu.specs.psuPower || 0;
        }

        // Parse all consuming
        var parsed = {};
        for (var si = 0; si < installed.length; si++) {
            var sw = installed[si];
            parsed[sw.id] = {};
            for (var ri = 0; ri < RESOURCE_KEYS.length; ri++) {
                var rk = RESOURCE_KEYS[ri];
                var p = parseConsuming(sw.consuming && sw.consuming[rk]);
                if (p) parsed[sw.id][rk] = p;
            }
        }

        // Demand
        var demand = {};
        for (var ri2 = 0; ri2 < RESOURCE_KEYS.length; ri2++) {
            var rk2 = RESOURCE_KEYS[ri2];
            var totalBase = 0, highestMinUplift = 0;
            for (var si2 = 0; si2 < installed.length; si2++) {
                var pc = parsed[installed[si2].id][rk2];
                if (pc) {
                    totalBase += pc.base;
                    highestMinUplift = Math.max(highestMinUplift, pc.min - pc.base);
                }
            }
            demand[rk2] = totalBase + highestMinUplift;
        }
        var psuDemand = 0;
        if (hw.cpu) psuDemand += hw.cpu.specs.cpuConsuming || 0;
        if (hw.gpu) psuDemand += hw.gpu.specs.gpuConsuming || 0;
        demand.psu_total = psuDemand;

        // canBoot
        var hasAllHw = !!(hw.cpu && hw.gpu && hw.ram && hw.psu);
        var canBoot = hasAllHw;
        if (canBoot) {
            for (var ri3 = 0; ri3 < RESOURCE_KEYS.length; ri3++) {
                if ((supply[RESOURCE_KEYS[ri3]] || 0) < demand[RESOURCE_KEYS[ri3]]) { canBoot = false; break; }
            }
            if (canBoot && (supply.psu_power || 0) < demand.psu_total) canBoot = false;
        }

        // Per-software ratios + power
        var swAnalysis = {};
        for (var si3 = 0; si3 < installed.length; si3++) {
            var sw3 = installed[si3];
            var lowestRatio = 1, bottleneck = null;
            for (var ri4 = 0; ri4 < RESOURCE_KEYS.length; ri4++) {
                var rk4 = RESOURCE_KEYS[ri4];
                var pc4 = parsed[sw3.id][rk4];
                if (!pc4) continue;
                var otherBase = 0;
                for (var oi = 0; oi < installed.length; oi++) {
                    if (installed[oi].id !== sw3.id) {
                        var opc = parsed[installed[oi].id][rk4];
                        if (opc) otherBase += opc.base;
                    }
                }
                var avail = (supply[rk4] || 0) - otherBase;
                var ratio;
                if (pc4.max > pc4.min) {
                    ratio = (avail - pc4.min) / (pc4.max - pc4.min);
                    ratio = Math.max(0, Math.min(1, ratio));
                } else {
                    ratio = avail >= pc4.min ? 1 : 0;
                }
                if (ratio < lowestRatio || (ratio === lowestRatio && bottleneck === null)) {
                    lowestRatio = ratio;
                    bottleneck = rk4;
                }
            }
            var specs = normSpecs(sw3);
            var abilities = specs.map(function (sp) {
                return {
                    type: sp.type,
                    computedPower: Math.floor(sp.power[0] + lowestRatio * (sp.power[1] - sp.power[0])),
                    pMin: sp.power[0],
                    pMax: sp.power[1],
                    serverTypes: sp.serverTypes || null,
                    fileTypes: sp.fileTypes || null
                };
            });
            swAnalysis[sw3.id] = { name: sw3.name, ratio: lowestRatio, bottleneck: bottleneck, abilities: abilities };
        }

        return { supply: supply, demand: demand, canBoot: canBoot, swAnalysis: swAnalysis, installed: installed };
    }

    var _cachedLoadout = null;
    var _cachedLoadoutAt = 0;
    var _lastLoadoutFetchAt = 0;
    var _lastLoadoutServerType = null;
    var LOADOUT_COOLDOWN_MS = 2000;
    async function getLoadoutData(forceRefresh) {
        if (!forceRefresh && _cachedLoadout && (Date.now() - _cachedLoadoutAt < 60000)) {
            log('Loadout: using cached data (age: ' + Math.round((Date.now() - _cachedLoadoutAt) / 1000) + 's)');
            return _cachedLoadout;
        }
        var sinceLastFetch = Date.now() - _lastLoadoutFetchAt;
        if (sinceLastFetch < LOADOUT_COOLDOWN_MS && _cachedLoadout) {
            log('Loadout: skipping WS request (cooldown ' + sinceLastFetch + 'ms < ' + LOADOUT_COOLDOWN_MS + 'ms) — using cached data');
            return _cachedLoadout;
        }
        log('Loadout: requesting fresh data via WS...');
        _lastLoadoutFetchAt = Date.now();
        sendCmd('loadout.get', {});
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_LOADOUT', 10000);
            if (resp.error) {
                log('Loadout: WS returned error: ' + (resp.error.message || JSON.stringify(resp.error)), 'warn');
            }
            if (resp.data) {
                _cachedLoadout = resp.data;
                _cachedLoadoutAt = Date.now();
                var eqSw = (resp.data.equippedSoftware || []).map(function (s) { return s.name; });
                log('Loadout: received — ' + (resp.data.ownedSoftware || []).length + ' owned sw, ' + eqSw.length + ' equipped [' + eqSw.join(', ') + ']');
                return resp.data;
            }
        } catch (e) {
            log('Loadout: WS request timed out', 'warn');
        }
        if (window.__cor3LoadoutData) {
            log('Loadout: using window global fallback');
            return window.__cor3LoadoutData;
        }
        log('Loadout: no data available', 'warn');
        return null;
    }
    function invalidateLoadoutCache() {
        _cachedLoadout = null;
        _cachedLoadoutAt = 0;
    }

    // Get server type name by server ID from cached network map
    function getServerTypeName(serverId) {
        var map = window.__cor3ServerTypeMap;
        if (map && map[serverId]) return map[serverId].serverTypeName;
        return null;
    }

    // Find which software can hack a given server type, sorted by max power descending
    function findHackSoftwareForServerType(allSoftware, serverTypeName) {
        var candidates = [];
        for (var i = 0; i < allSoftware.length; i++) {
            var specs = normSpecs(allSoftware[i]);
            for (var j = 0; j < specs.length; j++) {
                if (specs[j].type === 'HACK' && specs[j].serverTypes &&
                    specs[j].serverTypes.indexOf(serverTypeName) >= 0) {
                    candidates.push({ sw: allSoftware[i], spec: specs[j] });
                }
            }
        }
        candidates.sort(function (a, b) { return b.spec.power[1] - a.spec.power[1]; });
        return candidates;
    }

    // Find which software can decrypt a given file type, sorted by max power descending
    function findDecryptSoftwareForFileType(allSoftware, fileType) {
        var candidates = [];
        for (var i = 0; i < allSoftware.length; i++) {
            var specs = normSpecs(allSoftware[i]);
            for (var j = 0; j < specs.length; j++) {
                if (specs[j].type === 'DECRYPT' && specs[j].fileTypes &&
                    specs[j].fileTypes.indexOf(fileType) >= 0) {
                    candidates.push({ sw: allSoftware[i], spec: specs[j] });
                }
            }
        }
        candidates.sort(function (a, b) { return b.spec.power[1] - a.spec.power[1]; });
        return candidates;
    }

    // Find the best hardware set from owned hardware that maximizes a resource supply
    // while still booting with the given software set.
    // Returns { cpu, gpu, ram, psu } hardware objects, or null if no valid combo.
    function findBestHardware(loadout, softwareIds) {
        var owned = loadout.ownedHardware || [];
        var byCat = { CPU: [], GPU: [], RAM: [], PSU: [] };
        for (var i = 0; i < owned.length; i++) {
            var cat = (owned[i].category || '').toUpperCase();
            if (byCat[cat]) byCat[cat].push(owned[i]);
        }
        if (byCat.CPU.length === 0 || byCat.GPU.length === 0 || byCat.RAM.length === 0 || byCat.PSU.length === 0) return null;
        var bestHw = null;
        var bestPower = -1;
        for (var ci = 0; ci < byCat.CPU.length; ci++) {
            for (var gi = 0; gi < byCat.GPU.length; gi++) {
                var psuNeed = (byCat.CPU[ci].specs.cpuConsuming || 0) + (byCat.GPU[gi].specs.gpuConsuming || 0);
                for (var pi = 0; pi < byCat.PSU.length; pi++) {
                    if ((byCat.PSU[pi].specs.psuPower || 0) < psuNeed) continue;
                    for (var rmi = 0; rmi < byCat.RAM.length; rmi++) {
                        var testHw = { cpu: byCat.CPU[ci], gpu: byCat.GPU[gi], ram: byCat.RAM[rmi], psu: byCat.PSU[pi] };
                        var testLoadout = JSON.parse(JSON.stringify(loadout));
                        testLoadout.equippedHardware = testHw;
                        var analysis = calculateAnalysis(testLoadout, softwareIds);
                        if (!analysis.canBoot) continue;
                        var totalPower = 0;
                        for (var swId in analysis.swAnalysis) {
                            var ab = analysis.swAnalysis[swId].abilities;
                            for (var ai = 0; ai < ab.length; ai++) totalPower += ab[ai].computedPower;
                        }
                        if (totalPower > bestPower) {
                            bestPower = totalPower;
                            bestHw = testHw;
                        }
                    }
                    break;
                }
            }
        }
        return bestHw;
    }

    async function applyLoadoutChange(loadout, targetHw, targetSwIds) {
        log('Loadout: applyLoadoutChange — target sw count: ' + targetSwIds.length);
        var currentHw = loadout.equippedHardware || {};
        var currentSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
        var changed = false;

        // 1. Unequip software that is NOT in targetSwIds
        for (var ui = 0; ui < currentSwIds.length; ui++) {
            if (targetSwIds.indexOf(currentSwIds[ui]) >= 0) continue;
            var unequipName = currentSwIds[ui];
            var eqSw = loadout.equippedSoftware || [];
            for (var un = 0; un < eqSw.length; un++) {
                if (eqSw[un].id === currentSwIds[ui]) { unequipName = eqSw[un].name + ' (' + currentSwIds[ui] + ')'; break; }
            }
            log('Loadout: unequipping software ' + unequipName);
            sendCmd('loadout.unequip.software', { moduleConfigId: currentSwIds[ui] });
            await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
            await delay(500);
            changed = true;
        }

        // 2. Equip hardware if changed — smart order to avoid PSU rejection
        var hwChanges = [];
        var hwSlots = ['cpu', 'gpu', 'ram', 'psu'];
        for (var hci = 0; hci < hwSlots.length; hci++) {
            var hSlot = hwSlots[hci];
            var hCurId = currentHw[hSlot] ? currentHw[hSlot].id : null;
            var hTgtId = targetHw[hSlot] ? targetHw[hSlot].id : null;
            if (hTgtId && hTgtId !== hCurId) {
                var curConsume = 0, tgtConsume = 0;
                if (hSlot === 'cpu') { curConsume = currentHw.cpu ? (currentHw.cpu.specs.cpuConsuming || 0) : 0; tgtConsume = targetHw.cpu.specs.cpuConsuming || 0; }
                if (hSlot === 'gpu') { curConsume = currentHw.gpu ? (currentHw.gpu.specs.gpuConsuming || 0) : 0; tgtConsume = targetHw.gpu.specs.gpuConsuming || 0; }
                hwChanges.push({ slot: hSlot, id: hTgtId, name: targetHw[hSlot].name || hTgtId, delta: tgtConsume - curConsume, isPsu: hSlot === 'psu' });
            }
        }
        var psuUpgrade = hwChanges.find(function (c) { return c.isPsu && targetHw.psu && currentHw.psu && (targetHw.psu.specs.psuPower || 0) > (currentHw.psu.specs.psuPower || 0); });
        var orderedHwChanges = [];
        if (psuUpgrade) orderedHwChanges.push(psuUpgrade);
        hwChanges.sort(function (a, b) { return a.delta - b.delta; });
        for (var hoi = 0; hoi < hwChanges.length; hoi++) {
            if (hwChanges[hoi] !== psuUpgrade) orderedHwChanges.push(hwChanges[hoi]);
        }
        for (var hi = 0; hi < orderedHwChanges.length; hi++) {
            var hc = orderedHwChanges[hi];
            log('Loadout: equipping ' + hc.slot.toUpperCase() + ' → ' + hc.name);
            sendCmd('loadout.equip.hardware', { moduleConfigId: hc.id });
            await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
            await delay(500);
            changed = true;
        }

        // 3. Equip software that should be equipped
        for (var ei = 0; ei < targetSwIds.length; ei++) {
            if (currentSwIds.indexOf(targetSwIds[ei]) < 0) {
                var swName = '';
                var allSw = loadout.ownedSoftware || [];
                for (var k = 0; k < allSw.length; k++) {
                    if (allSw[k].id === targetSwIds[ei]) { swName = allSw[k].name; break; }
                }
                log('Loadout: equipping software ' + swName + ' (' + targetSwIds[ei] + ')');
                sendCmd('loadout.equip.software', { moduleConfigId: targetSwIds[ei] });
                await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
                await delay(500);
                changed = true;
            }
        }

        // 4. Fetch fresh loadout data to confirm
        if (changed) {
            return await getLoadoutData(true);
        }
        return loadout;
    }

    async function ensureLoadoutForJob(job) {
        var serverId = job.serverId;
        if (!serverId) {
            log('Loadout: job has no target server — skipping loadout check');
            return true;
        }

        var serverTypeName = getServerTypeName(serverId);
        _lastLoadoutServerType = serverTypeName || _lastLoadoutServerType;
        log('Loadout: pre-check for job "' + (job.type || job.name || '?') + '" on server ' + (serverTypeName || serverId));

        var serverDefenceRate = 0;
        var needsHack = true;
        try {
            sendCmd('get.login.status', { serverId: serverId });
            var preLoginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000);
            if (preLoginData && preLoginData.data) {
                if (preLoginData.data.serverDefenceRate) {
                    serverDefenceRate = preLoginData.data.serverDefenceRate;
                }
                if (preLoginData.data.activeAccesses && preLoginData.data.activeAccesses.length > 0) {
                    var existingAccess = preLoginData.data.activeAccesses[0];
                    var existingType = existingAccess.accessType || existingAccess.type || 'unknown';
                    log('Loadout: already have ' + existingType + ' access on target server — skipping hack loadout');
                    needsHack = false;
                }
            }
        } catch (e) {
            log('Loadout: could not check login status — assuming hack needed', 'warn');
        }

        if (!needsHack) {
            log('Loadout: pre-check complete — no hack needed for "' + (job.type || job.name || '?') + '"');
            return true;
        }

        if (!serverTypeName) {
            log('Loadout: cannot determine server type — skipping hack loadout');
            return true;
        }

        invalidateLoadoutCache();
        var loadout = await getLoadoutData(true);
        if (!loadout) {
            log('Loadout: could not fetch loadout data — proceeding without loadout check', 'warn');
            return true;
        }

        var allSw = loadout.ownedSoftware || [];
        var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
        var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
        log('Loadout: found ' + hackCandidates.length + ' hack candidate(s) for ' + serverTypeName + (hackCandidates.length > 0 ? ' — best: ' + hackCandidates[0].sw.name + ' (power ' + (hackCandidates[0].spec.power || []).join('-') + ')' : ''));

        if (hackCandidates.length === 0) {
            log('Loadout: no hack software available for ' + serverTypeName + ' — proceeding (may use existing access)', 'warn');
            return true;
        }

        var bestHack = hackCandidates[0];
        var targetSwIds = [bestHack.sw.id];
        var currentHw = loadout.equippedHardware || {};
        var analysis = calculateAnalysis(loadout, targetSwIds);
        var targetHw = currentHw;

        var alreadyBest = equippedSwIds.length === 1 && equippedSwIds[0] === bestHack.sw.id;
        if (alreadyBest) {
            log('Loadout: best HACK software "' + bestHack.sw.name + '" already equipped alone');
        }

        if (!analysis.canBoot) {
            log('Loadout: current hardware cannot boot hack software — finding compatible hardware');
            var betterHw = findBestHardware(loadout, targetSwIds);
            if (betterHw) {
                targetHw = betterHw;
            } else {
                log('Loadout: cannot boot hack software — skipping loadout change', 'warn');
                return true;
            }
        }

        var checkLoadout = JSON.parse(JSON.stringify(loadout));
        checkLoadout.equippedHardware = targetHw;
        var checkAnalysis = calculateAnalysis(checkLoadout, targetSwIds);
        var computedHackPower = 0;
        var hackSa = checkAnalysis.swAnalysis[bestHack.sw.id];
        if (hackSa) {
            for (var ai = 0; ai < hackSa.abilities.length; ai++) {
                if (hackSa.abilities[ai].type === 'HACK') {
                    computedHackPower = hackSa.abilities[ai].computedPower;
                    break;
                }
            }
        }
        if (serverDefenceRate > 0) {
            log('Loadout: hack power comparison — hackPower: ' + computedHackPower + ' vs serverDefenceRate: ' + serverDefenceRate + (computedHackPower >= serverDefenceRate ? ' ✓' : ' ✗ INSUFFICIENT'));
        } else {
            log('Loadout: computed hack power: ' + computedHackPower + ' (serverDefenceRate unknown)');
        }

        if (serverDefenceRate > 0 && computedHackPower < serverDefenceRate) {
            log('Loadout: hack power insufficient — trying hardware upgrade to boost power');
            var hwUpgrade = findBestHardware(loadout, targetSwIds);
            if (hwUpgrade) {
                var upgradeLoadout = JSON.parse(JSON.stringify(loadout));
                upgradeLoadout.equippedHardware = hwUpgrade;
                var upgradeAnalysis = calculateAnalysis(upgradeLoadout, targetSwIds);
                var upgradedPower = 0;
                var upgradeSa = upgradeAnalysis.swAnalysis[bestHack.sw.id];
                if (upgradeSa) {
                    for (var uai = 0; uai < upgradeSa.abilities.length; uai++) {
                        if (upgradeSa.abilities[uai].type === 'HACK') {
                            upgradedPower = upgradeSa.abilities[uai].computedPower;
                            break;
                        }
                    }
                }
                if (upgradedPower > computedHackPower) {
                    targetHw = hwUpgrade;
                    computedHackPower = upgradedPower;
                    log('Loadout: hardware upgrade found — hack power: ' + upgradedPower + ' vs serverDefenceRate: ' + serverDefenceRate + (upgradedPower >= serverDefenceRate ? ' ✓' : ' ✗ still insufficient'));
                    if (upgradedPower < serverDefenceRate) {
                        log('Loadout: cannot reach required hack power (' + serverDefenceRate + ') — best achievable: ' + upgradedPower, 'error');
                    }
                } else {
                    log('Loadout: no better hardware available — best hack power: ' + computedHackPower, 'warn');
                }
            } else {
                log('Loadout: no hardware upgrade available', 'warn');
            }
        }

        if (!alreadyBest || targetHw !== currentHw) {
            log('Loadout: equipping HACK-only software "' + bestHack.sw.name + '" (power ' + (bestHack.spec.power || []).join('-') + ') for ' + serverTypeName);
            await applyLoadoutChange(loadout, targetHw, targetSwIds);
        }
        log('Loadout: pre-check complete for "' + (job.type || job.name || '?') + '"');
        return true;
    }

    // Equip ONLY the best DECRYPT software for a file type (unequips everything else for max power).
    // Called right before the decrypt action, after hacking/login is complete.
    async function ensureDecryptOnlyLoadout(job) {
        var fileType = null;
        if (job.conditions && job.conditions.items) {
            for (var ci = 0; ci < job.conditions.items.length; ci++) {
                var cond = job.conditions.items[ci];
                if (cond.details && cond.details.fileExtension) {
                    fileType = cond.details.fileExtension;
                    if (fileType && fileType[0] !== '.') fileType = '.' + fileType;
                    break;
                }
            }
        }
        if (!fileType && job.fileType) {
            fileType = job.fileType;
        }
        if (!fileType) {
            log('Loadout: decrypt job but file type unknown — will rely on error retry', 'warn');
            return;
        }

        invalidateLoadoutCache();
        var loadout = await getLoadoutData(true);
        if (!loadout) {
            log('Loadout: could not fetch loadout data — proceeding without decrypt loadout', 'warn');
            return;
        }

        var allSw = loadout.ownedSoftware || [];
        var decryptCandidates = findDecryptSoftwareForFileType(allSw, fileType);
        if (decryptCandidates.length === 0) {
            log('Loadout: no decrypt software available for ' + fileType, 'warn');
            return;
        }

        var bestDecrypt = decryptCandidates[0];
        var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
        if (equippedSwIds.length === 1 && equippedSwIds[0] === bestDecrypt.sw.id) {
            log('Loadout: best DECRYPT software "' + bestDecrypt.sw.name + '" already equipped alone');
            return;
        }

        var targetSwIds = [bestDecrypt.sw.id];
        var currentHw = loadout.equippedHardware || {};
        var analysis = calculateAnalysis(loadout, targetSwIds);
        var targetHw = currentHw;
        if (!analysis.canBoot) {
            log('Loadout: current hardware cannot boot decrypt software — finding compatible hardware');
            var betterHw = findBestHardware(loadout, targetSwIds);
            if (betterHw) {
                targetHw = betterHw;
            } else {
                log('Loadout: cannot boot decrypt software for ' + fileType + ' — insufficient resources', 'warn');
                return;
            }
        }

        log('Loadout: equipping DECRYPT-only software "' + bestDecrypt.sw.name + '" (power ' + (bestDecrypt.spec.power || []).join('-') + ') for ' + fileType);
        await applyLoadoutChange(loadout, targetHw, targetSwIds);
    }

    async function checkDecryptPowerViaAnalysis(fileId, job) {
        try {
            sendCmd('get.file.analysis', { fileId: fileId });
            var analysis = await waitForEvent('COR3_AUTOJOB_FILE_ANALYSIS', 8000);
            if (!analysis || !analysis.data) {
                log('File analysis: no data returned — proceeding anyway');
                return true;
            }
            var d = analysis.data;
            var fileExt = d.type || '';
            if (fileExt && !job.fileType) {
                job.fileType = fileExt[0] === '.' ? fileExt : '.' + fileExt;
            }
            log('File analysis: type=' + d.type + ' cryptRate=' + d.cryptRate + ' decryptPower=' + d.decryptPower + ' canDecrypt=' + d.canDecrypt);
            if (d.canDecrypt === false) {
                log('File analysis: cannot decrypt — cryptRate(' + d.cryptRate + ') > decryptPower(' + d.decryptPower + ')', 'warn');
                return false;
            }
            return true;
        } catch (e) {
            log('File analysis: timed out or failed — proceeding anyway');
            return true;
        }
    }

    async function trySwapForHack(loadout, serverTypeName, currentSwIds) {
        log('Loadout: trySwapForHack — serverType=' + serverTypeName);
        var allSw = loadout.ownedSoftware || [];
        var candidates = findHackSoftwareForServerType(allSw, serverTypeName);
        if (candidates.length === 0) {
            log('Loadout: trySwapForHack — no hack candidates found in ' + allSw.length + ' owned software', 'warn');
            return false;
        }

        var best = candidates[0];
        log('Loadout: trySwapForHack — best candidate: ' + best.sw.name + ' (power ' + (best.spec.power || []).join('-') + ')');
        if (currentSwIds.indexOf(best.sw.id) >= 0) {
            log('Loadout: trySwapForHack — best hack software already equipped');
            return true;
        }

        var targetSwIds = currentSwIds.slice();
        targetSwIds.push(best.sw.id);

        var analysis = calculateAnalysis(loadout, targetSwIds);
        log('Loadout: trySwapForHack — canBoot with added sw: ' + analysis.canBoot);
        if (!analysis.canBoot) {
            var removable = findRemovableSoftware(loadout, targetSwIds, best.sw.id);
            if (removable) {
                var removedName = removable;
                for (var rn = 0; rn < allSw.length; rn++) { if (allSw[rn].id === removable) { removedName = allSw[rn].name; break; } }
                log('Loadout: trySwapForHack — removing ' + removedName + ' to make room');
                targetSwIds = targetSwIds.filter(function (id) { return id !== removable; });
                analysis = calculateAnalysis(loadout, targetSwIds);
                if (!analysis.canBoot) {
                    log('Loadout: trySwapForHack — still cannot boot after removal, trying hardware swap');
                    var betterHw = findBestHardware(loadout, targetSwIds);
                    if (betterHw) {
                        log('Loadout: swapping hardware to accommodate hack software');
                        loadout = await applyLoadoutChange(loadout, betterHw, targetSwIds);
                        return true;
                    }
                    log('Loadout: trySwapForHack — no hardware combo can boot either', 'warn');
                    return false;
                }
            } else {
                log('Loadout: trySwapForHack — no removable software found, trying hardware swap');
                var betterHw2 = findBestHardware(loadout, targetSwIds);
                if (betterHw2) {
                    log('Loadout: swapping hardware to accommodate hack software');
                    loadout = await applyLoadoutChange(loadout, betterHw2, targetSwIds);
                    return true;
                }
                log('Loadout: trySwapForHack — no hardware combo can boot either', 'warn');
                return false;
            }
        }

        log('Loadout: equipping ' + best.sw.name + ' for hacking ' + serverTypeName);
        var hw = loadout.equippedHardware || {};
        await applyLoadoutChange(loadout, hw, targetSwIds);
        return true;
    }

    // Find the lowest-priority equipped software that can be removed (not the protected one)
    function findRemovableSoftware(loadout, swIds, protectedId) {
        var equipped = loadout.equippedSoftware || [];
        // Prefer removing SEARCH-only software first, then lowest-tier
        var removable = [];
        for (var i = 0; i < equipped.length; i++) {
            if (equipped[i].id === protectedId) continue;
            if (swIds.indexOf(equipped[i].id) < 0) continue;
            var specs = normSpecs(equipped[i]);
            var hasOnlySearch = specs.every(function (s) { return s.type === 'SEARCH'; });
            removable.push({ id: equipped[i].id, tier: equipped[i].tier || 0, onlySearch: hasOnlySearch });
        }
        // Sort: SEARCH-only first, then by tier ascending
        removable.sort(function (a, b) {
            if (a.onlySearch !== b.onlySearch) return a.onlySearch ? -1 : 1;
            return (a.tier || 0) - (b.tier || 0);
        });
        return removable.length > 0 ? removable[0].id : null;
    }

    async function tryLoadoutSwapForError(errorMsg, job, errorObj) {
        log('Loadout: tryLoadoutSwapForError — error="' + errorMsg + '"');
        invalidateLoadoutCache();
        var loadout = await getLoadoutData(true);
        if (!loadout) {
            log('Loadout: cannot retry — no loadout data available', 'warn');
            return false;
        }

        var allSw = loadout.ownedSoftware || [];
        var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });

        if (errorMsg.indexOf('sai-no-hack-software') >= 0 || errorMsg.indexOf('sai-hack-impossible') >= 0) {
            var serverId = job.serverId;
            var serverTypeName = getServerTypeName(serverId);
            if (!serverTypeName) {
                log('Loadout: cannot determine server type for ' + serverId, 'warn');
                return false;
            }
            log('Loadout: hack failed on ' + serverTypeName + ' — equipping hack-only software');
            var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
            if (hackCandidates.length === 0) {
                log('Loadout: no hack software available for ' + serverTypeName, 'warn');
                return false;
            }
            var bestHack = hackCandidates[0];
            var targetSwIds = [bestHack.sw.id];

            var serverDefenceRate = 0;
            try {
                sendCmd('get.login.status', { serverId: serverId });
                var loginStatus = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000);
                if (loginStatus && loginStatus.data && loginStatus.data.serverDefenceRate) {
                    serverDefenceRate = loginStatus.data.serverDefenceRate;
                }
            } catch (e) { }

            if (equippedSwIds.length === 1 && equippedSwIds[0] === bestHack.sw.id) {
                log('Loadout: best hack software "' + bestHack.sw.name + '" already equipped alone — trying hardware upgrade');
                var currentAnalysis = calculateAnalysis(loadout, targetSwIds);
                var currentHackPower = 0;
                var curSa = currentAnalysis.swAnalysis[bestHack.sw.id];
                if (curSa) {
                    for (var chi = 0; chi < curSa.abilities.length; chi++) {
                        if (curSa.abilities[chi].type === 'HACK') { currentHackPower = curSa.abilities[chi].computedPower; break; }
                    }
                }
                if (serverDefenceRate > 0) {
                    log('Loadout: current hack power: ' + currentHackPower + ' vs serverDefenceRate: ' + serverDefenceRate);
                }
                var betterHw = findBestHardware(loadout, targetSwIds);
                if (!betterHw) {
                    log('Loadout: no hardware upgrade available — cannot improve hack power' + (serverDefenceRate > 0 ? ' (need ' + serverDefenceRate + ', have ' + currentHackPower + ')' : ''), 'error');
                    return false;
                }
                var testLoadout = JSON.parse(JSON.stringify(loadout));
                testLoadout.equippedHardware = betterHw;
                var hwAnalysis = calculateAnalysis(testLoadout, targetSwIds);
                if (!hwAnalysis.canBoot) {
                    log('Loadout: cannot boot with better hardware — giving up', 'error');
                    return false;
                }
                var upgradedHackPower = 0;
                var hwSa = hwAnalysis.swAnalysis[bestHack.sw.id];
                if (hwSa) {
                    for (var uhi = 0; uhi < hwSa.abilities.length; uhi++) {
                        if (hwSa.abilities[uhi].type === 'HACK') { upgradedHackPower = hwSa.abilities[uhi].computedPower; break; }
                    }
                }
                log('Loadout: with hardware upgrade, hack power: ' + upgradedHackPower + (serverDefenceRate > 0 ? ' vs serverDefenceRate: ' + serverDefenceRate : ''));
                if (upgradedHackPower <= currentHackPower) {
                    log('Loadout: hardware upgrade does not improve hack power — giving up', 'error');
                    return false;
                }
                if (serverDefenceRate > 0 && upgradedHackPower < serverDefenceRate) {
                    log('Loadout: hardware upgrade still insufficient — need ' + serverDefenceRate + ', best achievable: ' + upgradedHackPower, 'error');
                }
                log('Loadout: swapping hardware to boost hack power for ' + serverTypeName);
                await applyLoadoutChange(loadout, betterHw, targetSwIds);
                return true;
            }

            var currentHw = loadout.equippedHardware || {};
            var analysis = calculateAnalysis(loadout, targetSwIds);
            var targetHw = currentHw;
            if (!analysis.canBoot) {
                var betterHw2 = findBestHardware(loadout, targetSwIds);
                if (betterHw2) {
                    targetHw = betterHw2;
                } else {
                    log('Loadout: cannot boot hack-only software — giving up', 'warn');
                    return false;
                }
            }

            var preCheckLoadout = JSON.parse(JSON.stringify(loadout));
            preCheckLoadout.equippedHardware = targetHw;
            var preCheck = calculateAnalysis(preCheckLoadout, targetSwIds);
            var projectedPower = 0;
            var preSa = preCheck.swAnalysis[bestHack.sw.id];
            if (preSa) {
                for (var phi = 0; phi < preSa.abilities.length; phi++) {
                    if (preSa.abilities[phi].type === 'HACK') { projectedPower = preSa.abilities[phi].computedPower; break; }
                }
            }
            log('Loadout: projected hack power with new loadout: ' + projectedPower + (serverDefenceRate > 0 ? ' vs serverDefenceRate: ' + serverDefenceRate : ''));
            if (serverDefenceRate > 0 && projectedPower < serverDefenceRate) {
                var hwRetry = findBestHardware(loadout, targetSwIds);
                if (hwRetry) {
                    var testLoadout2 = JSON.parse(JSON.stringify(loadout));
                    testLoadout2.equippedHardware = hwRetry;
                    var hwCheck = calculateAnalysis(testLoadout2, targetSwIds);
                    var retryPower = 0;
                    var retrySa = hwCheck.swAnalysis[bestHack.sw.id];
                    if (retrySa) {
                        for (var rhi = 0; rhi < retrySa.abilities.length; rhi++) {
                            if (retrySa.abilities[rhi].type === 'HACK') { retryPower = retrySa.abilities[rhi].computedPower; break; }
                        }
                    }
                    if (retryPower >= serverDefenceRate) {
                        targetHw = hwRetry;
                        log('Loadout: found better hardware — hack power: ' + retryPower);
                    } else {
                        log('Loadout: best achievable hack power: ' + retryPower + ' — still below serverDefenceRate (' + serverDefenceRate + ')', 'error');
                    }
                }
            }

            log('Loadout: equipping HACK-only "' + bestHack.sw.name + '" for retry');
            await applyLoadoutChange(loadout, targetHw, targetSwIds);
            return true;
        }

        // Decrypt errors: missing-software, File is encrypted, insufficient_power
        if (errorMsg.indexOf('missing-software') >= 0 || errorMsg.indexOf('File is encrypted') >= 0 ||
            errorMsg.indexOf('insufficient_power') >= 0 || errorMsg.indexOf('insufficient-power') >= 0) {
            var fileType = null;
            if (job.conditions && job.conditions.items) {
                for (var ci = 0; ci < job.conditions.items.length; ci++) {
                    var cond = job.conditions.items[ci];
                    if (cond.details && cond.details.fileExtension) {
                        fileType = cond.details.fileExtension;
                        if (fileType && fileType[0] !== '.') fileType = '.' + fileType;
                        break;
                    }
                }
            }
            if (!fileType && job.fileType) fileType = job.fileType;
            if (!fileType) {
                var extMatch = errorMsg.match(/decrypt\s+(\.\w+)\s+extension/i);
                if (extMatch) fileType = extMatch[1];
            }
            if (!fileType) {
                log('Loadout: decrypt failed but file type unknown — cannot swap software', 'warn');
                return false;
            }

            var requiredPower = (errorObj && errorObj.required) || 0;
            var availablePower = (errorObj && errorObj.available) || 0;
            var isInsufficientPower = errorMsg.indexOf('insufficient_power') >= 0 || errorMsg.indexOf('insufficient-power') >= 0;
            if (isInsufficientPower && requiredPower > 0) {
                log('Loadout: insufficient decrypt power — required: ' + requiredPower + ', available: ' + availablePower);
            }

            var candidates = findDecryptSoftwareForFileType(allSw, fileType);
            if (candidates.length === 0) {
                log('Loadout: no decrypt software available for ' + fileType, 'warn');
                return false;
            }

            var best = candidates[0];
            var targetSwIds = [best.sw.id];

            if (equippedSwIds.length === 1 && equippedSwIds[0] === best.sw.id && isInsufficientPower) {
                log('Loadout: best decrypt software "' + best.sw.name + '" already equipped alone — trying hardware upgrade to boost power');
                var betterHw = findBestHardware(loadout, targetSwIds);
                if (!betterHw) {
                    log('Loadout: failed to increase decrypt power to required level (' + requiredPower + ') — no better hardware available', 'error');
                    return false;
                }
                var testLoadout = JSON.parse(JSON.stringify(loadout));
                testLoadout.equippedHardware = betterHw;
                var hwAnalysis = calculateAnalysis(testLoadout, targetSwIds);
                if (!hwAnalysis.canBoot) {
                    log('Loadout: failed to increase decrypt power to required level (' + requiredPower + ') — cannot boot with better hardware', 'error');
                    return false;
                }
                var sa = hwAnalysis.swAnalysis[best.sw.id];
                if (sa) {
                    var decryptPower = 0;
                    for (var ai = 0; ai < sa.abilities.length; ai++) {
                        if (sa.abilities[ai].type === 'DECRYPT') {
                            decryptPower = sa.abilities[ai].computedPower;
                            break;
                        }
                    }
                    log('Loadout: with better hardware, decrypt power would be ' + decryptPower + ' (required: ' + requiredPower + ')');
                    if (decryptPower < requiredPower) {
                        log('Loadout: failed to increase decrypt power to required level (' + requiredPower + ') — best achievable: ' + decryptPower, 'error');
                        return false;
                    }
                }
                log('Loadout: swapping hardware to boost decrypt power for ' + fileType);
                await applyLoadoutChange(loadout, betterHw, targetSwIds);
                return true;
            }

            if (equippedSwIds.length === 1 && equippedSwIds[0] === best.sw.id) {
                log('Loadout: best decrypt software already equipped alone — cannot improve', 'warn');
                return false;
            }

            var currentHw = loadout.equippedHardware || {};
            var analysis = calculateAnalysis(loadout, targetSwIds);
            var targetHw = currentHw;
            if (!analysis.canBoot) {
                var betterHw2 = findBestHardware(loadout, targetSwIds);
                if (betterHw2) {
                    targetHw = betterHw2;
                } else {
                    log('Loadout: cannot boot decrypt-only software for ' + fileType + ' — insufficient resources', 'warn');
                    return false;
                }
            }

            if (isInsufficientPower && requiredPower > 0) {
                var testLoadout2 = JSON.parse(JSON.stringify(loadout));
                testLoadout2.equippedHardware = targetHw;
                var preCheck = calculateAnalysis(testLoadout2, targetSwIds);
                var sa2 = preCheck.swAnalysis[best.sw.id];
                if (sa2) {
                    var dp2 = 0;
                    for (var ai2 = 0; ai2 < sa2.abilities.length; ai2++) {
                        if (sa2.abilities[ai2].type === 'DECRYPT') { dp2 = sa2.abilities[ai2].computedPower; break; }
                    }
                    log('Loadout: projected decrypt power with new loadout: ' + dp2 + ' (required: ' + requiredPower + ')');
                    if (dp2 < requiredPower) {
                        var hwRetry = findBestHardware(loadout, targetSwIds);
                        if (hwRetry) {
                            var testLoadout3 = JSON.parse(JSON.stringify(loadout));
                            testLoadout3.equippedHardware = hwRetry;
                            var hwCheck = calculateAnalysis(testLoadout3, targetSwIds);
                            var sa3 = hwCheck.swAnalysis[best.sw.id];
                            if (sa3) {
                                var dp3 = 0;
                                for (var ai3 = 0; ai3 < sa3.abilities.length; ai3++) {
                                    if (sa3.abilities[ai3].type === 'DECRYPT') { dp3 = sa3.abilities[ai3].computedPower; break; }
                                }
                                if (dp3 >= requiredPower) {
                                    targetHw = hwRetry;
                                    log('Loadout: found better hardware — decrypt power: ' + dp3);
                                } else {
                                    log('Loadout: failed to increase decrypt power to required level (' + requiredPower + ') — best achievable: ' + dp3, 'error');
                                    return false;
                                }
                            }
                        } else {
                            log('Loadout: failed to increase decrypt power to required level (' + requiredPower + ') — best achievable: ' + dp2, 'error');
                            return false;
                        }
                    }
                }
            }

            log('Loadout: equipping DECRYPT-only "' + best.sw.name + '" for retry on ' + fileType);
            await applyLoadoutChange(loadout, targetHw, targetSwIds);
            return true;
        }

        return false;
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
                if (evt.data && (evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE' || evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE' || evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE')) {
                    cleanup();
                    resolve({ ok: false, unreachable: true });
                }
            }
            function cleanup() {
                window.removeEventListener('message', endpointHandler);
                safeClearTimeout(timer);
            }
            window.addEventListener('message', endpointHandler);
            timer = safeTimeout(function () {
                window.removeEventListener('message', endpointHandler);
                resolve({ ok: true, timeout: true }); // timeout is non-fatal
            }, 10000);
        });
    }

    // Step: Set endpoint to target server, with path-through hack on failure
    async function stepSetEndpoint(serverId) {
        var endpointLabel = getServerNameById(serverId) || serverId;

        // Skip if endpoint is already set to this server
        if (_lastEndpointServerId === serverId) {
            log('Endpoint already set to ' + endpointLabel + ' — skipping duplicate set.endpoint');
            return;
        }

        log('Setting endpoint to ' + endpointLabel);
        var raceResult = await _sendSetEndpoint(serverId);

        if (raceResult.unreachable) {
            // Try path-through: hack intermediate servers on the path
            var path = getPathForServerId(serverId);
            if (!path || path.length <= 1) {
                var noPathCheck = await checkPathMaintenance(endpointLabel);
                if (noPathCheck.blocked) {
                    var nMins = Math.ceil(noPathCheck.remainingMs / 60000);
                    throw new Error(endpointLabel + ' unreachable (' + noPathCheck.blockerName + ' in maintenance, ~' + nMins + 'm remaining)');
                }
                throw new Error(endpointLabel + ' unreachable (no path to server)');
            }
            log('⚡ Server unreachable — attempting path-through hack (' + path.length + ' servers on path)');
            // Walk through each intermediate server (excluding the target itself which is the last)
            for (var pi = 0; pi < path.length - 1; pi++) {
                var intermediate = path[pi];
                log('⚡ Path-through: setting endpoint to ' + intermediate.name + ' (' + (pi + 1) + '/' + (path.length - 1) + ')');
                var intResult = await _sendSetEndpoint(intermediate.id);
                if (intResult.unreachable) {
                    var intCheck = await checkPathMaintenance(intermediate.name);
                    var intMsg = intermediate.name + ' unreachable';
                    if (intCheck.blocked) {
                        var iMins = Math.ceil(intCheck.remainingMs / 60000);
                        intMsg += ' (' + intCheck.blockerName + ' in maintenance, ~' + iMins + 'm remaining)';
                    }
                    log('⚡ Path-through: ' + intMsg, 'warn');
                    throw new Error('Path-through failed: ' + intMsg);
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
                var finalCheck = await checkPathMaintenance(endpointLabel);
                if (finalCheck.blocked) {
                    var fMins = Math.ceil(finalCheck.remainingMs / 60000);
                    throw new Error(endpointLabel + ' still unreachable after path-through (' + finalCheck.blockerName + ' in maintenance, ~' + fMins + 'm remaining)');
                }
                throw new Error(endpointLabel + ' still unreachable after path-through hack');
            }
        }

        if (raceResult.timeout) {
            log('Endpoint set timeout (may already be set)', 'warn');
        }
        _lastEndpointServerId = serverId;
        await delay(humanDelay());
    }

    // Step: Login to server (use existing access or hack)
    async function stepLogin(serverId) {
        var serverLabel = getServerNameById(serverId) || serverId;
        log('Checking login status for ' + serverLabel);
        sendCmd('get.login.status', { serverId: serverId });
        var loginData;
        try {
            loginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
        } catch (e) {
            throw new Error('Failed to get login status: ' + e.message);
        }

        if (loginData.error) {
            throw new Error('Login status error: ' + friendlyError(loginData.error.message || JSON.stringify(loginData.error)));
        }

        var data = loginData.data;
        // Check for active access
        if (data && data.activeAccesses && data.activeAccesses.length > 0) {
            var accessObj = data.activeAccesses[0];
            var accessId = accessObj.id;
            var accessType = accessObj.accessType || accessObj.type || 'unknown';
            log('Using existing access on ' + serverLabel + ' (' + accessType + ')');
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
            log('Logged in via existing access to ' + serverLabel, 'success');
        } else {
            // Log hack power info from login status
            var loginDefenceRate = (data && data.serverDefenceRate) ? data.serverDefenceRate : 0;
            var loginHackPower = 0;
            if (data && data.hackTools && data.hackTools.length > 0) {
                loginHackPower = data.hackTools[0].hackPower || 0;
                log('Hack info — serverDefenceRate: ' + loginDefenceRate + ', equipped hackPower: ' + loginHackPower + ' (' + (data.hackTools[0].name || 'unknown') + ')' + (loginDefenceRate > 0 ? (loginHackPower >= loginDefenceRate ? ' ✓' : ' ✗ INSUFFICIENT') : ''));
            } else if (loginDefenceRate > 0) {
                log('Hack info — serverDefenceRate: ' + loginDefenceRate + ', no hack tools equipped', 'warn');
            }

            // Need to hack — retry up to MAX_HACK_ATTEMPTS times if hack fails
            var MAX_HACK_ATTEMPTS = 3;
            var hackAttempt = 0;
            var loggedIn = false;

            while (hackAttempt < MAX_HACK_ATTEMPTS && !loggedIn) {
                hackAttempt++;
                if (hackAttempt > 1) {
                    log('Hack attempt ' + hackAttempt + '/' + MAX_HACK_ATTEMPTS + ' on ' + serverLabel, 'warn');
                } else {
                    log('No active access to ' + serverLabel + ' — starting hack');
                }
                // Enable all solvers BEFORE starting hack so they're
                // ready when the minigame appears (it can start instantly)
                ensureDecryptSolverEnabled();
                ensureIceWallSolverEnabled();
                ensureSimpleDecryptSolverEnabled();
                await delay(300); // brief pause for solver injection
                sendCmd('hack.start', { serverId: serverId });
                var hackResult;
                try {
                    hackResult = await new Promise(function (resolve, reject) {
                        var done = false;
                        var timer = safeTimeout(function () {
                            if (!done) { done = true; window.removeEventListener('message', onMsg); reject(new Error('Timeout')); }
                        }, 30000);
                        function onMsg(evt) {
                            if (!evt.data) return;
                            if (evt.data.type === 'COR3_AUTOJOB_SAI_HACK_START') {
                                if (!done) { done = true; safeClearTimeout(timer); window.removeEventListener('message', onMsg); resolve(evt.data); }
                            } else if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                                if (!done) { done = true; safeClearTimeout(timer); window.removeEventListener('message', onMsg); resolve({ data: { minigameStarted: true }, error: null }); }
                            }
                        }
                        window.addEventListener('message', onMsg);
                    });
                } catch (e) {
                    log('Hack start event timed out — checking if hack already completed...', 'warn');
                    sendCmd('get.login.status', { serverId: serverId });
                    try {
                        var fallbackLogin = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
                        if (fallbackLogin.data && fallbackLogin.data.activeAccesses && fallbackLogin.data.activeAccesses.length > 0) {
                            var fbAccess = fallbackLogin.data.activeAccesses[0];
                            var fbAccessId = fbAccess.id;
                            var fbType = fbAccess.accessType || fbAccess.type || 'unknown';
                            log('Hack already completed (found ' + fbType + ' access after timeout) — logging in', 'success');
                            sendCmd('login.with-access', { serverId: serverId, accessGrantId: fbAccessId });
                            try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
                            await delay(humanDelay());
                            return;
                        }
                    } catch (e2) { /* login status also failed */ }
                    if (hackAttempt < MAX_HACK_ATTEMPTS) {
                        log('Hack timed out — will retry', 'warn');
                        await delay(2000);
                        continue;
                    }
                    throw new Error('Hack start timed out after ' + MAX_HACK_ATTEMPTS + ' attempts');
                }
                if (hackResult.error) {
                    log('Hack returned error: ' + friendlyError(hackResult.error.message || JSON.stringify(hackResult.error)) + ' — checking access...', 'warn');
                    sendCmd('get.login.status', { serverId: serverId });
                    try {
                        var errLogin = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
                        if (errLogin.data && errLogin.data.activeAccesses && errLogin.data.activeAccesses.length > 0) {
                            var errAccess = errLogin.data.activeAccesses[0];
                            var errAccessId = errAccess.id;
                            var errType = errAccess.accessType || errAccess.type || 'unknown';
                            log('Already have ' + errType + ' access despite hack error — logging in', 'success');
                            sendCmd('login.with-access', { serverId: serverId, accessGrantId: errAccessId });
                            try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
                            await delay(humanDelay());
                            return;
                        }
                    } catch (e2) { /* login status also failed */ }

                    // Loadout retry: if hack failed due to missing/insufficient software, try swapping loadout
                    var hackErrMsg = hackResult.error.message || JSON.stringify(hackResult.error);
                    if (hackErrMsg.indexOf('sai-no-hack-software') >= 0 || hackErrMsg.indexOf('sai-hack-impossible') >= 0) {
                        log('Loadout: attempting software swap for hack retry...');
                        var loadoutSwapped = await tryLoadoutSwapForError(hackErrMsg, { serverId: serverId, type: _currentJobRef ? _currentJobRef.type : '' });
                        if (loadoutSwapped) {
                            log('Loadout: swap successful — will retry hack');
                            await delay(1000);
                            continue; // retry with new loadout
                        }
                    }
                    if (hackAttempt < MAX_HACK_ATTEMPTS) {
                        log('Hack failed — will retry', 'warn');
                        await delay(2000);
                        continue;
                    }
                    throw new Error('Hack failed after ' + MAX_HACK_ATTEMPTS + ' attempts: ' + friendlyError(hackErrMsg));
                }
                if (hackResult.data && hackResult.data.autoHacked) {
                    log('Server auto-hacked (no minigame) — skipping solver wait', 'success');
                } else if (hackResult.data && hackResult.data.minigameStarted) {
                    log('Hack minigame detected via minigame event');
                    await waitForHackToBeDone();
                } else {
                    await waitForHackToBeDone();
                }

                // Poll for active access after hack completes
                await delay(humanDelay());
                var maxPolls = 5;
                for (var attempt = 0; attempt < maxPolls; attempt++) {
                    sendCmd('get.login.status', { serverId: serverId });
                    try {
                        loginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000);
                    } catch (e) {
                        log('Login status not received after hack (poll ' + (attempt + 1) + '/' + maxPolls + '), retrying...', 'warn');
                        continue;
                    }
                    if (loginData.data && loginData.data.activeAccesses && loginData.data.activeAccesses.length > 0) {
                        var postHackAccess = loginData.data.activeAccesses[0];
                        var aid = postHackAccess.id;
                        var postHackType = postHackAccess.accessType || postHackAccess.type || 'unknown';
                        sendCmd('login.with-access', { serverId: serverId, accessGrantId: aid });
                        try {
                            await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
                        } catch (e) { /* proceed anyway */ }
                        loggedIn = true;
                        log('Logged in to ' + serverLabel + ' (' + postHackType + ')', 'success');
                        break;
                    } else {
                        log('No active access after hack (poll ' + (attempt + 1) + '/' + maxPolls + '), retrying...', 'warn');
                        await delay(5000);
                    }
                }
                if (!loggedIn) {
                    // Hack minigame completed but no access granted — hack likely failed
                    if (hackAttempt < MAX_HACK_ATTEMPTS) {
                        log('Hack completed but no access granted — hack likely failed, retrying (' + hackAttempt + '/' + MAX_HACK_ATTEMPTS + ')', 'warn');
                        await delay(2000);
                        continue;
                    }
                    throw new Error('Hack failed after ' + MAX_HACK_ATTEMPTS + ' attempts — no access granted');
                }
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
        log('Taking job: ' + jobLabel(job));

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
                throw new Error('Job take error: ' + friendlyError(result.error.message || JSON.stringify(result.error)));
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
                if (evt.data && (evt.data.type === 'COR3_WS_MARKET' || evt.data.type === 'COR3_WS_DARK_MARKET' || evt.data.type === 'COR3_WS_SOYUZ_MARKET' || evt.data.type === 'COR3_WS_USOL_MARKET')) {
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
                safeClearTimeout(timer);
            }
            window.addEventListener('message', handler);
            timer = safeTimeout(function () {
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

        // Set endpoint for D4RK/SOYUZ/USOL market jobs before completing
        if (getMarketNameById(job.marketId) === 'D4RK') {
            await stepSetEndpoint(DARK_MARKET_SERVER_ID);
        } else if (getMarketNameById(job.marketId) === 'SOYUZ') {
            await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
        } else if (getMarketNameById(job.marketId) === 'USOL') {
            await stepSetEndpoint(USOL_MARKET_SERVER_ID);
        }

        sendCmd('job.complete', { marketId: job.marketId, jobId: job.jobId });
        try {
            var result = await waitForEvent('COR3_AUTOJOB_JOB_COMPLETED', 20000);
            window.removeEventListener('message', profileHandler);

            if (result.error) {
                var errMsg = friendlyError(result.error.message, result.error.failedConditions) || 'Unknown completion error';
                log('Job completion error: ' + errMsg, 'error');
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
                safeClearTimeout(timer);
            }
            window.addEventListener('message', handler);
            timer = safeTimeout(function () {
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
            if ((cond.type === 'DecryptFile' || cond.type === 'DecryptDownloadedFile') && cond.details && cond.details.files && cond.details.files.length > 0) {
                return cond.details.files[0];
            }
        }
        return null;
    }

    function jobLabel(job) {
        var parts = [job.name || job.type];
        if (job.serverName && job.serverName !== 'None') parts.push('on ' + job.serverName);
        var mkt = MARKET_DISPLAY_NAMES[job.marketKey] || '';
        if (mkt) parts.push('[' + mkt + ']');
        return parts.join(' ');
    }

    // ---- File Decryption Job ----
    async function solveFileDecryption(job) {
        log('=== File Decryption: ' + jobLabel(job) + ' ===');

        // Listen for file updates (server may regenerate fileId after take)
        var latestFileId = null;
        var fileUpdateHandler = function (evt) {
            if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.data && evt.data.data.file) {
                latestFileId = evt.data.data.file.id;
                log('File updated: ' + evt.data.data.file.name + ' (new id: ' + latestFileId + ')');
            }
        };
        window.addEventListener('message', fileUpdateHandler);

        try {
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

            // 2. Determine fileInfo — from take event, updated fileId, or from conditions
            var fileInfo = job.fileInfo || null;
            if (latestFileId && fileInfo) {
                fileInfo.id = latestFileId;
            }
            if (!fileInfo) {
                var condFile = extractFileInfoFromConditions(job);
                if (condFile) {
                    fileInfo = condFile;
                    if (latestFileId) fileInfo.id = latestFileId;
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

            // Find the encrypted file — match by ID first, then name, then fallback
            var targetFile = null;
            if (folderData && folderData.data && folderData.data.files) {
                var files = folderData.data.files;
                // 1. Match by latest fileId from update events
                if (latestFileId) {
                    targetFile = files.find(function (f) { return f.id === latestFileId; });
                    if (targetFile) log('Matched file by update event ID: ' + targetFile.name);
                }
                // 2. Match by fileInfo ID from job take
                if (!targetFile && fileInfo && fileInfo.id) {
                    targetFile = files.find(function (f) { return f.id === fileInfo.id; });
                    if (targetFile) log('Matched file by take event ID: ' + targetFile.name);
                }
                // 3. Match by file name from fileInfo or conditions
                if (!targetFile && fileInfo && fileInfo.name) {
                    targetFile = files.find(function (f) { return f.name === fileInfo.name; });
                    if (targetFile) log('Matched file by name: ' + targetFile.name);
                }
                if (!targetFile) {
                    var condFile = extractFileInfoFromConditions(job);
                    if (condFile && condFile.name) {
                        targetFile = files.find(function (f) { return f.name === condFile.name; });
                        if (targetFile) log('Matched file by conditions name: ' + targetFile.name);
                    }
                }
                // 4. Fallback: prefer encrypted files (isEncrypted or .enc extension), then isNew, then last
                if (!targetFile) {
                    var encFiles = files.filter(function (f) { return f.isEncrypted || (f.name && f.name.indexOf('.enc') >= 0); });
                    if (encFiles.length > 0) {
                        targetFile = encFiles.find(function (f) { return f.isNew; }) || encFiles[encFiles.length - 1];
                        log('Matched encrypted file by fallback: ' + targetFile.name, 'warn');
                    } else {
                        targetFile = files.find(function (f) { return f.isNew; }) || files[files.length - 1];
                        if (targetFile) log('Matched file by final fallback (isNew/last): ' + targetFile.name, 'warn');
                    }
                }
            }

            if (!targetFile) {
                throw new Error('No encrypted file found in download folder');
            }

            // 5. Extract file type early for loadout logic
            if (targetFile.name) {
                var dotIdx = targetFile.name.lastIndexOf('.');
                if (dotIdx >= 0) job.fileType = targetFile.name.substring(dotIdx);
            }

            // 6. Equip decrypt-only loadout FIRST, then check decrypt power
            await ensureDecryptOnlyLoadout(job);
            await delay(humanDelay());

            // 7. Check decrypt power via file analysis after equipping best loadout
            var analysisOk = await checkDecryptPowerViaAnalysis(targetFile.id, job);
            if (!analysisOk) {
                log('Decrypt power still insufficient after loadout swap — attempting hardware upgrade');
                var swapOk = await tryLoadoutSwapForError('insufficient_power', job, {});
                if (!swapOk) {
                    throw new Error('Insufficient decrypt power — no loadout can meet requirement');
                }
                await delay(humanDelay());
            }
            ensureDecryptSolverEnabled();
            ensureIceWallSolverEnabled();
            ensureSimpleDecryptSolverEnabled();
            log('Opening file: ' + targetFile.name);
            sendCmd('decrypt.file', { fileId: targetFile.id });

            // Wait for minigame start OR desktop file error (race)
            var openFileResult = await new Promise(function (resolve) {
                var done = false;
                var timer = safeTimeout(function () { if (!done) { done = true; cleanup(); resolve({ timeout: true }); } }, 12000);
                function onDesktopFile(evt) {
                    if (!evt.data || done) return;
                    if (evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.error) {
                        done = true; cleanup(); resolve({ error: evt.data.error });
                    }
                }
                function onMinigame(evt) {
                    if (!evt.data || done) return;
                    if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                        done = true; cleanup(); resolve({ minigame: evt.data });
                    }
                }
                function cleanup() { safeClearTimeout(timer); window.removeEventListener('message', onDesktopFile); window.removeEventListener('message', onMinigame); }
                window.addEventListener('message', onDesktopFile);
                window.addEventListener('message', onMinigame);
            });

            // Handle desktop error (missing-software, insufficient_power, file encrypted)
            if (openFileResult.error) {
                var errMsg = openFileResult.error.message || openFileResult.error.kind || JSON.stringify(openFileResult.error);
                var isLoadoutError = errMsg.indexOf('missing-software') >= 0 || errMsg.indexOf('insufficient_power') >= 0 ||
                    errMsg.indexOf('insufficient-power') >= 0 || errMsg.indexOf('File is encrypted') >= 0;
                var isAlreadyDecrypted = errMsg.indexOf('cannot-read-sai-file') >= 0 || errMsg.indexOf('Cannot read SAI file') >= 0;
                if (isAlreadyDecrypted) {
                    log('File already decrypted (cannot-read-sai-file) — attempting job completion directly', 'success');
                } else if (isLoadoutError) {
                    log('Loadout: file open failed (' + errMsg + ') — attempting software swap');
                    var swapOk = await tryLoadoutSwapForError(errMsg, job, openFileResult.error);
                    if (swapOk) {
                        log('Loadout: swap successful — retrying file open');
                        await delay(1000);
                        ensureDecryptSolverEnabled();
                        ensureIceWallSolverEnabled();
                        ensureSimpleDecryptSolverEnabled();
                        sendCmd('decrypt.file', { fileId: targetFile.id });
                        var retryResult = await new Promise(function (resolve) {
                            var rd = false;
                            var rt = safeTimeout(function () { if (!rd) { rd = true; rc(); resolve({ timeout: true }); } }, 12000);
                            function rdf(evt) { if (!evt.data || rd) return; if (evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.error) { rd = true; rc(); resolve({ error: evt.data.error }); } }
                            function rmg(evt) { if (!evt.data || rd) return; if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') { rd = true; rc(); resolve({ minigame: evt.data }); } }
                            function rc() { safeClearTimeout(rt); window.removeEventListener('message', rdf); window.removeEventListener('message', rmg); }
                            window.addEventListener('message', rdf);
                            window.addEventListener('message', rmg);
                        });
                        if (retryResult.error) {
                            var retryErrMsg = retryResult.error.message || retryResult.error.kind || JSON.stringify(retryResult.error);
                            throw new Error(friendlyError(retryErrMsg));
                        } else if (retryResult.timeout) {
                            log('Minigame start not detected on retry', 'warn');
                        }
                    } else {
                        throw new Error(friendlyError(errMsg));
                    }
                } else {
                    throw new Error(friendlyError(errMsg));
                }
            } else if (openFileResult.timeout) {
                log('Minigame start not detected (solver may handle it directly)', 'warn');
            }
            // else: minigame started normally
            if (!isAlreadyDecrypted) {
                await waitForHackToBeDone();
            }

            // 6. Wait for server to register completion, then complete job
            await delay(1500);
            var decryptRetries = 0;
            var MAX_DECRYPT_RETRIES = 3;
            while (true) {
                try {
                    var reward = await stepCompleteJob(job);
                    if (reward) return reward;
                    if (decryptRetries >= MAX_DECRYPT_RETRIES) {
                        log('No reward after decrypt — max retries reached', 'warn');
                        return null;
                    }
                } catch (e) {
                    if (e.message && e.message.indexOf('job-conditions-not-met') >= 0 && decryptRetries < MAX_DECRYPT_RETRIES) {
                        // Fall through to retry block below
                    } else {
                        throw e;
                    }
                }
                // No reward or job-conditions-not-met — re-trigger decrypt minigame
                if (decryptRetries < MAX_DECRYPT_RETRIES) {
                    decryptRetries++;
                    log('Decrypt incomplete — re-opening file to retry decryption (attempt ' + decryptRetries + '/' + MAX_DECRYPT_RETRIES + ')', 'warn');
                    await delay(2000);
                    ensureDecryptSolverEnabled();
                    ensureIceWallSolverEnabled();
                    ensureSimpleDecryptSolverEnabled();
                    sendCmd('decrypt.file', { fileId: targetFile.id });
                    try {
                        await waitForEvent('COR3_AUTOJOB_MINIGAME_START', 10000);
                    } catch (e2) {
                        log('Minigame start not detected on retry', 'warn');
                    }
                    await waitForHackToBeDone();
                    await delay(1500);
                    continue;
                }
                return null;
            }
        } finally {
            window.removeEventListener('message', fileUpdateHandler);
        }
    }

    // ---- IP Injection Job ----
    async function solveIPInjection(job) {
        log('=== IP Injection: ' + jobLabel(job) + ' ===');

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
            throw new Error('Transit error: ' + friendlyError(transitData.error.message || JSON.stringify(transitData.error)));
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
                        throw new Error('Server IP limit reached (' + limit + ' IPs max). Clear old IPs via Auto Clear IPs toggle.');
                    }
                    throw new Error('IP injection failed for ' + ip + ': ' + friendlyError(addResult.error.message));
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
        log('=== Data Download: ' + jobLabel(job) + ' ===');

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
            throw new Error('Files error: ' + friendlyError(filesData.error.message || JSON.stringify(filesData.error)));
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
                    log('File download response: ' + friendlyError(dlResult.error.message || JSON.stringify(dlResult.error)), 'warn');
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
                if (encFile.name) {
                    var ddDotIdx = encFile.name.lastIndexOf('.');
                    if (ddDotIdx >= 0) job.fileType = encFile.name.substring(ddDotIdx);
                }
                await ensureDecryptOnlyLoadout(job);
                await delay(humanDelay());
                ensureDecryptSolverEnabled();
                ensureIceWallSolverEnabled();
                ensureSimpleDecryptSolverEnabled();
                log('Opening file for decryption: ' + encFile.name);
                sendCmd('decrypt.file', { fileId: encFile.id });
                try {
                    await waitForEvent('COR3_AUTOJOB_MINIGAME_START', 10000);
                } catch (e) { /* solver may handle directly */ }
                await waitForHackToBeDone();

                // Try completing again
                reward = await stepCompleteJob(job);
            }
        }

        return reward;
    }

    // ---- Log Deletion Job ----
    async function solveLogDeletion(job) {
        log('=== Log Deletion: ' + jobLabel(job) + ' ===');

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
            throw new Error('Logs error: ' + friendlyError(logsData.error.message || JSON.stringify(logsData.error)));
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
                throw new Error('Log delete failed: ' + friendlyError(delResult.error.message || JSON.stringify(delResult.error)));
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
        log('=== Log Download: ' + jobLabel(job) + ' ===');

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
            throw new Error('Logs error: ' + friendlyError(logsData.error.message || JSON.stringify(logsData.error)));
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
                log('Log download response: ' + friendlyError(dlResult.error.message || JSON.stringify(dlResult.error)), 'warn');
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
        log('=== Decrypt & Extract: ' + jobLabel(job) + ' ===');

        // Listen for file updates (server may regenerate fileId after take)
        var latestFileId = null;
        var fileUpdateHandler = function (evt) {
            if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.data && evt.data.data.file) {
                latestFileId = evt.data.data.file.id;
                log('File updated: ' + evt.data.data.file.name + ' (new id: ' + latestFileId + ')');
            }
        };
        window.addEventListener('message', fileUpdateHandler);

        try {
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
                var filesErr = filesData.error.message || JSON.stringify(filesData.error);
                if (filesErr.indexOf('missing-software') >= 0 || filesErr.indexOf('software') >= 0) {
                    throw new Error('Missing required software on server — cannot access files');
                }
                throw new Error('Files error: ' + filesErr);
            }

            // 5. Find the job file
            var jobFile = null;
            if (filesData.data && filesData.data.files) {
                jobFile = filesData.data.files.find(function (f) {
                    return f.jobId === job.jobId;
                });
            }

            // 6. Download the file if necessary
            var fileAlreadyDownloaded = false;
            if (!jobFile) {
                log('Job file not found on server (may already be downloaded)', 'warn');
                fileAlreadyDownloaded = true;
            } else {
                log('Downloading file: ' + jobFile.name);
                sendCmd('file.download', { serverId: job.serverId, fileId: jobFile.fileId });

                try {
                    var dlResult = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DOWNLOAD', 10000);
                    if (dlResult.error) {
                        log('File download response: ' + friendlyError(dlResult.error.message || JSON.stringify(dlResult.error)), 'warn');
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
                var files = folderData.data.files;
                var condFileInfo = extractFileInfoFromConditions(job);
                if (condFileInfo && condFileInfo.id) {
                    encFile = files.find(function (f) { return f.id === condFileInfo.id; });
                    if (encFile) log('Matched file from job conditions: ' + encFile.name);
                }
                if (!encFile && condFileInfo && condFileInfo.name) {
                    encFile = files.find(function (f) { return f.name === condFileInfo.name; });
                    if (encFile) log('Matched file by name from conditions: ' + encFile.name);
                }
                if (!encFile && latestFileId) {
                    encFile = files.find(function (f) { return f.id === latestFileId; });
                }
                if (!encFile) {
                    encFile = files.find(function (f) { return f.isNew; }) ||
                              files[files.length - 1];
                }
            }

            if (!encFile) {
                throw new Error('No file found in download folder for decryption');
            }

            // 8. Extract file type early for loadout logic
            if (encFile.name) {
                var dotIdx2 = encFile.name.lastIndexOf('.');
                if (dotIdx2 >= 0) job.fileType = encFile.name.substring(dotIdx2);
            }

            // 9. Equip decrypt-only loadout FIRST, then check decrypt power
            await ensureDecryptOnlyLoadout(job);
            await delay(humanDelay());

            // 10. Check decrypt power via file analysis after equipping best loadout
            var analysisOk2 = await checkDecryptPowerViaAnalysis(encFile.id, job);
            if (!analysisOk2) {
                log('Decrypt power still insufficient after loadout swap — attempting hardware upgrade');
                var swapOk2 = await tryLoadoutSwapForError('insufficient_power', job, {});
                if (!swapOk2) {
                    throw new Error('Insufficient decrypt power — no loadout can meet requirement');
                }
                await delay(humanDelay());
            }
            ensureDecryptSolverEnabled();
            ensureIceWallSolverEnabled();
            ensureSimpleDecryptSolverEnabled();
            log('Opening file for decryption: ' + encFile.name);
            sendCmd('decrypt.file', { fileId: encFile.id });

            // Wait for minigame start OR desktop file error (race)
            var openFileResult2 = await new Promise(function (resolve) {
                var done = false;
                var timer = safeTimeout(function () { if (!done) { done = true; cleanup(); resolve({ timeout: true }); } }, 12000);
                function onDesktopFile(evt) {
                    if (!evt.data || done) return;
                    if (evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.error) {
                        done = true; cleanup(); resolve({ error: evt.data.error });
                    }
                }
                function onMinigame(evt) {
                    if (!evt.data || done) return;
                    if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                        done = true; cleanup(); resolve({ minigame: evt.data });
                    }
                }
                function cleanup() { safeClearTimeout(timer); window.removeEventListener('message', onDesktopFile); window.removeEventListener('message', onMinigame); }
                window.addEventListener('message', onDesktopFile);
                window.addEventListener('message', onMinigame);
            });

            // Handle desktop error (missing-software, insufficient_power, file encrypted)
            if (openFileResult2.error) {
                var errMsg2 = openFileResult2.error.message || openFileResult2.error.kind || JSON.stringify(openFileResult2.error);
                var isLoadoutError2 = errMsg2.indexOf('missing-software') >= 0 || errMsg2.indexOf('insufficient_power') >= 0 ||
                    errMsg2.indexOf('insufficient-power') >= 0 || errMsg2.indexOf('File is encrypted') >= 0;
                if (isLoadoutError2) {
                    log('Loadout: file open failed (' + errMsg2 + ') — attempting software swap');
                    var swapOk2 = await tryLoadoutSwapForError(errMsg2, job, openFileResult2.error);
                    if (swapOk2) {
                        log('Loadout: swap successful — retrying file open');
                        await delay(1000);
                        ensureDecryptSolverEnabled();
                        ensureIceWallSolverEnabled();
                        ensureSimpleDecryptSolverEnabled();
                        sendCmd('decrypt.file', { fileId: encFile.id });
                        var retryResult2 = await new Promise(function (resolve) {
                            var rd2 = false;
                            var rt2 = safeTimeout(function () { if (!rd2) { rd2 = true; rc2(); resolve({ timeout: true }); } }, 12000);
                            function rdf2(evt) { if (!evt.data || rd2) return; if (evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.error) { rd2 = true; rc2(); resolve({ error: evt.data.error }); } }
                            function rmg2(evt) { if (!evt.data || rd2) return; if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') { rd2 = true; rc2(); resolve({ minigame: evt.data }); } }
                            function rc2() { safeClearTimeout(rt2); window.removeEventListener('message', rdf2); window.removeEventListener('message', rmg2); }
                            window.addEventListener('message', rdf2);
                            window.addEventListener('message', rmg2);
                        });
                        if (retryResult2.error) {
                            var retryErrMsg2 = retryResult2.error.message || retryResult2.error.kind || JSON.stringify(retryResult2.error);
                            throw new Error(friendlyError(retryErrMsg2));
                        } else if (retryResult2.timeout) {
                            log('Minigame start not detected on retry', 'warn');
                        }
                    } else {
                        throw new Error(friendlyError(errMsg2));
                    }
                } else {
                    throw new Error(friendlyError(errMsg2));
                }
            } else if (openFileResult2.timeout) {
                log('Minigame start not detected (solver may handle directly)', 'warn');
            }
            // else: minigame started normally
            await waitForHackToBeDone();

            // 9. Wait for server to register completion, then complete job
            await delay(1500);
            var decryptRetries = 0;
            var MAX_DECRYPT_RETRIES = 3;
            while (true) {
                try {
                    var reward = await stepCompleteJob(job);
                    if (reward) return reward;
                    if (decryptRetries >= MAX_DECRYPT_RETRIES) {
                        log('No reward after decrypt — max retries reached', 'warn');
                        return null;
                    }
                } catch (e) {
                    if (e.message && e.message.indexOf('job-conditions-not-met') >= 0 && decryptRetries < MAX_DECRYPT_RETRIES) {
                        // Fall through to retry block below
                    } else {
                        throw e;
                    }
                }
                // No reward or job-conditions-not-met — re-trigger decrypt minigame
                if (decryptRetries < MAX_DECRYPT_RETRIES) {
                    decryptRetries++;
                    log('Decrypt incomplete — re-opening file to retry decryption (attempt ' + decryptRetries + '/' + MAX_DECRYPT_RETRIES + ')', 'warn');
                    await delay(2000);
                    ensureDecryptSolverEnabled();
                    ensureIceWallSolverEnabled();
                    ensureSimpleDecryptSolverEnabled();
                    sendCmd('decrypt.file', { fileId: encFile.id });
                    try {
                        await waitForEvent('COR3_AUTOJOB_MINIGAME_START', 10000);
                    } catch (e2) {
                        log('Minigame start not detected on retry', 'warn');
                    }
                    await waitForHackToBeDone();
                    await delay(1500);
                    continue;
                }
                return null;
            }
        } finally {
            window.removeEventListener('message', fileUpdateHandler);
        }
    }

    // ---- File Elimination (DeleteFile) Job ----
    async function solveFileElimination(job) {
        log('=== File Elimination: ' + jobLabel(job) + ' ===');

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
            throw new Error('Files error: ' + friendlyError(filesData.error.message || JSON.stringify(filesData.error)));
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
                throw new Error('File delete failed: ' + friendlyError(delResult.error.message || JSON.stringify(delResult.error)));
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
        log('=== Data Upload: ' + jobLabel(job) + ' ===');

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
        log('=== IP Cleanup: ' + jobLabel(job) + ' ===');

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
            throw new Error('Transit error: ' + friendlyError(transitData.error.message || JSON.stringify(transitData.error)));
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
                    throw new Error('IP removal failed for ' + ip + ': ' + friendlyError(rmResult.error.message || JSON.stringify(rmResult.error)));
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

        // Wait if initial page load fetch is still in progress
        var waitAttempts = 0;
        while (window.__cor3InitialFetchInProgress && waitAttempts < 3) {
            waitAttempts++;
            log('Initial page load in progress — delaying auto-jobs start (attempt ' + waitAttempts + '/3, waiting 10s)...', 'warn');
            await new Promise(function (r) { setTimeout(r, 10000); });
        }
        if (window.__cor3InitialFetchInProgress) {
            log('⚠️ Initial page load still in progress after 30s — proceeding anyway', 'warn');
        }

        running = true;
        abortFlag = false;
        tokenExpired = false;
        _lastLoadoutServerType = null;
        _lastEndpointServerId = null;
        invalidateLoadoutCache();

        // Sort jobs by server priority (furthest first), then by server type (to group
        // servers needing the same hack software together, minimizing loadout swaps),
        // then by job type priority within same server
        jobQueue.sort(function (a, b) {
            var pa = getServerPriority(a.serverName || '');
            var pb = getServerPriority(b.serverName || '');
            if (pa !== pb) return pa - pb;
            // Group by server type so same-type servers are processed consecutively
            var sta = (a.serverId ? getServerTypeName(a.serverId) : '') || '';
            var stb = (b.serverId ? getServerTypeName(b.serverId) : '') || '';
            if (sta !== stb) return sta < stb ? -1 : 1;
            var ta = getJobTypePriority(a.type || a.name || '');
            var tb = getJobTypePriority(b.type || b.name || '');
            return ta - tb;
        });

        log('Auto Job Solver started — processing ' + jobQueue.length + ' job(s)');
        updateTracker();

        // Pre-start: check all servers for maintenance and skip unreachable jobs
        log('Checking server maintenance status...');
        _cachedMapData = null; // invalidate cache at start of each run
        try {
            var preMapData = await fetchMapData();
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
                                mj.maintenanceEndsAt = srvInfo.maintenanceEndsAt || null;
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
                    // Set endpoint for D4RK/SOYUZ/USOL market jobs before completing
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
                    job.maintenanceEndsAt = pathCheck.endsAt || null;
                    log('⚠️ Skipping job: ' + job.name + ' — ' + blockerMsg + ' (~' + mins + 'm left)', 'warn');
                    updateTracker();
                    continue;
                }
            }

            job.status = 'running';
            _currentJobRef = job;
            updateTracker();

            // Pre-check loadout for this job (equip hack/decrypt software if needed)
            try {
                await ensureLoadoutForJob(job);
            } catch (loadoutErr) {
                log('Loadout pre-check warning: ' + loadoutErr.message + ' — proceeding anyway', 'warn');
            }

            try {
                // Set endpoint for D4RK/SOYUZ/USOL market jobs before processing
                if (job.marketKey === 'dark') {
                    await stepSetEndpoint(DARK_MARKET_SERVER_ID);
                } else if (job.marketKey === 'soyuz') {
                    await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
                } else if (job.marketKey === 'usol') {
                    await stepSetEndpoint(USOL_MARKET_SERVER_ID);
                }
                log('Processing job ' + (i + 1) + '/' + jobQueue.length + ': ' + jobLabel(job));
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
                // If failure is maintenance-related, mark as skipped so background.js can reschedule
                if (e.message && (e.message.includes('token-expired') || e.message.includes('invalid-access-token'))) {
                    job.status = 'skipped';
                    job.error = errText;
                    abortFlag = true;
                    tokenExpired = true;
                    log('⚠️ Job skipped (token expired): ' + job.name + ' — ' + errText, 'warn');
                } else if (e.message && (e.message.includes('maintenance') || e.message.includes('unreachable'))) {
                    job.status = 'skipped';
                    job.error = errText;
                    job.maintenanceEndsAt = null;
                    log('⚠️ Job skipped (unreachable): ' + job.name + ' — ' + errText, 'warn');
                } else if (e.message && (e.message.includes('Timeout') || e.message.includes('timed out') || e.message.includes('timeout'))) {
                    job.status = 'skipped';
                    job.error = errText + ' (will retry next run)';
                    log('⚠️ Job skipped (timeout): ' + job.name + ' — ' + errText, 'warn');
                } else if (e.message && e.message.includes('rate-limited')) {
                    job.status = 'skipped';
                    job.error = errText + ' (will retry next run)';
                    log('⚠️ Job skipped (rate limited): ' + job.name + ' — ' + errText, 'warn');
                } else {
                    job.status = 'failed';
                    job.error = errText;
                    log('❌ Job failed: ' + job.name + ' — ' + errText, 'error');
                }
            }

            _currentJobRef = null;
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
                completedAt: Date.now(),
                maintenanceEndsAt: j.maintenanceEndsAt || null
            };
        });
        window.postMessage({ type: 'COR3_AUTOJOB_SAVE_COMPLETED', jobs: completedResults }, '*');

        // Brief pause to let summary log persist before market refresh logs
        await delay(500);

        // Refresh all markets sequentially at the end to ensure UI is fully updated
        log('Refreshing all markets sequentially...');
        window.postMessage({ type: 'COR3_REFRESH_ALL_MARKETS_SEQ', skipLots: true }, '*');
        // Wait for completion signal (max 30s)
        await new Promise(function (resolve) {
            var timer = safeTimeout(resolve, 30000);
            function onDone(evt) {
                if (evt.data && evt.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
                    window.removeEventListener('message', onDone);
                    safeClearTimeout(timer);
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
            solverSettings = event.data.settings || {};
            processQueue();
        }

        if (event.data && event.data.type === 'COR3_AUTOJOB_STOP') {
            abortFlag = true;
            log('Stop signal received — aborting after current step', 'warn');
        }
    });

    console.log('[COR3 Helper] Auto Job Solver engine loaded');
})();
