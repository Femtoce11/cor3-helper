// Message listener: handles postMessage requests from content.js / popup
import { wsSend, wsSendRaw, leaveRoom } from './ws-send.js';
import { OrigWebSocket, trackedSockets, socketLastActivity, getActiveSocket, setActiveSocket } from './state.js';
import { findHackSoftwareForServerType, findBestSoftwareLoadout, getServerTypeName, hardwareMatches } from '../shared/loadout-resolver.js';

// Periodic socket health check: clean up dead sockets and detect stale connections
export function installSocketHealthCheck() {
    setInterval(function () {
        const now = Date.now();
        var activeSocket = getActiveSocket();
        // Clean up CLOSED sockets that weren't properly removed
        for (var i = trackedSockets.length - 1; i >= 0; i--) {
            var ws = trackedSockets[i];
            if (ws.readyState === OrigWebSocket.CLOSED || ws.readyState === OrigWebSocket.CLOSING) {
                console.log('[COR3 Helper] Cleaning up dead socket');
                trackedSockets.splice(i, 1);
                socketLastActivity.delete(ws);
                if (activeSocket === ws) setActiveSocket(null);
            }
        }
        // Warn if activeSocket hasn't received messages in 90s
        activeSocket = getActiveSocket();
        if (activeSocket) {
            var lastActivity = socketLastActivity.get(activeSocket) || 0;
            if (now - lastActivity > 90000) {
                console.log('[COR3 Helper] Active socket stale (no messages for 90s) — may need reconnect');
            }
        }
    }, 60000);
}

