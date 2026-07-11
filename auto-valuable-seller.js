// Auto Valuable Seller Engine — runs in MAIN world
// Communicates with content-early.js via postMessage (COR3_AUTOJOB_CMD for WS sends)
// Receives WS responses via postMessage events from content-early.js interceptors
(function () {
    'use strict';

    var running = false;
    var mode = null; // 'search' or 'seller'
    var _cachedMapData = null; // cached network map to avoid duplicate get.map requests
    var _lastServersData = null; // persisted servers data across search → seller for UI updates
    var _fileAnalysisCache = {}; // fileId → analysis result, avoids redundant get.file.analysis calls
    var _loginStatusCache = {}; // serverId → { data, ts }, avoids redundant get.login.status calls
    var LOGIN_STATUS_CACHE_TTL = 3000; // 3 seconds
    var _desktopToServerMap = {}; // desktopFileId → { serverId, type: 'file'|'log', originalId }

    // Server path map — copied from auto-job-solver.js for maintenance checks
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
            { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' }
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

    // All hackable server IDs with names — build from path map
    var ALL_SERVERS = {};
    for (var sName in SERVER_PATH_MAP) {
        var path = SERVER_PATH_MAP[sName];
        var last = path[path.length - 1];
        ALL_SERVERS[last.id] = sName;
    }

    // Market selling priority: USOL -> SOYUZ -> D4RK -> HOME
    // Each entry includes the market server ID for set.endpoint before selling
    var MARKET_SELL_ORDER = [
        { name: 'USOL', id: '019e4065-6ae8-760d-8724-58ab4f2cf7d7', serverId: '019e4052-c317-7388-9d71-883ffb1560cd' },
        { name: 'SOYUZ', id: '019da731-2db5-7d76-9447-1ea3b9b78001', serverId: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108' },
        { name: 'D4RK', id: '019d3ea4-85bd-7389-904d-908ba9194aa0', serverId: '019d29c5-4b37-79bf-b23e-304d8ea03c15' },
        { name: 'HOME', id: '019d3ea4-85bd-7389-904d-8f7c85841134', serverId: null }
    ];

    function humanDelay() {
        return 800 + Math.floor(Math.random() * 700);
    }

    function log(msg, level) {
        level = level || 'info';
        console.log('[COR3 ValuableSeller]', msg);
        window.postMessage({ type: 'COR3_VALUABLE_LOG', msg: msg, level: level }, '*');
    }

    function signalDone() {
        running = false;
        mode = null;
        window.postMessage({ type: 'COR3_VALUABLE_DONE' }, '*');
    }

    function updateServersUI(serversData) {
        window.postMessage({ type: 'COR3_VALUABLE_SERVERS_UPDATE', data: serversData }, '*');
    }

    function updateDownloadsUI(downloadsData) {
        window.postMessage({ type: 'COR3_VALUABLE_DOWNLOADS_UPDATE', data: downloadsData }, '*');
    }

    function sendCmd(cmd, data) {
        window.postMessage({ type: 'COR3_AUTOJOB_CMD', cmd: cmd, data: data || {} }, '*');
    }

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

    function delay(ms) {
        return new Promise(function (resolve, reject) {
            var target = Date.now() + ms;
            function check() {
                if (!running) { reject(new Error('Stopped')); return; }
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
                if (!running) {
                    done = true;
                    window.removeEventListener('message', handler);
                    reject(new Error('Stopped'));
                    return;
                }
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

    // Get server name from ID using network map cache or path map
    function getServerName(serverId) {
        if (ALL_SERVERS[serverId]) return ALL_SERVERS[serverId];
        var map = window.__cor3ServerTypeMap;
        if (map && map[serverId] && map[serverId].serverName) return map[serverId].serverName;
        return serverId.substring(0, 8);
    }

    // ---- Loadout Resolver for SEARCH software ----

    var RESOURCE_KEYS = ['cpu_frequency', 'cpu_cores', 'gpu_power', 'gpu_memory', 'ram_frequency', 'ram_memory'];
    var _cachedLoadout = null;
    var _cachedLoadoutAt = 0;
    var LOADOUT_COOLDOWN_MS = 2000;
    var _lastLoadoutFetchAt = 0;

    function parseConsuming(vals) {
        if (!vals || !Array.isArray(vals) || vals.length < 2) return null;
        if (vals.length === 2) return { base: 0, min: vals[0], max: vals[1] };
        return { base: vals[0], min: vals[1], max: vals[2] };
    }

    function normSpecs(sw) {
        if (!sw || !sw.specs) return [];
        return Array.isArray(sw.specs) ? sw.specs : [sw.specs];
    }

    function getServerTypeName(serverId) {
        var map = window.__cor3ServerTypeMap;
        if (map && map[serverId]) return map[serverId].serverTypeName;
        return null;
    }

    function calculateAnalysis(loadout, softwareIds) {
        var hw = loadout.equippedHardware || {};
        var allSoftware = loadout.ownedSoftware || [];
        var installed = allSoftware.filter(function (sw) { return softwareIds.indexOf(sw.id) >= 0; });
        var supply = {};
        if (hw.cpu) { supply.cpu_frequency = hw.cpu.specs.cpuFrequency || 0; supply.cpu_cores = hw.cpu.specs.cpuCores || 0; }
        if (hw.gpu) { supply.gpu_power = hw.gpu.specs.gpuPower || 0; supply.gpu_memory = hw.gpu.specs.gpuMemory || 0; }
        if (hw.ram) { supply.ram_frequency = hw.ram.specs.ramFrequency || 0; supply.ram_memory = hw.ram.specs.ramMemory || 0; }
        if (hw.psu) { supply.psu_power = hw.psu.specs.psuPower || 0; }
        var parsed = {};
        for (var si = 0; si < installed.length; si++) {
            var sw = installed[si]; parsed[sw.id] = {};
            for (var ri = 0; ri < RESOURCE_KEYS.length; ri++) {
                var rk = RESOURCE_KEYS[ri];
                var p = parseConsuming(sw.consuming && sw.consuming[rk]);
                if (p) parsed[sw.id][rk] = p;
            }
        }
        var demand = {};
        for (var ri2 = 0; ri2 < RESOURCE_KEYS.length; ri2++) {
            var rk2 = RESOURCE_KEYS[ri2]; var totalBase = 0, highestMinUplift = 0;
            for (var si2 = 0; si2 < installed.length; si2++) {
                var pc = parsed[installed[si2].id][rk2];
                if (pc) { totalBase += pc.base; highestMinUplift = Math.max(highestMinUplift, pc.min - pc.base); }
            }
            demand[rk2] = totalBase + highestMinUplift;
        }
        var psuDemand = 0;
        if (hw.cpu) psuDemand += hw.cpu.specs.cpuConsuming || 0;
        if (hw.gpu) psuDemand += hw.gpu.specs.gpuConsuming || 0;
        demand.psu_total = psuDemand;
        var hasAllHw = !!(hw.cpu && hw.gpu && hw.ram && hw.psu);
        var canBoot = hasAllHw;
        if (canBoot) {
            for (var ri3 = 0; ri3 < RESOURCE_KEYS.length; ri3++) {
                if ((supply[RESOURCE_KEYS[ri3]] || 0) < demand[RESOURCE_KEYS[ri3]]) { canBoot = false; break; }
            }
            if (canBoot && (supply.psu_power || 0) < demand.psu_total) canBoot = false;
        }
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
            var specs3 = normSpecs(sw3);
            var abilities = specs3.map(function (sp) {
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

    async function getLoadoutData(forceRefresh) {
        if (!forceRefresh && _cachedLoadout && (Date.now() - _cachedLoadoutAt < 60000)) {
            return _cachedLoadout;
        }
        var sinceLastFetch = Date.now() - _lastLoadoutFetchAt;
        if (sinceLastFetch < LOADOUT_COOLDOWN_MS && _cachedLoadout) {
            return _cachedLoadout;
        }
        log('Loadout: requesting fresh data via WS...');
        _lastLoadoutFetchAt = Date.now();
        sendCmd('loadout.get', {});
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_LOADOUT', 15000);
            if (resp.data) {
                _cachedLoadout = resp.data;
                _cachedLoadoutAt = Date.now();
                return _cachedLoadout;
            }
        } catch (e) {
            log('Loadout: fetch timeout', 'warn');
        }
        return _cachedLoadout || null;
    }

    function invalidateLoadoutCache() {
        _cachedLoadout = null;
        _cachedLoadoutAt = 0;
    }

    // Find SEARCH software for a server type, sorted by max power descending
    function findSearchSoftwareForServerType(allSoftware, serverTypeName) {
        var candidates = [];
        for (var i = 0; i < allSoftware.length; i++) {
            var specs = normSpecs(allSoftware[i]);
            for (var j = 0; j < specs.length; j++) {
                if (specs[j].type === 'SEARCH' && specs[j].serverTypes &&
                    specs[j].serverTypes.indexOf(serverTypeName) >= 0) {
                    candidates.push({ sw: allSoftware[i], spec: specs[j] });
                }
            }
        }
        candidates.sort(function (a, b) { return b.spec.power[1] - a.spec.power[1]; });
        return candidates;
    }

    // Find HACK software for a server type (needed for hack loadout swaps)
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

    async function applyLoadoutChange(loadout, targetHw, targetSwIds) {
        log('Loadout: applying change — target sw count: ' + targetSwIds.length);
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

        // 3. Equip target software
        for (var ei = 0; ei < targetSwIds.length; ei++) {
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

        if (changed) {
            return await getLoadoutData(true);
        }
        return loadout;
    }

    async function ensureHackOnlyLoadout(serverId) {
        var serverTypeName = getServerTypeName(serverId);
        if (!serverTypeName) {
            log('Loadout: cannot determine server type for ' + getServerName(serverId) + ' — skipping hack loadout');
            return { ok: false, reason: 'unknown-server-type' };
        }

        var serverDefenceRate = 0;
        try {
            var preLoginData = await getLoginStatus(serverId);
            if (preLoginData && preLoginData.serverDefenceRate) {
                serverDefenceRate = preLoginData.serverDefenceRate;
            }
        } catch (e) { }

        invalidateLoadoutCache();
        var loadout = await getLoadoutData(true);
        if (!loadout) {
            log('Loadout: could not fetch loadout data — proceeding without hack loadout', 'warn');
            return { ok: false, reason: 'no-loadout-data' };
        }

        var allSw = loadout.ownedSoftware || [];
        var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
        var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
        log('Loadout: found ' + hackCandidates.length + ' hack candidate(s) for ' + serverTypeName + (hackCandidates.length > 0 ? ' — best: ' + hackCandidates[0].sw.name + ' (power ' + (hackCandidates[0].spec.power || []).join('-') + ')' : ''));

        if (hackCandidates.length === 0) {
            log('Loadout: no HACK software available for ' + serverTypeName, 'warn');
            return { ok: false, reason: 'no-hack-software' };
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
                return { ok: false, reason: 'cannot-boot' };
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
                        return { ok: false, reason: 'insufficient-power', hackPower: upgradedPower, defenceRate: serverDefenceRate };
                    }
                } else {
                    log('Loadout: no better hardware available — best hack power: ' + computedHackPower, 'warn');
                    return { ok: false, reason: 'insufficient-power', hackPower: computedHackPower, defenceRate: serverDefenceRate };
                }
            } else {
                log('Loadout: no hardware upgrade available', 'warn');
                return { ok: false, reason: 'insufficient-power', hackPower: computedHackPower, defenceRate: serverDefenceRate };
            }
        }

        if (!alreadyBest || targetHw !== currentHw) {
            log('Loadout: equipping HACK software "' + bestHack.sw.name + '" (power ' + (bestHack.spec.power || []).join('-') + ') for ' + serverTypeName);
            await applyLoadoutChange(loadout, targetHw, targetSwIds);
        }
        return { ok: true, hackPower: computedHackPower, defenceRate: serverDefenceRate };
    }

    // Equip ONLY the best SEARCH software for a server type (unequips everything else).
    // Used before searching for valuable files/logs.
    async function ensureSearchOnlyLoadout(serverId) {
        var serverTypeName = getServerTypeName(serverId);
        if (!serverTypeName) {
            log('Loadout: cannot determine server type for ' + getServerName(serverId) + ' — skipping search loadout');
            return;
        }

        invalidateLoadoutCache();
        var loadout = await getLoadoutData(true);
        if (!loadout) {
            log('Loadout: could not fetch loadout data — proceeding without search loadout', 'warn');
            return;
        }

        var allSw = loadout.ownedSoftware || [];
        var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
        var searchCandidates = findSearchSoftwareForServerType(allSw, serverTypeName);
        if (searchCandidates.length === 0) {
            log('Loadout: no SEARCH software available for ' + serverTypeName);
            return;
        }

        var bestSearch = searchCandidates[0];
        var targetSwIds = [bestSearch.sw.id];
        var bestHw = findBestHardware(loadout, targetSwIds);
        var targetHw = bestHw || loadout.equippedHardware || {};
        var finalAnalysis = calculateAnalysis(
            Object.assign({}, loadout, { equippedHardware: targetHw }),
            targetSwIds
        );
        if (!finalAnalysis.canBoot) {
            log('Loadout: cannot boot search software — skipping loadout change', 'warn');
            return;
        }
        var searchPower = 0;
        for (var swId in finalAnalysis.swAnalysis) {
            var ab = finalAnalysis.swAnalysis[swId].abilities;
            for (var ai = 0; ai < ab.length; ai++) {
                if (ab[ai].type === 'SEARCH') searchPower = ab[ai].computedPower;
            }
        }
        var swAlreadyOk = equippedSwIds.length === 1 && equippedSwIds[0] === bestSearch.sw.id;
        var curHw = loadout.equippedHardware || {};
        var hwAlreadyOk = (!bestHw) ||
            ((curHw.cpu && curHw.cpu.id) === (targetHw.cpu && targetHw.cpu.id) &&
             (curHw.gpu && curHw.gpu.id) === (targetHw.gpu && targetHw.gpu.id) &&
             (curHw.ram && curHw.ram.id) === (targetHw.ram && targetHw.ram.id) &&
             (curHw.psu && curHw.psu.id) === (targetHw.psu && targetHw.psu.id));
        if (swAlreadyOk && hwAlreadyOk) {
            log('Loadout: best SEARCH software "' + bestSearch.sw.name + '" already equipped with optimal hardware (power: ' + searchPower + '/' + bestSearch.spec.power[1] + ')');
            return searchPower;
        }

        log('Loadout: equipping SEARCH software "' + bestSearch.sw.name + '" (computed power: ' + searchPower + '/' + bestSearch.spec.power[1] + ') for ' + serverTypeName);
        await applyLoadoutChange(loadout, targetHw, targetSwIds);
        return searchPower;
    }

    // Check if server is reachable (no maintenance on path)
    // Uses cached map data if available, otherwise fetches fresh
    async function checkPathMaintenance(serverName) {
        var path = SERVER_PATH_MAP[serverName];
        if (!path || path.length === 0) return { blocked: false };
        var mapData = _cachedMapData;
        if (!mapData) {
            sendCmd('get.map', {});
            try {
                mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
                _cachedMapData = mapData;
            } catch (e) {
                log('⚠️ Could not fetch network map: ' + e.message, 'warn');
                return { blocked: false };
            }
        }
        if (mapData && mapData.servers) {
            for (var i = 0; i < path.length; i++) {
                var srv = path[i];
                var info = mapData.servers[srv.id];
                if (info && info.isInMaintenance) {
                    var remaining = info.maintenanceEndsAt ? new Date(info.maintenanceEndsAt).getTime() - Date.now() : 0;
                    if (remaining > 0) {
                        return { blocked: true, blockerName: srv.name, remainingMs: remaining };
                    }
                }
            }
        }
        return { blocked: false };
    }

    // ---- Hack minigame detection helpers (mirrors auto-job-solver.js) ----
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
                setTimeout(check, interval);
            }
            check();
        });
    }

    function isHackMinigameOpen() {
        return !!(document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
            document.querySelector('[data-sentry-component="IceWallBreakApplication"]') ||
            document.querySelector('[data-component-name="WallBoard"]') ||
            document.querySelector('[data-sentry-component="ConfigHackApplication"]') ||
            document.querySelector('[data-component-name="SimpleDecryptApplication"]') ||
            document.querySelector('[data-sentry-component="SimpleDecryptApplication"]'));
    }

    function waitForHackMinigameClose(waitMs) {
        waitMs = waitMs || 120000;
        return new Promise(function (resolve) {
            var elapsed = 0;
            var interval = 300;
            function check() {
                if (!isHackMinigameOpen()) return resolve(true);
                elapsed += interval;
                if (elapsed >= waitMs) return resolve(false);
                setTimeout(check, interval);
            }
            check();
        });
    }

    async function waitForHackToBeDone() {
        log('Hack minigame started, waiting for solver to complete...');
        var hackSolverTimeout = 60000;
        var hackType = await detectHackType(5000);
        if (hackType === 'ice-wall') {
            hackSolverTimeout = 120000;
            log('ICE Wall hack detected — waiting up to 2 minutes');
        } else if (hackType) {
            log(hackType + ' hack detected — waiting up to 60s');
        } else {
            log('Could not detect hack type — using default 60s timeout', 'warn');
        }

        var saiUpdateReceived = false;
        var canPollClose = !!hackType;
        try {
            await new Promise(function (resolve, reject) {
                var done = false;
                function onEvent(evt) {
                    if (evt.data && evt.data.type === 'COR3_AUTOJOB_SAI_UPDATE') {
                        if (!done) { done = true; window.removeEventListener('message', onEvent); clearInterval(pollTimer); clearTimeout(timeoutTimer); saiUpdateReceived = true; resolve(); }
                    }
                }
                window.addEventListener('message', onEvent);
                var pollTimer = canPollClose ? setInterval(function () {
                    if (!isHackMinigameOpen()) {
                        if (!done) { done = true; window.removeEventListener('message', onEvent); clearInterval(pollTimer); clearTimeout(timeoutTimer); resolve(); }
                    }
                }, 500) : 0;
                var timeoutTimer = setTimeout(function () {
                    if (!done) { done = true; window.removeEventListener('message', onEvent); if (pollTimer) clearInterval(pollTimer); reject(new Error('timeout')); }
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
        if (isHackMinigameOpen()) {
            log('Waiting for hack minigame dialog to close...');
            await waitForHackMinigameClose(30000);
        }
    }

    function ensureSolversEnabled() {
        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER' }, '*');
        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_ICE_WALL_SOLVER' }, '*');
        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_SIMPLE_DECRYPT_SOLVER' }, '*');
    }

    // ---- Server access helpers (mirrors auto-job-solver.js stepSetEndpoint/stepLogin) ----

    // Internal: send set.endpoint and wait for result
    async function _sendSetEndpoint(serverId) {
        sendCmd('set.endpoint', { serverId: serverId });
        return await new Promise(function (resolve) {
            var timer;
            function endpointHandler(evt) {
                if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                    cleanup();
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
                clearTimeout(timer);
            }
            window.addEventListener('message', endpointHandler);
            timer = setTimeout(function () {
                window.removeEventListener('message', endpointHandler);
                resolve({ ok: true, timeout: true });
            }, 10000);
        });
    }

    // Find the path map entry for a target server by name
    function getPathForServerName(serverName) {
        var path = SERVER_PATH_MAP[serverName];
        if (path && path.length > 0) return path;
        return null;
    }

    // Set endpoint with path-through hack on unreachable
    async function setEndpoint(serverId) {
        var name = getServerName(serverId);
        log('Setting endpoint to ' + name);
        var raceResult = await _sendSetEndpoint(serverId);

        if (raceResult.unreachable) {
            // Try path-through: hack intermediate servers on the path
            var path = getPathForServerName(name);
            if (!path || path.length <= 1) {
                var noPathCheck = await checkPathMaintenance(name);
                if (noPathCheck.blocked) {
                    var nMins = Math.ceil(noPathCheck.remainingMs / 60000);
                    log(name + ' unreachable (' + noPathCheck.blockerName + ' in maintenance, ~' + nMins + 'm remaining)', 'error');
                    return false;
                }
                log(name + ' unreachable (no path to server)', 'error');
                return false;
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
                    return false;
                }
                await delay(humanDelay());
                // Login/hack to this intermediate server
                if (!await loginOrHack(intermediate.id)) {
                    log('⚡ Path-through: login/hack failed on ' + intermediate.name, 'warn');
                    return false;
                }
                await delay(humanDelay());
            }
            // Retry the original endpoint
            log('⚡ Path-through complete — retrying endpoint to target server');
            raceResult = await _sendSetEndpoint(serverId);
            if (raceResult.unreachable) {
                var finalCheck = await checkPathMaintenance(name);
                if (finalCheck.blocked) {
                    var fMins = Math.ceil(finalCheck.remainingMs / 60000);
                    log(name + ' still unreachable after path-through (' + finalCheck.blockerName + ' in maintenance, ~' + fMins + 'm remaining)', 'error');
                } else {
                    log(name + ' still unreachable after path-through hack', 'error');
                }
                return false;
            }
        }

        if (raceResult.timeout) {
            log('Endpoint set timeout (may already be set)', 'warn');
        }
        await delay(humanDelay());
        return true;
    }

    // Check login status for a server — returns full login data including activeAccesses
    // Cached with LOGIN_STATUS_CACHE_TTL to avoid redundant WS calls; pass forceRefresh=true to bypass
    async function getLoginStatus(serverId, forceRefresh) {
        if (!forceRefresh) {
            var cached = _loginStatusCache[serverId];
            if (cached && (Date.now() - cached.ts) < LOGIN_STATUS_CACHE_TTL) {
                return cached.data;
            }
        }
        sendCmd('get.login.status', { serverId: serverId });
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
            if (resp.error) return null;
            var data = resp.data || null;
            _loginStatusCache[serverId] = { data: data, ts: Date.now() };
            return data;
        } catch (e) {
            return null;
        }
    }

    // Login/hack to a server (used by path-through and ensureServerAccess)
    // Checks active accesses first, then hacks if needed
    async function loginOrHack(serverId) {
        var name = getServerName(serverId);
        log('Checking login status for ' + name);
        var loginData = await getLoginStatus(serverId);

        // Check for active access
        if (loginData && loginData.activeAccesses && loginData.activeAccesses.length > 0) {
            var accessObj = loginData.activeAccesses[0];
            var accessId = accessObj.id;
            var accessType = accessObj.accessType || accessObj.type || 'unknown';
            log('Using existing access on ' + name + ' (' + accessType + ')');
            sendCmd('login.with-access', { serverId: serverId, accessGrantId: accessId });
            try {
                var loginResult = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
                if (loginResult.error || !(loginResult.data && loginResult.data.success)) {
                    log(name + ': login with access failed', 'warn');
                    return false;
                }
            } catch (e) {
                log(name + ': login with access timed out', 'warn');
                return false;
            }
            log('Logged in via existing access to ' + name, 'success');
            return true;
        }

        var loginDefenceRate = (loginData && loginData.serverDefenceRate) ? loginData.serverDefenceRate : 0;
        var loginHackPower = 0;
        if (loginData && loginData.hackTools && loginData.hackTools.length > 0) {
            loginHackPower = loginData.hackTools[0].hackPower || 0;
            log('Hack info — serverDefenceRate: ' + loginDefenceRate + ', equipped hackPower: ' + loginHackPower + ' (' + (loginData.hackTools[0].name || 'unknown') + ')' + (loginDefenceRate > 0 ? (loginHackPower >= loginDefenceRate ? ' ✓' : ' ✗ INSUFFICIENT') : ''));
        } else if (loginDefenceRate > 0) {
            log('Hack info — serverDefenceRate: ' + loginDefenceRate + ', no hack tools equipped', 'warn');
        }

        log('No active access to ' + name + ' — equipping hack loadout');
        var loadoutResult = await ensureHackOnlyLoadout(serverId);
        if (loadoutResult && !loadoutResult.ok && loadoutResult.reason === 'insufficient-power') {
            log(name + ': skipping (hack power ' + loadoutResult.hackPower + ' < serverDefenceRate ' + loadoutResult.defenceRate + ')', 'error');
            return false;
        }
        await delay(humanDelay());

        var hackAttemptResult = await _attemptHack(serverId, name);
        if (hackAttemptResult === true) return true;
        if (hackAttemptResult === false) return false;

        if (hackAttemptResult === 'retry-loadout') {
            log(name + ': hack failed with sai-hack-impossible — trying loadout swap and retry');
            var swapResult = await _tryHackLoadoutSwap(serverId);
            if (!swapResult) {
                log(name + ': loadout swap failed — skipping (no access)', 'error');
                return false;
            }
            await delay(humanDelay());
            var retryResult = await _attemptHack(serverId, name);
            if (retryResult === true) return true;
            log(name + ': hack retry failed after loadout swap', 'error');
            return false;
        }

        return false;
    }

    async function _attemptHack(serverId, name) {
        log('Starting hack on ' + name);
        ensureSolversEnabled();
        await delay(300);
        sendCmd('hack.start', { serverId: serverId });

        var hackResult;
        try {
            hackResult = await new Promise(function (resolve, reject) {
                var done = false;
                var timer = setTimeout(function () {
                    if (!done) { done = true; window.removeEventListener('message', onMsg); reject(new Error('Timeout')); }
                }, 30000);
                function onMsg(evt) {
                    if (!evt.data) return;
                    if (evt.data.type === 'COR3_AUTOJOB_SAI_HACK_START') {
                        if (!done) { done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); resolve(evt.data); }
                    } else if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                        if (!done) { done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); resolve({ data: { minigameStarted: true }, error: null }); }
                    }
                }
                window.addEventListener('message', onMsg);
            });
        } catch (e) {
            log('Hack start event timed out — checking if hack already completed...', 'warn');
            var fallbackLogin = await getLoginStatus(serverId, true);
            if (fallbackLogin && fallbackLogin.activeAccesses && fallbackLogin.activeAccesses.length > 0) {
                var fbAccess = fallbackLogin.activeAccesses[0];
                log('Hack already completed (found ' + (fbAccess.accessType || fbAccess.type || 'unknown') + ' access after timeout) — logging in', 'success');
                sendCmd('login.with-access', { serverId: serverId, accessGrantId: fbAccess.id });
                try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
                await delay(humanDelay());
                return true;
            }
            log(name + ': hack start timed out', 'error');
            return false;
        }

        if (hackResult.error) {
            var errMsg = hackResult.error.message || JSON.stringify(hackResult.error);
            log('Hack returned error: ' + errMsg + ' — checking access...', 'warn');
            var errLogin = await getLoginStatus(serverId, true);
            if (errLogin && errLogin.activeAccesses && errLogin.activeAccesses.length > 0) {
                var errAccess = errLogin.activeAccesses[0];
                log('Already have ' + (errAccess.accessType || errAccess.type || 'unknown') + ' access despite hack error — logging in', 'success');
                sendCmd('login.with-access', { serverId: serverId, accessGrantId: errAccess.id });
                try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
                await delay(humanDelay());
                return true;
            }
            if (errMsg.indexOf('sai-hack-impossible') >= 0 || errMsg.indexOf('sai-no-hack-software') >= 0) {
                return 'retry-loadout';
            }
            log(name + ': hack failed: ' + errMsg, 'error');
            return false;
        }

        if (hackResult.data && hackResult.data.autoHacked) {
            log('Server auto-hacked (no minigame) — skipping solver wait', 'success');
        } else if (hackResult.data && hackResult.data.minigameStarted) {
            log('Hack minigame detected via minigame event');
            await waitForHackToBeDone();
        } else {
            await waitForHackToBeDone();
        }

        await delay(humanDelay());
        var maxRetries = 5;
        for (var attempt = 0; attempt < maxRetries; attempt++) {
            var postHackLogin = await getLoginStatus(serverId, true);
            if (postHackLogin && postHackLogin.activeAccesses && postHackLogin.activeAccesses.length > 0) {
                var postHackAccess = postHackLogin.activeAccesses[0];
                var postHackType = postHackAccess.accessType || postHackAccess.type || 'unknown';
                sendCmd('login.with-access', { serverId: serverId, accessGrantId: postHackAccess.id });
                try {
                    await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
                } catch (e) { /* proceed anyway */ }
                log('Logged in to ' + name + ' (' + postHackType + ')', 'success');
                return true;
            } else {
                log('No active access after hack (attempt ' + (attempt + 1) + '/' + maxRetries + '), retrying...', 'warn');
                await delay(5000);
            }
        }
        log(name + ': no active access after hack (' + maxRetries + ' attempts) — hack may have failed', 'error');
        return false;
    }

    async function _tryHackLoadoutSwap(serverId) {
        invalidateLoadoutCache();
        var loadout = await getLoadoutData(true);
        if (!loadout) {
            log('Loadout: cannot retry — no loadout data available', 'warn');
            return false;
        }

        var serverTypeName = getServerTypeName(serverId);
        if (!serverTypeName) {
            log('Loadout: cannot determine server type for ' + getServerName(serverId), 'warn');
            return false;
        }

        var allSw = loadout.ownedSoftware || [];
        var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
        var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
        if (hackCandidates.length === 0) {
            log('Loadout: no hack software available for ' + serverTypeName, 'warn');
            return false;
        }

        var bestHack = hackCandidates[0];
        var targetSwIds = [bestHack.sw.id];

        var serverDefenceRate = 0;
        try {
            var loginStatus = await getLoginStatus(serverId, true);
            if (loginStatus && loginStatus.serverDefenceRate) {
                serverDefenceRate = loginStatus.serverDefenceRate;
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
                return false;
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
                    return false;
                }
            } else {
                log('Loadout: no hardware upgrade available — cannot reach serverDefenceRate (' + serverDefenceRate + ')', 'error');
                return false;
            }
        }

        log('Loadout: equipping HACK-only "' + bestHack.sw.name + '" for retry');
        await applyLoadoutChange(loadout, targetHw, targetSwIds);
        return true;
    }

    // Ensure access to server: set endpoint -> check login -> hack if needed
    // Mirrors auto-job-solver.js stepSetEndpoint + stepLogin pattern
    async function ensureServerAccess(serverId) {
        var name = getServerName(serverId);
        log('Ensuring access to ' + name);

        // Check maintenance
        if (SERVER_PATH_MAP[name]) {
            var maint = await checkPathMaintenance(name);
            if (maint.blocked) {
                log('⚠️ ' + name + ' unreachable — ' + maint.blockerName + ' in maintenance', 'warn');
                return false;
            }
        }

        // Set endpoint (includes path-through hacking if unreachable)
        if (!await setEndpoint(serverId)) return false;

        // Login or hack
        return await loginOrHack(serverId);
    }

    // Get files from current endpoint server
    async function getServerFiles(serverId) {
        sendCmd('get.files', { serverId: serverId });
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 15000);
            if (resp.error) {
                var errMsg = resp.error.message || resp.error.kind || JSON.stringify(resp.error);
                if (errMsg.indexOf('sai-files-not-available') >= 0) {
                    log('Files not available on this server (sai-files-not-available)', 'warn');
                    return [];
                }
                log('Get files error: ' + errMsg, 'error');
                return [];
            }
            return (resp.data && resp.data.files) || [];
        } catch (e) {
            log('Get files timeout', 'warn');
            return [];
        }
    }

    // Get logs from current endpoint server
    async function getServerLogs(serverId) {
        sendCmd('get.logs', { serverId: serverId });
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_SAI_LOGS', 15000);
            if (resp.error) {
                var errMsg = resp.error.message || resp.error.kind || JSON.stringify(resp.error);
                if (errMsg.indexOf('sai-logs-not-available') >= 0) {
                    return [];
                }
                log('Get logs error: ' + errMsg, 'error');
                return [];
            }
            return (resp.data && resp.data.logs) || [];
        } catch (e) {
            log('Get logs timeout', 'warn');
            return [];
        }
    }

    // Filter valuable files (basePrice > 0)
    function filterValuableFiles(files) {
        return files.filter(function (f) { return f.basePrice > 0 && f.tags && f.tags.length > 0; });
    }

    // Filter valuable logs (basePrice > 0)
    function filterValuableLogs(logs) {
        return logs.filter(function (l) { return l.basePrice > 0 && l.tags && l.tags.length > 0; });
    }

    // Get downloads folder contents
    async function getDownloadsFolder() {
        var folderId = window.__cor3DownloadFolderId;
        if (!folderId) {
            log('Downloads folder ID not cached — requesting desktop options');
            sendCmd('desktop.get.options', {});
            try {
                var optResp = await waitForEvent('COR3_AUTOJOB_DESKTOP_OPTIONS', 10000);
                if (optResp.data && optResp.data.folders) {
                    var dlf = optResp.data.folders.find(function (f) { return f.name === 'Downloads'; });
                    if (dlf) {
                        folderId = dlf.id;
                        window.__cor3DownloadFolderId = folderId;
                    }
                }
            } catch (e) {}
        }
        if (!folderId) {
            log('Could not find Downloads folder ID', 'error');
            return [];
        }

        sendCmd('open.folder', { folderId: folderId, source: 'desktop' });
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_DESKTOP_FOLDER', 15000);
            if (resp.error) {
                log('Open folder error: ' + JSON.stringify(resp.error), 'error');
                return [];
            }
            return (resp.data && resp.data.files) || [];
        } catch (e) {
            log('Open folder timeout', 'warn');
            return [];
        }
    }

    // Get file analysis for a downloaded file (cached to avoid redundant WS calls)
    async function getFileAnalysis(fileId) {
        if (_fileAnalysisCache[fileId]) {
            return _fileAnalysisCache[fileId];
        }
        sendCmd('get.file.analysis', { fileId: fileId });
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_FILE_ANALYSIS', 10000);
            if (resp.error) return null;
            var result = resp.data || null;
            if (result) _fileAnalysisCache[fileId] = result;
            return result;
        } catch (e) {
            return null;
        }
    }

    // Trigger file.search-valuable on a server
    async function searchValuableFiles(serverId) {
        sendCmd('file.search-valuable', { serverId: serverId });
        try {
            var resp = await waitForEvent('COR3_VALUABLE_FILE_SEARCH', 30000);
            if (resp.error) {
                log('File search-valuable error: ' + JSON.stringify(resp.error), 'error');
                return null;
            }
            return resp.data || null;
        } catch (e) {
            log('File search-valuable timeout', 'warn');
            return null;
        }
    }

    // Trigger log.search-valuable on a server
    async function searchValuableLogs(serverId) {
        sendCmd('log.search-valuable', { serverId: serverId });
        try {
            var resp = await waitForEvent('COR3_VALUABLE_LOG_SEARCH', 30000);
            if (resp.error) {
                var errMsg = resp.error.message || resp.error.kind || JSON.stringify(resp.error);
                if (errMsg.indexOf('sai-logs-not-available') >= 0) {
                    return null;
                }
                log('Log search-valuable error: ' + errMsg, 'error');
                return null;
            }
            return resp.data || null;
        } catch (e) {
            log('Log search-valuable timeout', 'warn');
            return null;
        }
    }

    // Download a file from a server
    async function downloadFile(serverId, fileId) {
        var desktopFileId = null;
        function onUpdateFile(evt) {
            if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_UPDATE_FILE' && evt.data.data && evt.data.data.file) {
                desktopFileId = evt.data.data.file.id;
            }
        }
        window.addEventListener('message', onUpdateFile);
        sendCmd('file.download', { serverId: serverId, fileId: fileId });
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DOWNLOAD', 30000);
            window.removeEventListener('message', onUpdateFile);
            if (resp.error) {
                log('File download error: ' + JSON.stringify(resp.error), 'error');
                return false;
            }
            if (desktopFileId) {
                _desktopToServerMap[desktopFileId] = { serverId: serverId, type: 'file', originalId: fileId };
            }
            return true;
        } catch (e) {
            window.removeEventListener('message', onUpdateFile);
            log('File download timeout', 'warn');
            return false;
        }
    }

    // Download a log from a server
    async function downloadLog(serverId, logSeq) {
        var desktopFileId = null;
        function onUpdateFile(evt) {
            if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_UPDATE_FILE' && evt.data.data && evt.data.data.file) {
                desktopFileId = evt.data.data.file.id;
            }
        }
        window.addEventListener('message', onUpdateFile);
        sendCmd('log.download', { serverId: serverId, seq: logSeq });
        try {
            var resp = await waitForEvent('COR3_AUTOJOB_SAI_LOG_DOWNLOAD', 30000);
            window.removeEventListener('message', onUpdateFile);
            if (resp.error) {
                log('Log download error: ' + JSON.stringify(resp.error), 'error');
                return false;
            }
            if (desktopFileId) {
                _desktopToServerMap[desktopFileId] = { serverId: serverId, type: 'log', originalId: logSeq };
            }
            return true;
        } catch (e) {
            window.removeEventListener('message', onUpdateFile);
            log('Log download timeout', 'warn');
            return false;
        }
    }

    // Get sellable items from a market
    async function getSellableItems(marketId) {
        sendCmd('get.sellable-items', { marketId: marketId });
        try {
            var resp = await waitForEvent('COR3_VALUABLE_SELLABLE_ITEMS', 15000);
            if (resp.error) {
                log('Get sellable items error: ' + JSON.stringify(resp.error), 'error');
                return { items: [], totalPrice: 0, totalRepGain: 0 };
            }
            var d = resp.data || {};
            return {
                items: d.items || [],
                totalPrice: d.totalPrice || 0,
                totalRepGain: d.totalRepGain || 0
            };
        } catch (e) {
            log('Get sellable items timeout', 'warn');
            return { items: [], totalPrice: 0, totalRepGain: 0 };
        }
    }

    // Sell items to a market (one at a time)
    async function sellItems(marketId, items, onSold) {
        var sold = 0;
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            sendCmd('sell.items', { marketId: marketId, items: [{ itemType: item.itemType, itemId: item.itemId }] });
            try {
                var resp = await waitForEvent('COR3_VALUABLE_SELL_RESULT', 15000);
                if (resp.error) {
                    log('Sell item error (' + item.itemId + '): ' + JSON.stringify(resp.error), 'error');
                    continue;
                }
                sold++;
                if (onSold) onSold(item);
            } catch (e) {
                log('Sell item timeout (' + item.itemId + ')', 'warn');
                continue;
            }
            if (i < items.length - 1) await delay(humanDelay());
        }
        return sold;
    }

    // ===== SEARCH MODE =====
    async function runSearch() {
        log('=== Valuable Search Started ===', 'info');
        _cachedMapData = null; // invalidate cached map at start of each run

        var serversData = { servers: [] };
        _lastServersData = serversData;
        var downloadsData = { files: [] };

        // Step 1: Get network map to discover all hackable servers
        log('Fetching network map...');
        sendCmd('get.map', {});
        var mapServers = [];
        try {
            var mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
            _cachedMapData = mapData; // cache for checkPathMaintenance to avoid duplicate get.map
            if (mapData && mapData.servers) {
                for (var sid in mapData.servers) {
                    var sInfo = mapData.servers[sid];
                    // Only include hackable servers (those in our path map)
                    var sName = ALL_SERVERS[sid];
                    if (sName && !sInfo.isInMaintenance) {
                        mapServers.push({ id: sid, name: sName, isAccessible: sInfo.isAccessible || false });
                    }
                }
            }
        } catch (e) {
            log('Network map timeout — using hardcoded server list', 'warn');
            for (var sId in ALL_SERVERS) {
                mapServers.push({ id: sId, name: ALL_SERVERS[sId], isAccessible: false });
            }
        }

        // Sort servers furthest-first (longer path = further) to reduce maintenance risk on closer servers
        mapServers.sort(function (a, b) {
            var pathA = SERVER_PATH_MAP[a.name] || [];
            var pathB = SERVER_PATH_MAP[b.name] || [];
            return pathB.length - pathA.length;
        });

        log('Found ' + mapServers.length + ' reachable servers to scan (furthest first)');

        // Step 2: Scan each server for valuable files/logs
        for (var i = 0; i < mapServers.length; i++) {
            if (!running) { log('Search stopped by user.', 'warn'); break; }

            var server = mapServers[i];
            log('Scanning server ' + (i + 1) + '/' + mapServers.length + ': ' + server.name);

            var serverEntry = {
                id: server.id,
                name: server.name,
                status: 'OPEN',
                files: [],
                logs: [],
                selected: false
            };

            // Ensure access
            if (!await ensureServerAccess(server.id)) {
                log(server.name + ': skipping (no access)', 'warn');
                serverEntry.status = 'SKIPPED';
                serversData.servers.push(serverEntry);
                updateServersUI(serversData);
                continue;
            }

            await delay(humanDelay());

            // Get files
            var files = await getServerFiles(server.id);
            var valuableFiles = filterValuableFiles(files);
            for (var fi = 0; fi < valuableFiles.length; fi++) {
                var f = valuableFiles[fi];
                var tags = (f.tags || []).map(function (t) {
                    return typeof t === 'string' ? { key: t, label: t } : t;
                });
                serverEntry.files.push({
                    fileId: f.fileId,
                    name: f.name,
                    basePrice: f.basePrice,
                    detectRate: f.detectRate,
                    tags: tags
                });
            }

            await delay(humanDelay());

            // Get logs
            var logs = await getServerLogs(server.id);
            var valuableLogs = filterValuableLogs(logs);
            for (var li = 0; li < valuableLogs.length; li++) {
                var l = valuableLogs[li];
                var ltags = (l.tags || []).map(function (t) {
                    return typeof t === 'string' ? { key: t, label: t } : t;
                });
                serverEntry.logs.push({
                    seq: l.seq,
                    message: l.message,
                    basePrice: l.basePrice,
                    detectRate: l.detectRate,
                    tags: ltags
                });
            }

            var total = serverEntry.files.length + serverEntry.logs.length;
            if (total > 0) {
                serverEntry.status = 'OPEN';
                log(server.name + ': found ' + serverEntry.files.length + ' valuable file(s), ' + serverEntry.logs.length + ' valuable log(s)', 'success');
            } else {
                serverEntry.status = 'DONE';
                log(server.name + ': no valuables found');
                serverEntry.selected = false;
            }

            serversData.servers.push(serverEntry);
            updateServersUI(serversData);
            await delay(humanDelay());
        }

        // Step 3: Scan downloads folder for valuable files
        if (running) {
            log('Scanning downloads folder...');
            var dlFiles = await getDownloadsFolder();
            var valuableDlFiles = dlFiles.filter(function (f) { return f.isValuable; });

            for (var di = 0; di < valuableDlFiles.length; di++) {
                if (!running) break;
                var dlFile = valuableDlFiles[di];
                log('Analyzing download: ' + dlFile.name);

                var analysis = await getFileAnalysis(dlFile.id);
                var dlTags = [];
                var dlSource = '—';
                if (analysis) {
                    dlTags = (analysis.tags || []).map(function (t) {
                        return typeof t === 'string' ? { key: t, label: t } : t;
                    });
                    dlSource = analysis.source || '—';
                }

                downloadsData.files.push({
                    id: dlFile.id,
                    name: dlFile.name,
                    source: dlSource,
                    tags: dlTags,
                    status: 'OPEN',
                    selected: false
                });

                updateDownloadsUI(downloadsData);
                await delay(humanDelay());
            }

            log('Downloads folder: found ' + downloadsData.files.length + ' valuable file(s)', 'success');
        }

        log('=== Valuable Search Complete ===', 'success');
        signalDone();
    }

    // ===== SELLER MODE =====
    async function runSeller(selectedServers, selectedDownloads) {
        log('=== Valuable Seller Started ===', 'info');
        _cachedMapData = null;
        _desktopToServerMap = {};

        // Sort selected servers furthest-first (longer path = further) to reduce maintenance risk
        selectedServers = selectedServers.slice().sort(function (a, b) {
            var nameA = getServerName(a);
            var nameB = getServerName(b);
            var pathA = SERVER_PATH_MAP[nameA] || [];
            var pathB = SERVER_PATH_MAP[nameB] || [];
            return pathB.length - pathA.length;
        });

        log('Selected: ' + selectedServers.length + ' server(s), ' + selectedDownloads.length + ' download(s) (processing furthest first)');
        var _sellerDownloadsData = { files: [] };

        // Step 1: For selected servers, access + search-valuable + download
        for (var si = 0; si < selectedServers.length; si++) {
            if (!running) { log('Seller stopped by user.', 'warn'); break; }

            var serverId = selectedServers[si];
            var serverName = getServerName(serverId);
            log('Processing server ' + (si + 1) + '/' + selectedServers.length + ': ' + serverName);

            // Ensure access (hack loadout equipped internally if needed)
            if (!await ensureServerAccess(serverId)) {
                log(serverName + ': skipping (no access)', 'warn');
                continue;
            }

            await delay(humanDelay());

            // Check what the search phase found for this server to skip unnecessary calls
            var searchPhaseEntry = _lastServersData ? _lastServersData.servers.find(function (s) { return s.id === serverId; }) : null;
            var hasSearchFiles = !searchPhaseEntry || (searchPhaseEntry.files && searchPhaseEntry.files.length > 0);
            var hasSearchLogs = !searchPhaseEntry || (searchPhaseEntry.logs && searchPhaseEntry.logs.length > 0);

            // Only equip search loadout and search if there's something to find
            if (hasSearchFiles || hasSearchLogs) {
                await ensureSearchOnlyLoadout(serverId);
                await delay(humanDelay());
            }

            // Search for valuable files (skip if search phase found no files on this server)
            var detectedFileIds = {};
            if (hasSearchFiles) {
                log(serverName + ': searching for valuable files...');
                var fileSearchResult = await searchValuableFiles(serverId);
                if (fileSearchResult && fileSearchResult.found) {
                    var valuableFound = fileSearchResult.found.filter(function (f) { return f.basePrice > 0; });
                    for (var dfi = 0; dfi < valuableFound.length; dfi++) {
                        detectedFileIds[valuableFound[dfi].id] = true;
                    }
                    log(serverName + ': file search-valuable completed — detected ' + valuableFound.length + ' file(s)' + (valuableFound.length < fileSearchResult.found.length ? ' (' + (fileSearchResult.found.length - valuableFound.length) + ' skipped, basePrice=0)' : '') + ', searchPower used: ' + (fileSearchResult.searchPowerUsed || '?'), 'success');
                }
                await delay(humanDelay());
            } else {
                log(serverName + ': skipping file search-valuable (no valuable files found during scan)');
            }

            // Search for valuable logs (skip if search phase found no logs on this server)
            var detectedLogIds = {};
            if (hasSearchLogs) {
                log(serverName + ': searching for valuable logs...');
                var logSearchResult = await searchValuableLogs(serverId);
                if (logSearchResult && logSearchResult.found) {
                    var valuableLogsFound = logSearchResult.found.filter(function (l) { return l.basePrice > 0; });
                    for (var dli = 0; dli < valuableLogsFound.length; dli++) {
                        detectedLogIds[valuableLogsFound[dli].id] = true;
                    }
                    log(serverName + ': log search-valuable completed — detected ' + valuableLogsFound.length + ' log(s)' + (valuableLogsFound.length < logSearchResult.found.length ? ' (' + (logSearchResult.found.length - valuableLogsFound.length) + ' skipped, basePrice=0)' : ''), 'success');
                }
                await delay(humanDelay());
            } else {
                log(serverName + ': skipping log search-valuable (no valuable logs found during scan)');
            }

            // Re-fetch files from server
            var files = await getServerFiles(serverId);
            var valuableFiles = filterValuableFiles(files);

            // Filter to only files that were detected by search-valuable
            var hasFileFilter = Object.keys(detectedFileIds).length > 0;
            if (hasFileFilter) {
                var beforeCount = valuableFiles.length;
                valuableFiles = valuableFiles.filter(function (f) { return detectedFileIds[f.fileId || f.id]; });
                if (beforeCount !== valuableFiles.length) {
                    log(serverName + ': filtered files: ' + valuableFiles.length + ' detected of ' + beforeCount + ' total valuable');
                }
            }

            // Update UI
            if (_lastServersData) {
                var srvEntry = _lastServersData.servers.find(function (s) { return s.id === serverId; });
                if (srvEntry) {
                    srvEntry.files = valuableFiles.map(function (f) {
                        return { fileId: f.fileId || f.id, name: f.name, tags: f.tags || [], basePrice: f.basePrice || 0 };
                    });
                    updateServersUI(_lastServersData);
                }
            }

            // Download detected files only
            for (var fi = 0; fi < valuableFiles.length; fi++) {
                if (!running) break;
                var vf = valuableFiles[fi];
                var tagLabels = (vf.tags || []).map(function (t) { return typeof t === 'string' ? t : (t.label || t.key); }).join(', ');
                log(serverName + ': downloading file "' + vf.name + '" (tags: ' + tagLabels + ', price: ' + vf.basePrice + ')');
                var dlOk = await downloadFile(serverId, vf.fileId);
                if (dlOk) {
                    log(serverName + ': file downloaded ✓', 'success');
                } else {
                    log(serverName + ': file download failed', 'error');
                }
                await delay(humanDelay());
            }

            // Re-fetch logs from server
            var logs = await getServerLogs(serverId);
            var valuableLogs = filterValuableLogs(logs);

            // Filter to only logs that were detected by search-valuable
            var hasLogFilter = Object.keys(detectedLogIds).length > 0;
            if (hasLogFilter) {
                var beforeLogCount = valuableLogs.length;
                valuableLogs = valuableLogs.filter(function (l) { return detectedLogIds[String(l.seq)]; });
                if (beforeLogCount !== valuableLogs.length) {
                    log(serverName + ': filtered logs: ' + valuableLogs.length + ' detected of ' + beforeLogCount + ' total valuable');
                }
            }

            // Update UI
            if (_lastServersData) {
                var srvEntryLogs = _lastServersData.servers.find(function (s) { return s.id === serverId; });
                if (srvEntryLogs) {
                    srvEntryLogs.logs = valuableLogs.map(function (l) {
                        return { seq: l.seq, message: l.message, tags: l.tags || [], basePrice: l.basePrice || 0 };
                    });
                    updateServersUI(_lastServersData);
                }
            }

            // Download detected logs only
            for (var li = 0; li < valuableLogs.length; li++) {
                if (!running) break;
                var vl = valuableLogs[li];
                var ltagLabels = (vl.tags || []).map(function (t) { return typeof t === 'string' ? t : (t.label || t.key); }).join(', ');
                log(serverName + ': downloading log "' + vl.message + '" (tags: ' + ltagLabels + ', price: ' + vl.basePrice + ')');
                var dlLogOk = await downloadLog(serverId, vl.seq);
                if (dlLogOk) {
                    log(serverName + ': log downloaded ✓', 'success');
                } else {
                    log(serverName + ': log download failed', 'error');
                }
                await delay(humanDelay());
            }

            // Mark server as DOWNLOADED in UI
            if (_lastServersData) {
                var srvDone = _lastServersData.servers.find(function (s) { return s.id === serverId; });
                if (srvDone) {
                    srvDone.status = 'DOWNLOADED';
                    updateServersUI(_lastServersData);
                }
            }

            // Refresh downloads folder and update Downloads tab
            log(serverName + ': refreshing downloads folder...');
            await delay(500);
            var dlFiles = await getDownloadsFolder();
            var valuableDlFiles = dlFiles.filter(function (f) { return f.isValuable; });
            _sellerDownloadsData = { files: [] };
            for (var di = 0; di < valuableDlFiles.length; di++) {
                var dlFile = valuableDlFiles[di];
                var isCached = !!_fileAnalysisCache[dlFile.id];
                if (!isCached) await delay(300);
                var analysis = await getFileAnalysis(dlFile.id);
                var dlTags = [];
                var dlSource = '—';
                if (analysis) {
                    dlTags = (analysis.tags || []).map(function (t) {
                        return typeof t === 'string' ? { key: t, label: t } : t;
                    });
                    dlSource = analysis.source || '—';
                }
                _sellerDownloadsData.files.push({
                    id: dlFile.id,
                    name: dlFile.name,
                    source: dlSource,
                    tags: dlTags,
                    status: 'OPEN',
                    selected: false
                });
            }
            updateDownloadsUI(_sellerDownloadsData);
            log(serverName + ': downloads folder has ' + _sellerDownloadsData.files.length + ' valuable file(s)');

            log(serverName + ': done processing');
        }

        // Step 2: Sell items at markets in priority order
        if (running) {
            log('--- Selling valuables at markets ---');

            for (var mi = 0; mi < MARKET_SELL_ORDER.length; mi++) {
                if (!running) break;

                var market = MARKET_SELL_ORDER[mi];
                log('Checking ' + market.name + ' market for sellable items...');

                // Set endpoint to market server before requesting sellable items (HOME is default, skip)
                if (market.serverId) {
                    log(market.name + ': setting endpoint to market server...');
                    var epOk = await _sendSetEndpoint(market.serverId);
                    if (!epOk) {
                        log(market.name + ': failed to set endpoint — skipping', 'warn');
                        continue;
                    }
                    await delay(humanDelay());
                }

                var sellableResult = await getSellableItems(market.id);
                var sellableItems = sellableResult.items || [];
                if (sellableItems.length === 0) {
                    log(market.name + ': no sellable items');
                    await delay(humanDelay());
                    continue;
                }

                var items = sellableItems.map(function (item) {
                    var id = item.itemId || item.id || item.fileId;
                    var type = item.itemType || 'file';
                    return id ? { itemType: type, itemId: id } : null;
                }).filter(Boolean);
                log(market.name + ': found ' + items.length + ' sellable item(s) (💰' + sellableResult.totalPrice + ' ⭐' + sellableResult.totalRepGain + ')');

                if (items.length > 0) {
                    await delay(humanDelay());
                    log(market.name + ': selling ' + items.length + ' item(s)...');
                    var sold = await sellItems(market.id, items, function (soldItem) {
                        var sid = soldItem.itemId;
                        _sellerDownloadsData.files = _sellerDownloadsData.files.filter(function (f) { return f.id !== sid; });
                        updateDownloadsUI(_sellerDownloadsData);
                        if (_lastServersData) {
                            var mapping = _desktopToServerMap[sid];
                            if (mapping) {
                                var targetSrv = _lastServersData.servers.find(function (s) { return s.id === mapping.serverId; });
                                if (targetSrv) {
                                    if (mapping.type === 'file') {
                                        targetSrv.files = (targetSrv.files || []).filter(function (f) { return (f.fileId || f.id) !== mapping.originalId; });
                                    } else if (mapping.type === 'log') {
                                        targetSrv.logs = (targetSrv.logs || []).filter(function (l) { return l.seq !== mapping.originalId; });
                                    }
                                    var remaining = (targetSrv.files || []).length + (targetSrv.logs || []).length;
                                    if (remaining === 0 && targetSrv.status === 'DOWNLOADED') {
                                        targetSrv.status = 'DONE';
                                    }
                                }
                                delete _desktopToServerMap[sid];
                            }
                            updateServersUI(_lastServersData);
                        }
                    });
                    if (sold > 0) {
                        log(market.name + ': sold ' + sold + '/' + items.length + ' item(s) ✓', 'success');
                    } else {
                        log(market.name + ': sell failed', 'error');
                    }
                    await delay(humanDelay());
                }
            }
        }

        log('=== Valuable Seller Complete ===', 'success');
        signalDone();
    }

    // ===== MESSAGE LISTENER =====
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;

        if (event.data && event.data.type === 'COR3_VALUABLE_START_SEARCH') {
            if (running) {
                log('Already running — ignoring start request', 'warn');
                return;
            }
            running = true;
            mode = 'search';
            runSearch().catch(function (err) {
                if (err.message !== 'Stopped') log('Search error: ' + err.message, 'error');
                signalDone();
            });
        }

        if (event.data && event.data.type === 'COR3_VALUABLE_START_SELLER') {
            if (running) {
                log('Already running — ignoring start request', 'warn');
                return;
            }
            running = true;
            mode = 'seller';
            var sServers = event.data.selectedServers || [];
            var sDownloads = event.data.selectedDownloads || [];
            runSeller(sServers, sDownloads).catch(function (err) {
                if (err.message !== 'Stopped') log('Seller error: ' + err.message, 'error');
                signalDone();
            });
        }

        if (event.data && event.data.type === 'COR3_VALUABLE_STOP') {
            if (running) {
                log('Stopping...', 'warn');
                running = false;
            }
        }
    });

    log('Auto Valuable Seller engine loaded', 'info');
})();