// Listen for requests from content script
export function installMessageListener() {
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'COR3_REQUEST_EXPEDITIONS') {
            window.__cor3RequestExpeditions();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_NETWORK_MAP') {
            window.__cor3AutoJobGetNetworkMap();
        }
        if (event.data && event.data.type === 'COR3_DEV_TC_TEST_REACHABILITY') {
            (function (serverId) {
                var logLines = [];
                function addLog(msg, color) {
                    logLines.push({ msg: msg, color: color || null });
                    window.postMessage({ type: 'COR3_DEV_TC_REACH_PROGRESS', log: logLines.slice() }, '*');
                }
                function sendResult(reachable, reason) {
                    window.__cor3DevTcReachActive = false;
                    window.postMessage({ type: 'COR3_DEV_TC_REACH_RESULT', reachable: reachable, reason: reason || null, log: logLines }, '*');
                }

                // Flag so WS handler forwards unreachable errors as COR3_WS_ENDPOINT_RESULT
                window.__cor3DevTcReachActive = true;

                var serverName = serverId;
                if (window.__cor3ServerTypeMap && window.__cor3ServerTypeMap[serverId]) {
                    serverName = window.__cor3ServerTypeMap[serverId].serverName || serverId;
                }

                // --- Helper: send set.endpoint and wait for result ---
                function sendSetEndpoint(targetId) {
                    return new Promise(function (resolve) {
                        var handled = false;
                        function onEpResult(evt) {
                            if (handled) return;
                            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                                handled = true;
                                clearTimeout(epTimer);
                                window.removeEventListener('message', onEpResult);
                                if (evt.data.success === false && evt.data.error) {
                                    var errMsg = evt.data.error.message || '';
                                    if (errMsg === 'no-path-to-server') {
                                        resolve({ ok: false, noPath: true, errorMsg: errMsg });
                                    } else if (errMsg === 'server-in-maintenance') {
                                        resolve({ ok: false, maintenance: true, errorMsg: errMsg });
                                    } else {
                                        resolve({ ok: false, errorMsg: errMsg || JSON.stringify(evt.data.error) });
                                    }
                                } else {
                                    resolve({ ok: true });
                                }
                            }
                        }
                        window.addEventListener('message', onEpResult);
                        var epTimer = setTimeout(function () {
                            if (!handled) {
                                handled = true;
                                window.removeEventListener('message', onEpResult);
                                resolve({ ok: true, timeout: true });
                            }
                        }, 10000);
                        window.__cor3AutoJobSetEndpoint(targetId);
                    });
                }

                // --- Helper: wait for a specific postMessage event with timeout ---
                function waitForDevTcMsg(eventType, timeoutMs) {
                    return new Promise(function (resolve, reject) {
                        var done = false;
                        var timer = setTimeout(function () {
                            if (!done) { done = true; window.removeEventListener('message', handler); reject(new Error('Timeout waiting for ' + eventType)); }
                        }, timeoutMs || 10000);
                        function handler(evt) {
                            if (done) return;
                            if (evt.data && evt.data.type === eventType) {
                                done = true;
                                clearTimeout(timer);
                                window.removeEventListener('message', handler);
                                resolve(evt.data);
                            }
                        }
                        window.addEventListener('message', handler);
                    });
                }

                // --- Helper: ensure hack-only loadout before hacking a server ---
                function ensureDevTcHackLoadout(targetId, targetName) {
                    return new Promise(function (resolve) {
                        var serverTypeName = getServerTypeName(targetId);
                        if (!serverTypeName) {
                            addLog('⚡ Loadout: cannot determine server type — skipping loadout');
                            resolve(true);
                            return;
                        }
                        addLog('⚡ Loadout: fetching data for ' + serverTypeName + '...');
                        window.__cor3AutoJobRequestLoadout();
                        waitForDevTcMsg('COR3_AUTOJOB_LOADOUT', 10000).then(function (resp) {
                            if (!resp || !resp.data) {
                                addLog('⚡ Loadout: no data — proceeding without loadout');
                                resolve(true);
                                return;
                            }
                            var loadout = resp.data;
                            var allSw = loadout.ownedSoftware || [];
                            var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
                            var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
                            if (hackCandidates.length === 0) {
                                addLog('⚡ Loadout: no hack software for ' + serverTypeName + ' — proceeding anyway');
                                resolve(true);
                                return;
                            }
                            var bestHack = findBestSoftwareLoadout(loadout, hackCandidates, 'HACK');
                            if (!bestHack) {
                                addLog('⚡ Loadout: no bootable hack software for ' + serverTypeName + ' — proceeding anyway');
                                resolve(true);
                                return;
                            }
                            addLog('⚡ Loadout: found ' + hackCandidates.length + ' hack candidate(s) for ' + serverTypeName + ' — best: ' + bestHack.sw.name + ' (power ' + bestHack.power + ')');
                            var targetSwIds = [bestHack.sw.id];
                            var currentHw = loadout.equippedHardware || {};
                            var alreadyBest = equippedSwIds.length === 1 && equippedSwIds[0] === bestHack.sw.id &&
                                hardwareMatches(currentHw, bestHack.hardware);
                            if (alreadyBest) {
                                addLog('⚡ Loadout: best hack software "' + bestHack.sw.name + '" already equipped');
                                resolve(true);
                                return;
                            }
                            addLog('⚡ Loadout: equipping hack software "' + bestHack.sw.name + '" for ' + serverTypeName);
                            applyDevTcLoadout(loadout, bestHack.hardware, targetSwIds).then(function () {
                                resolve(true);
                            });
                        }).catch(function () {
                            addLog('⚡ Loadout: fetch timed out — proceeding without loadout');
                            resolve(true);
                        });
                    });
                }

                // --- Helper: apply loadout changes (unequip/equip hardware+software) ---
                function applyDevTcLoadout(loadout, targetHw, targetSwIds) {
                    var currentHw = loadout.equippedHardware || {};
                    var currentSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
                    var steps = [];
                    for (var ui = 0; ui < currentSwIds.length; ui++) {
                        if (targetSwIds.indexOf(currentSwIds[ui]) < 0) {
                            steps.push({ action: 'unequip-sw', id: currentSwIds[ui] });
                        }
                    }
                    var hwSlots = ['cpu', 'gpu', 'ram', 'psu'];
                    for (var hi = 0; hi < hwSlots.length; hi++) {
                        var slot = hwSlots[hi];
                        var curId = currentHw[slot] ? currentHw[slot].id : null;
                        var tgtId = targetHw[slot] ? targetHw[slot].id : null;
                        if (tgtId && tgtId !== curId) {
                            steps.push({ action: 'equip-hw', id: tgtId });
                        }
                    }
                    for (var ei = 0; ei < targetSwIds.length; ei++) {
                        if (currentSwIds.indexOf(targetSwIds[ei]) < 0) {
                            steps.push({ action: 'equip-sw', id: targetSwIds[ei] });
                        }
                    }
                    var idx = 0;
                    function doStep() {
                        if (idx >= steps.length) return Promise.resolve();
                        var step = steps[idx++];
                        if (step.action === 'unequip-sw') {
                            window.__cor3AutoJobUnequipSoftware(step.id);
                        } else if (step.action === 'equip-hw') {
                            window.__cor3AutoJobEquipHardware(step.id);
                        } else if (step.action === 'equip-sw') {
                            window.__cor3AutoJobEquipSoftware(step.id);
                        }
                        return waitForDevTcMsg('COR3_AUTOJOB_LOADOUT', 8000).catch(function () {}).then(function () {
                            return new Promise(function (r) { setTimeout(r, 500); });
                        }).then(doStep);
                    }
                    return doStep();
                }

                // --- Helper: login to a server (use existing access or hack with loadout) ---
                function loginToServer(targetId, targetName) {
                    return new Promise(function (resolve) {
                        addLog('⚡ Checking login status for ' + targetName);
                        var loginHandled = false;
                        function onLoginStatus(evt) {
                            if (loginHandled) return;
                            if (evt.data && evt.data.type === 'COR3_AUTOJOB_SAI_LOGIN_STATUS') {
                                loginHandled = true;
                                clearTimeout(loginTimer);
                                window.removeEventListener('message', onLoginStatus);
                                if (evt.data.error) {
                                    resolve({ ok: false, error: 'Login status error: ' + (evt.data.error.message || JSON.stringify(evt.data.error)) });
                                    return;
                                }
                                var data = evt.data.data;
                                if (data && data.activeAccesses && data.activeAccesses.length > 0) {
                                    var access = data.activeAccesses[0];
                                    var accessType = access.accessType || access.type || 'unknown';
                                    addLog('⚡ Using existing ' + accessType + ' access on ' + targetName);
                                    window.__cor3AutoJobLoginWithAccess(targetId, access.id);
                                    var loginResultHandled = false;
                                    function onLoginResult(evt2) {
                                        if (loginResultHandled) return;
                                        if (evt2.data && evt2.data.type === 'COR3_AUTOJOB_SAI_LOGIN_RESULT') {
                                            loginResultHandled = true;
                                            clearTimeout(loginResultTimer);
                                            window.removeEventListener('message', onLoginResult);
                                            if (evt2.data.error || !(evt2.data.data && evt2.data.data.success)) {
                                                resolve({ ok: false, error: 'Login with access failed on ' + targetName });
                                            } else {
                                                addLog('⚡ Logged in to ' + targetName + ' (' + accessType + ')');
                                                resolve({ ok: true });
                                            }
                                        }
                                    }
                                    window.addEventListener('message', onLoginResult);
                                    var loginResultTimer = setTimeout(function () {
                                        if (!loginResultHandled) { loginResultHandled = true; window.removeEventListener('message', onLoginResult); resolve({ ok: false, error: 'Login with access timed out on ' + targetName }); }
                                    }, 10000);
                                } else {
                                    addLog('⚡ No active access on ' + targetName + ' — equipping hack loadout');
                                    ensureDevTcHackLoadout(targetId, targetName).then(function () {
                                        addLog('⚡ Starting hack on ' + targetName);
                                        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER' }, '*');
                                        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_ICE_WALL_SOLVER' }, '*');
                                        window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_SIMPLE_DECRYPT_SOLVER' }, '*');
                                        setTimeout(function () {
                                            startHackWithRetry(targetId, targetName, resolve, 0);
                                        }, 300);
                                    });
                                }
                            }
                        }
                        window.addEventListener('message', onLoginStatus);
                        var loginTimer = setTimeout(function () {
                            if (!loginHandled) { loginHandled = true; window.removeEventListener('message', onLoginStatus); resolve({ ok: false, error: 'Login status timed out on ' + targetName }); }
                        }, 10000);
                        window.__cor3AutoJobGetLoginStatus(targetId);
                    });
                }

                // --- Helper: start hack with loadout retry on sai-no-hack-software ---
                function startHackWithRetry(targetId, targetName, resolve, attempt) {
                    var MAX_HACK_ATTEMPTS = 3;
                    window.__cor3AutoJobHackStart(targetId);
                    var hackHandled = false;
                    function onHackEvent(evt3) {
                        if (hackHandled) return;
                        if (evt3.data && evt3.data.type === 'COR3_AUTOJOB_SAI_HACK_START') {
                            hackHandled = true;
                            clearTimeout(hackTimer);
                            window.removeEventListener('message', onHackEvent);
                            if (evt3.data.error) {
                                var errMsg = evt3.data.error.message || JSON.stringify(evt3.data.error);
                                if ((errMsg.indexOf('sai-no-hack-software') >= 0 || errMsg.indexOf('sai-hack-impossible') >= 0) && attempt < MAX_HACK_ATTEMPTS) {
                                    addLog('⚡ Hack error: ' + errMsg + ' — retrying with loadout swap (attempt ' + (attempt + 1) + '/' + MAX_HACK_ATTEMPTS + ')');
                                    ensureDevTcHackLoadout(targetId, targetName).then(function () {
                                        setTimeout(function () {
                                            startHackWithRetry(targetId, targetName, resolve, attempt + 1);
                                        }, 1000);
                                    });
                                    return;
                                }
                                resolve({ ok: false, error: 'Hack error on ' + targetName + ': ' + errMsg });
                                return;
                            }
                            if (evt3.data.data && evt3.data.data.autoHacked) {
                                addLog('⚡ Auto-hacked ' + targetName + ' (no minigame)');
                                pollAccessAfterHack(targetId, targetName, resolve);
                            } else {
                                addLog('⚡ Hack minigame started on ' + targetName + ' — waiting for solver...');
                                waitForHackComplete(targetId, targetName, resolve);
                            }
                        }
                        if (evt3.data && evt3.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                            hackHandled = true;
                            clearTimeout(hackTimer);
                            window.removeEventListener('message', onHackEvent);
                            addLog('⚡ Hack minigame started on ' + targetName + ' — waiting for solver...');
                            waitForHackComplete(targetId, targetName, resolve);
                        }
                        if (evt3.data && evt3.data.type === 'COR3_AUTOJOB_MINIGAME_LOCKED') {
                            hackHandled = true;
                            clearTimeout(hackTimer);
                            window.removeEventListener('message', onHackEvent);
                            resolve({ ok: false, error: 'Hack minigame locked on ' + targetName });
                        }
                    }
                    window.addEventListener('message', onHackEvent);
                    var hackTimer = setTimeout(function () {
                        if (!hackHandled) { hackHandled = true; window.removeEventListener('message', onHackEvent); resolve({ ok: false, error: 'Hack start timed out on ' + targetName }); }
                    }, 30000);
                }

                // --- Helper: wait for hack solver to complete, then poll for access ---
                function waitForHackComplete(targetId, targetName, resolve) {
                    var saiHandled = false;
                    function onSaiUpdate(evt) {
                        if (saiHandled) return;
                        if (evt.data && evt.data.type === 'COR3_AUTOJOB_SAI_UPDATE') {
                            saiHandled = true;
                            clearTimeout(saiTimer);
                            window.removeEventListener('message', onSaiUpdate);
                            addLog('⚡ Hack completed on ' + targetName);
                            pollAccessAfterHack(targetId, targetName, resolve);
                        }
                    }
                    window.addEventListener('message', onSaiUpdate);
                    var saiTimer = setTimeout(function () {
                        if (!saiHandled) {
                            saiHandled = true;
                            window.removeEventListener('message', onSaiUpdate);
                            addLog('⚡ Hack solver timeout on ' + targetName + ' — checking access anyway');
                            pollAccessAfterHack(targetId, targetName, resolve);
                        }
                    }, 120000);
                }

                // --- Helper: poll login status after hack to find access and login ---
                function pollAccessAfterHack(targetId, targetName, resolve) {
                    var pollCount = 0;
                    var MAX_POLLS = 5;
                    function doPoll() {
                        pollCount++;
                        var pollHandled = false;
                        function onPollStatus(evt) {
                            if (pollHandled) return;
                            if (evt.data && evt.data.type === 'COR3_AUTOJOB_SAI_LOGIN_STATUS') {
                                pollHandled = true;
                                clearTimeout(pollTimer);
                                window.removeEventListener('message', onPollStatus);
                                if (evt.data.data && evt.data.data.activeAccesses && evt.data.data.activeAccesses.length > 0) {
                                    var acc = evt.data.data.activeAccesses[0];
                                    var accType = acc.accessType || acc.type || 'unknown';
                                    addLog('⚡ Got ' + accType + ' access on ' + targetName + ' — logging in');
                                    window.__cor3AutoJobLoginWithAccess(targetId, acc.id);
                                    var lrHandled = false;
                                    function onLR(evt2) {
                                        if (lrHandled) return;
                                        if (evt2.data && evt2.data.type === 'COR3_AUTOJOB_SAI_LOGIN_RESULT') {
                                            lrHandled = true;
                                            clearTimeout(lrTimer);
                                            window.removeEventListener('message', onLR);
                                            resolve({ ok: true });
                                        }
                                    }
                                    window.addEventListener('message', onLR);
                                    var lrTimer = setTimeout(function () {
                                        if (!lrHandled) { lrHandled = true; window.removeEventListener('message', onLR); resolve({ ok: true }); }
                                    }, 10000);
                                } else {
                                    if (pollCount < MAX_POLLS) {
                                        addLog('⚡ No access yet after hack on ' + targetName + ' (poll ' + pollCount + '/' + MAX_POLLS + ')');
                                        setTimeout(doPoll, 3000);
                                    } else {
                                        resolve({ ok: false, error: 'No access granted after hack on ' + targetName });
                                    }
                                }
                            }
                        }
                        window.addEventListener('message', onPollStatus);
                        var pollTimer = setTimeout(function () {
                            if (!pollHandled) { pollHandled = true; window.removeEventListener('message', onPollStatus); resolve({ ok: false, error: 'Poll login status timed out on ' + targetName }); }
                        }, 8000);
                        window.__cor3AutoJobGetLoginStatus(targetId);
                    }
                    setTimeout(doPoll, 1500);
                }

                // --- Main flow ---
                addLog('Setting endpoint to ' + serverName + ' (' + serverId.substring(0, 8) + ')...');
                sendSetEndpoint(serverId).then(function (result) {
                    if (result.ok) {
                        if (result.timeout) {
                            addLog('Endpoint set (timeout — may already be set)');
                        } else {
                            addLog('Endpoint set successfully');
                        }
                        sendResult(true);
                        return;
                    }

                    // server-in-maintenance: the target itself is in maintenance — nothing to do
                    if (result.maintenance) {
                        addLog('Server ' + serverName + ' is in maintenance', 'var(--accent-orange)');
                        sendResult(false, 'server-in-maintenance');
                        return;
                    }

                    // no-path-to-server: need path-through hack
                    if (result.noPath) {
                        addLog('No direct path to ' + serverName + ' — attempting path-through hack...');

                        // Fetch map data for dynamic pathing
                        addLog('Fetching network map for path resolution...');
                        window.__cor3AutoJobGetNetworkMap();

                        var mapHandled = false;
                        function onMapData(evt) {
                            if (mapHandled) return;
                            if (evt.data && evt.data.type === 'COR3_WS_MAP_DATA' && evt.data.servers) {
                                mapHandled = true;
                                clearTimeout(mapTimer);
                                window.removeEventListener('message', onMapData);

                                try {
                                    var servers = evt.data.servers || [];
                                    var connections = evt.data.connections || [];
                                    var homeId = null;
                                    var serverLookup = {};
                                    var adjacency = {};

                                    for (var i = 0; i < servers.length; i++) {
                                        var s = servers[i];
                                        serverLookup[s.id] = s;
                                        adjacency[s.id] = [];
                                        if (s.serverTypeName === 'Home' || s.serverName === 'Home Server') {
                                            homeId = s.id;
                                        }
                                    }
                                    for (var j = 0; j < connections.length; j++) {
                                        var c = connections[j];
                                        if (adjacency[c.serverA] && adjacency[c.serverB]) {
                                            adjacency[c.serverA].push(c.serverB);
                                            adjacency[c.serverB].push(c.serverA);
                                        }
                                    }

                                    if (!homeId) {
                                        addLog('Could not find Home Server in map data', 'var(--accent-red)');
                                        sendResult(false, 'no-home-server-in-map');
                                        return;
                                    }

                                    // DFS to find all paths from home to target (skip maintenance intermediates)
                                    var allPaths = [];
                                    var visited = {};
                                    var now = Date.now();
                                    function dfs(currentId, path) {
                                        if (currentId === serverId) {
                                            allPaths.push(path.slice());
                                            return;
                                        }
                                        var neighbors = adjacency[currentId] || [];
                                        for (var ni = 0; ni < neighbors.length; ni++) {
                                            var nb = neighbors[ni];
                                            if (!visited[nb]) {
                                                // Skip intermediate servers in maintenance (target itself is allowed)
                                                if (nb !== serverId) {
                                                    var nbInfo = serverLookup[nb];
                                                    if (nbInfo && nbInfo.isInMaintenance) {
                                                        var mEnd = nbInfo.maintenanceEndsAt ? new Date(nbInfo.maintenanceEndsAt).getTime() - now : 0;
                                                        if (mEnd > 0) continue;
                                                    }
                                                }
                                                visited[nb] = true;
                                                var nbSrv = serverLookup[nb];
                                                path.push({ id: nb, name: nbSrv ? nbSrv.serverName : nb.substring(0, 8) });
                                                dfs(nb, path);
                                                path.pop();
                                                visited[nb] = false;
                                            }
                                        }
                                    }
                                    visited[homeId] = true;
                                    dfs(homeId, []);
                                    allPaths.sort(function (a, b) { return a.length - b.length; });

                                    if (allPaths.length === 0) {
                                        addLog('No viable paths from Home to ' + serverName + ' (all paths blocked by maintenance)', 'var(--accent-red)');
                                        sendResult(false, 'all-paths-blocked-by-maintenance');
                                        return;
                                    }

                                    addLog('Found ' + allPaths.length + ' viable path(s) to ' + serverName + ' (maintenance servers excluded)');

                                    // Try each path (intermediates only, exclude the target itself)
                                    var pathIdx = 0;
                                    function tryNextPath() {
                                        if (pathIdx >= allPaths.length) {
                                            addLog('All ' + allPaths.length + ' path(s) exhausted — server unreachable', 'var(--accent-red)');
                                            sendResult(false, 'all-paths-failed');
                                            return;
                                        }
                                        var currentPath = allPaths[pathIdx];
                                        pathIdx++;
                                        if (currentPath.length <= 1) {
                                            tryNextPath();
                                            return;
                                        }
                                        var intermediates = currentPath.slice(0, currentPath.length - 1);
                                        var pathNames = currentPath.map(function (s) { return s.name; }).join(' → ');
                                        addLog('⚡ Trying path ' + pathIdx + '/' + allPaths.length + ': ' + pathNames);

                                        var stepIdx = 0;
                                        function nextStep() {
                                            if (stepIdx >= intermediates.length) {
                                                // All intermediates done — retry endpoint to target
                                                addLog('⚡ Path-through complete — retrying endpoint to ' + serverName + '...');
                                                sendSetEndpoint(serverId).then(function (retryResult) {
                                                    if (retryResult.ok) {
                                                        addLog('Endpoint set successfully after path-through');
                                                        sendResult(true);
                                                    } else if (retryResult.maintenance) {
                                                        addLog('Server ' + serverName + ' is in maintenance', 'var(--accent-orange)');
                                                        sendResult(false, 'server-in-maintenance');
                                                    } else {
                                                        addLog('⚡ Still unreachable after path ' + pathIdx + ' — trying next path', 'var(--accent-orange)');
                                                        tryNextPath();
                                                    }
                                                });
                                                return;
                                            }
                                            var intermediate = intermediates[stepIdx];
                                            stepIdx++;
                                            addLog('⚡ Path step ' + stepIdx + '/' + intermediates.length + ': setting endpoint to ' + intermediate.name);
                                            sendSetEndpoint(intermediate.id).then(function (intResult) {
                                                if (intResult.ok || intResult.timeout) {
                                                    setTimeout(function () {
                                                        loginToServer(intermediate.id, intermediate.name).then(function (loginResult) {
                                                            if (loginResult.ok) {
                                                                setTimeout(nextStep, 1000);
                                                            } else {
                                                                addLog('⚡ Login/hack failed on ' + intermediate.name + ': ' + loginResult.error + ' — trying next path', 'var(--accent-orange)');
                                                                tryNextPath();
                                                            }
                                                        });
                                                    }, 1000);
                                                } else if (intResult.maintenance) {
                                                    addLog('⚡ ' + intermediate.name + ' is in maintenance — trying next path', 'var(--accent-orange)');
                                                    tryNextPath();
                                                } else {
                                                    addLog('⚡ ' + intermediate.name + ' unreachable — trying next path', 'var(--accent-orange)');
                                                    tryNextPath();
                                                }
                                            });
                                        }
                                        nextStep();
                                    }
                                    tryNextPath();

                                } catch (ex) {
                                    addLog('Path resolution error: ' + ex.message, 'var(--accent-red)');
                                    sendResult(false, 'path-resolution-error');
                                }
                            }
                        }
                        window.addEventListener('message', onMapData);
                        var mapTimer = setTimeout(function () {
                            if (!mapHandled) {
                                mapHandled = true;
                                window.removeEventListener('message', onMapData);
                                addLog('Timeout waiting for map data (12s)', 'var(--accent-red)');
                                sendResult(false, 'map-timeout');
                            }
                        }, 12000);
                        return;
                    }

                    // Other endpoint error
                    addLog('Endpoint error: ' + result.errorMsg);
                    sendResult(false, result.errorMsg);
                });
            })(event.data.serverId);
        }
        if (event.data && event.data.type === 'COR3_REQUEST_STASH') {
            window.__cor3RequestStash();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_SPECIALISTS') {
            window.__cor3RequestSpecialists();
        }
        if (event.data && event.data.type === 'COR3_PURCHASE_SPECIALIST') {
            window.__cor3PurchaseSpecialist(event.data.specialistType, event.data.kind, event.data.level, event.data.priceId);
        }
        if (event.data && event.data.type === 'COR3_REQUEST_LOADOUT') {
            window.__cor3RequestLoadout();
        }
        if (event.data && event.data.type === 'COR3_EQUIP_HARDWARE') {
            window.__cor3EquipHardware(event.data.moduleConfigId);
        }
        if (event.data && event.data.type === 'COR3_EQUIP_SOFTWARE') {
            window.__cor3EquipSoftware(event.data.moduleConfigId);
        }
        if (event.data && event.data.type === 'COR3_UNEQUIP_SOFTWARE') {
            window.__cor3UnequipSoftware(event.data.moduleConfigId);
        }
        if (event.data && event.data.type === 'COR3_REQUEST_MARKET') {
            window.__cor3RequestMarket();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_DARK_MARKET') {
            window.__cor3RequestDarkMarket();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_SOYUZ_MARKET') {
            window.__cor3RequestSoyuzMarket();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_USOL_MARKET') {
            window.__cor3RequestUsolMarket();
        }
        if (event.data && event.data.type === 'COR3_REFRESH_MARKET') {
            window.__cor3RefreshMarket();
        }
        if (event.data && event.data.type === 'COR3_REFRESH_DARK_MARKET') {
            window.__cor3RefreshDarkMarket();
        }
        if (event.data && event.data.type === 'COR3_REFRESH_SOYUZ_MARKET') {
            window.__cor3RefreshSoyuzMarket();
        }
        if (event.data && event.data.type === 'COR3_REFRESH_USOL_MARKET') {
            window.__cor3RefreshUsolMarket();
        }
        if (event.data && event.data.type === 'COR3_REFRESH_ALL_MARKETS_SEQ') {
            var opts = {};
            if (event.data.skipLots) opts.skipLots = true;
            if (event.data.order) opts.order = event.data.order;
            window.__cor3RefreshAllMarketsSequential(null, opts);
        }
        if (event.data && event.data.type === 'COR3_LEAVE_STASH') {
            leaveRoom('stash');
        }
        if (event.data && event.data.type === 'COR3_SELL_ITEM') {
            window.__cor3SellItem(event.data.itemId, event.data.quantity || 1, event.data.skipStashRefresh);
        }
        // Decision response from popup
        if (event.data && event.data.type === 'COR3_RESPOND_DECISION') {
            window.__cor3RespondDecision(event.data.expeditionId, event.data.messageId, event.data.selectedOption);
        }
        // Archived expeditions request
        if (event.data && event.data.type === 'COR3_REQUEST_ARCHIVED_EXPEDITIONS') {
            window.__cor3RequestArchivedExpeditions();
        }
        // Mercenary requests
        if (event.data && event.data.type === 'COR3_REQUEST_MERCENARIES') {
            window.__cor3RequestMercenaries(null, function () {
                window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
            });
        }
        if (event.data && event.data.type === 'COR3_REQUEST_USOL_MERCENARIES') {
            window.__cor3RequestUsolMercenaries(function () {
                window.postMessage({ type: 'COR3_USOL_MERCS_DONE' }, '*');
            });
        }
        if (event.data && event.data.type === 'COR3_REQUEST_EXPEDITION_CONFIG') {
            window.__cor3RequestExpeditionConfig();
        }
        if (event.data && event.data.type === 'COR3_LAUNCH_EXPEDITION') {
            // Store launch data for potential retry
            window.__cor3LaunchExpedition(event.data.config);
        }
        if (event.data && event.data.type === 'COR3_RELAUNCH_EXPEDITION') {
            console.log('[COR3 Helper] Relaunching expedition with stored data');
            window.__cor3LaunchExpedition(event.data.data);
        }
        if (event.data && event.data.type === 'COR3_OPEN_CONTAINER') {
            window.__cor3OpenContainer(event.data.expeditionId);
        }
        if (event.data && event.data.type === 'COR3_COLLECT_ALL') {
            window.__cor3CollectAll(event.data.expeditionId);
        }
        if (event.data && event.data.type === 'COR3_STOP_DECRYPT_SOLVER') {
            window.__solverAbort = true;
        }
        if (event.data && event.data.type === 'COR3_STOP_DAILY_HACK') {
            window.__dailyHackAbort = true;
            window.__dailyHackActive = false;
        }
        if (event.data && event.data.type === 'COR3_START_DECRYPT_SOLVER') {
            // If solver is already running, do nothing
            if (window.__solverActive && !window.__solverAbort) return;
            // If solver was stopped, reset flags and re-inject will handle it
            window.__solverAbort = false;
            window.__solverActive = false;
        }
        if (event.data && event.data.type === 'COR3_STOP_ICE_WALL_SOLVER') {
            window.__iceWallSolverAbort = true;
        }
        if (event.data && event.data.type === 'COR3_START_ICE_WALL_SOLVER') {
            if (window.__iceWallSolverActive && !window.__iceWallSolverAbort) return;
            window.__iceWallSolverAbort = false;
            window.__iceWallSolverActive = false;
        }
        if (event.data && event.data.type === 'COR3_KEEP_ALIVE') {
            window.__cor3KeepAlive();
        }
        // --- Auto Job Solver commands from content.js ---
        if (event.data && event.data.type === 'COR3_AUTOJOB_CMD') {
            var cmd = event.data.cmd;
            var d = event.data.data || {};
            if (cmd === 'job.take') window.__cor3AutoJobTake(d.marketId, d.jobId);
            else if (cmd === 'job.complete') window.__cor3AutoJobComplete(d.marketId, d.jobId);
            else if (cmd === 'job.dismiss') window.__cor3AutoJobDismiss(d.marketId, d.jobId);
            else if (cmd === 'get.jobs') window.__cor3AutoJobGetMarketOptions(d.marketId);
            else if (cmd === 'get.options') window.__cor3AutoJobGetMarketOptions(d.marketId); // legacy fallback
            else if (cmd === 'set.endpoint') window.__cor3AutoJobSetEndpoint(d.serverId);
            else if (cmd === 'get.login.status') window.__cor3AutoJobGetLoginStatus(d.serverId);
            else if (cmd === 'login.with-access') window.__cor3AutoJobLoginWithAccess(d.serverId, d.accessGrantId);
            else if (cmd === 'hack.start') window.__cor3AutoJobHackStart(d.serverId);
            else if (cmd === 'get.files') window.__cor3AutoJobGetFiles(d.serverId);
            else if (cmd === 'file.download') window.__cor3AutoJobFileDownload(d.serverId, d.fileId);
            else if (cmd === 'get.logs') window.__cor3AutoJobGetLogs(d.serverId);
            else if (cmd === 'log.delete') window.__cor3AutoJobLogDelete(d.serverId, d.seq);
            else if (cmd === 'log.download') window.__cor3AutoJobLogDownload(d.serverId, d.seq);
            else if (cmd === 'get.transit') window.__cor3AutoJobGetTransit(d.serverId);
            else if (cmd === 'transit.add') window.__cor3AutoJobTransitAdd(d.serverId, d.ip, d.description);
            else if (cmd === 'open.folder') window.__cor3AutoJobOpenFolder(d.folderId);
            else if (cmd === 'decrypt.file') window.__cor3AutoJobDecryptFile(d.fileId);
            else if (cmd === 'get.map') window.__cor3AutoJobGetNetworkMap();
            else if (cmd === 'desktop.get.options') window.__cor3AutoJobGetDesktopOptions();
            else if (cmd === 'file.delete') window.__cor3AutoJobFileDelete(d.serverId, d.fileId);
            else if (cmd === 'file.upload') window.__cor3AutoJobFileUpload(d.serverId, d.name, d.sizeMb);
            else if (cmd === 'transit.remove') window.__cor3AutoJobTransitRemove(d.serverId, d.ip);
            else if (cmd === 'get.file.analysis') window.__cor3AutoJobGetFileAnalysis(d.fileId);
            else if (cmd === 'loadout.get') window.__cor3AutoJobRequestLoadout();
            else if (cmd === 'loadout.equip.hardware') window.__cor3AutoJobEquipHardware(d.moduleConfigId);
            else if (cmd === 'loadout.equip.software') window.__cor3AutoJobEquipSoftware(d.moduleConfigId);
            else if (cmd === 'loadout.unequip.software') window.__cor3AutoJobUnequipSoftware(d.moduleConfigId);
            // Auto Valuable Seller commands
            else if (cmd === 'file.search-valuable') window.__cor3ValuableFileSearch(d.serverId);
            else if (cmd === 'log.search-valuable') window.__cor3ValuableLogSearch(d.serverId);
            else if (cmd === 'get.sellable-items') window.__cor3ValuableGetSellableItems(d.marketId);
            else if (cmd === 'sell.items') window.__cor3ValuableSellItems(d.marketId, d.items);
        }
        // --- Secret Connection/Server Finder ---
        if (event.data && event.data.type === 'COR3_IP_SEARCH_START') {
            (function runSecretFinder() {
                var DELAY_MS = 2500;
                var HARD_TIMEOUT_MS = 180000; // 3 minutes hard timeout
                var aborted = false;
                var getMapMsg = '42["event",{"event":{"name":"network-map","action":"get.map"},"data":{}}]';

                function logMsg(html) {
                    window.postMessage({ type: 'COR3_IP_SEARCH_LOG', html: html }, '*');
                }
                function doneMsg(html) {
                    window.postMessage({ type: 'COR3_IP_SEARCH_DONE', html: html }, '*');
                }

                var hardTimer = setTimeout(function () {
                    if (!aborted) {
                        aborted = true;
                        doneMsg('<span style="color:var(--accent-orange);">⏱️ Search timed out after 3 minutes — auto-disabled</span>');
                    }
                }, HARD_TIMEOUT_MS);

                function waitForMap(timeout) {
                    return new Promise(function (resolve) {
                        var done = false;
                        function onMsg(evt) {
                            if (done) return;
                            if (evt.data && evt.data.type === 'COR3_WS_MAP_DATA') {
                                done = true;
                                window.removeEventListener('message', onMsg);
                                clearTimeout(timer);
                                resolve(evt.data);
                            }
                        }
                        window.addEventListener('message', onMsg);
                        var timer = setTimeout(function () {
                            if (!done) { done = true; window.removeEventListener('message', onMsg); resolve(null); }
                        }, timeout || 10000);
                    });
                }

                function connectIp(ip) {
                    wsSend('42["event",{"event":{"name":"network-map","action":"connect.ip"},"data":{"ipAddress":"' + ip + '"}}]');
                }

                logMsg('<span style="color:var(--accent-cyan);">Fetching network map...</span>');
                wsSend(getMapMsg);
                waitForMap(10000).then(function (mapData1) {
                    if (aborted) return;
                    if (!mapData1 || !mapData1.servers || !mapData1.connections) {
                        clearTimeout(hardTimer);
                        doneMsg('<span style="color:var(--accent-red);">Failed to fetch initial map data</span>');
                        return;
                    }
                    var oldConnections = new Set(mapData1.connections.map(function (c) { return c.id; }));
                    var oldServerIds = new Set(mapData1.servers.map(function (s) { return s.id; }));
                    var serverIps = mapData1.servers.map(function (s) { return s.serverIp; }).filter(Boolean);
                    var serverNameMap = {};
                    mapData1.servers.forEach(function (s) { serverNameMap[s.id] = s.serverName; });
                    var total = serverIps.length;
                    var idx = 0;

                    logMsg('<span style="color:var(--accent-cyan);">Found ' + total + ' IPs to scan. Starting...</span>');

                    function connectNext() {
                        if (aborted) return;
                        if (idx >= total) {
                            logMsg('<span style="color:var(--accent-cyan);">Scanning complete. Fetching updated map...</span>');
                            setTimeout(function () {
                                if (aborted) return;
                                wsSend(getMapMsg);
                                waitForMap(10000).then(function (mapData2) {
                                    clearTimeout(hardTimer);
                                    if (aborted) return;
                                    if (!mapData2 || !mapData2.connections) {
                                        doneMsg('<span style="color:var(--accent-red);">Failed to fetch updated map data</span>');
                                        return;
                                    }
                                    if (mapData2.servers) {
                                        mapData2.servers.forEach(function (s) { serverNameMap[s.id] = s.serverName; });
                                    }
                                    var newConns = mapData2.connections.filter(function (c) { return !oldConnections.has(c.id); });
                                    var newServers = (mapData2.servers || []).filter(function (s) { return !oldServerIds.has(s.id); });
                                    var parts = [];
                                    if (newConns.length > 0) {
                                        parts.push('<div style="color:var(--accent-green);font-weight:bold;">Found ' + newConns.length + ' new connection(s):</div>');
                                        newConns.forEach(function (c) {
                                            var a = serverNameMap[c.serverA] || c.serverA;
                                            var b = serverNameMap[c.serverB] || c.serverB;
                                            parts.push('<div style="padding:1px 0;margin-left:8px;color:var(--accent-cyan);">' + a + ' ↔ ' + b + (c.isHidden ? ' <span style="color:var(--accent-orange);">(hidden)</span>' : '') + '</div>');
                                        });
                                    }
                                    if (newServers.length > 0) {
                                        parts.push('<div style="color:var(--accent-green);font-weight:bold;margin-top:4px;">Found ' + newServers.length + ' new server(s):</div>');
                                        newServers.forEach(function (s) {
                                            parts.push('<div style="padding:1px 0;margin-left:8px;color:var(--accent-cyan);">🖥️ ' + (s.serverName || s.id) + '</div>');
                                        });
                                    }
                                    if (newConns.length === 0 && newServers.length === 0) {
                                        parts.push('<span style="color:var(--accent-orange);">Couldn\'t find anything new... (' + total + ' IPs scanned)</span>');
                                    } else {
                                        parts.push('<div style="margin-top:4px;color:var(--text-dim);">Scanned ' + total + ' IPs</div>');
                                    }
                                    doneMsg(parts.join(''));
                                });
                            }, 3000);
                            return;
                        }
                        var ip = serverIps[idx];
                        idx++;
                        logMsg('<span style="color:var(--accent-cyan);">Connecting ' + idx + '/' + total + ': ' + ip + '</span>');
                        connectIp(ip);
                        setTimeout(connectNext, DELAY_MS);
                    }
                    connectNext();
                });
            })();
        }
        // --- Anti-AFK Clicker ---
        if (event.data && event.data.type === 'COR3_ANTI_AFK_TOGGLE') {
            if (event.data.enabled) {
                if (!window.__cor3AntiAfkTimer) {
                    var ANTI_AFK_INTERVAL = 3 * 60 * 1000;
                    function antiAfkClick() {
                        var target = document.querySelector('div[data-component-name="DesktopWrapperBorder"]');
                        if (!target) return;
                        var rect = target.getBoundingClientRect();
                        var cx = Math.floor(rect.left + rect.width / 2);
                        var cy = Math.floor(rect.top + rect.height / 2);
                        var opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
                        target.dispatchEvent(new MouseEvent('mouseenter', opts));
                        target.dispatchEvent(new MouseEvent('mousemove', opts));
                        target.dispatchEvent(new MouseEvent('click', opts));
                        target.dispatchEvent(new MouseEvent('mouseleave', opts));
                    }
                    antiAfkClick();
                    window.__cor3AntiAfkTimer = setInterval(antiAfkClick, ANTI_AFK_INTERVAL);
                    console.log('[COR3 Helper] Anti-AFK Clicker enabled (3 min interval)');
                }
            } else {
                if (window.__cor3AntiAfkTimer) {
                    clearInterval(window.__cor3AntiAfkTimer);
                    window.__cor3AntiAfkTimer = null;
                    console.log('[COR3 Helper] Anti-AFK Clicker disabled');
                }
            }
        }
        // --- DevTools panel: send raw WS message ---
        if (event.data && event.data.type === 'COR3_DEVTOOLS_WS_SEND') {
            var msg = event.data.message;
            if (msg && typeof msg === 'string') {
                wsSendRaw(msg);
            }
        }
    });
}

// Re-post version data after content.js is loaded (document_idle).
// The initial postMessage calls may fire before content.js listener is ready.
export function scheduleVersionRepost() {
    function repostVersions() {
        if (window.__cor3WebVersion) {
            window.postMessage({ type: 'COR3_WEB_VERSION', version: window.__cor3WebVersion }, '*');
        }
        if (window.__cor3SystemVersion) {
            window.postMessage({ type: 'COR3_SYSTEM_VERSION', version: window.__cor3SystemVersion }, '*');
        }
        if (window.__cor3PatchVersion) {
            window.postMessage({ type: 'COR3_PATCH_VERSION', version: window.__cor3PatchVersion }, '*');
        }
    }
    // Delay enough for content.js (document_idle) to be listening
    setTimeout(repostVersions, 3000);
    setTimeout(repostVersions, 8000);
}
