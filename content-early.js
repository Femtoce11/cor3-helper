// content-early.js
// Runs in MAIN world at document_start — before the page creates any WebSocket.
// Hooks WebSocket to intercept cor3/corie messages and relays decisions via postMessage.
var webVersion = null;

(function () {
    if (window.__cor3WsInterceptorActive) return;
    window.__cor3WsInterceptorActive = true;

    const OrigWebSocket = window.WebSocket;
    const trackedSockets = [];
    let activeSocket = null; // The socket that's currently receiving messages
    const socketLastActivity = new Map(); // Track last message time per socket

    // --- Intercept Bearer token from outgoing fetch/XHR requests ---
    let capturedBearerToken = null;

    // --- Token-expired handling ---
    let pendingRetryOps = []; // operations to retry when new socket opens
    let tokenExpiredFlag = false;

    // Market refresh abort mechanism: each refresh captures the current abortId.
    // On token-expired, the ID increments, causing all in-flight refreshes to abort.
    var __cor3MarketRefreshAbortId = 0;

    // Shared unreachable-market cache: keyed by market type ('usol', 'soyuz', 'dark').
    // Each entry: { blockerName, maintenanceEndsAt (ISO string or null), detectedAt (ms timestamp) }
    // Other sections check this before starting a path-through to avoid redundant hacking.
    window.__cor3UnreachableMarkets = {};

    // Check if a market is still known-unreachable (maintenance not yet expired)
    window.__cor3IsMarketUnreachable = function (marketType) {
        var entry = window.__cor3UnreachableMarkets[marketType];
        if (!entry) return null;
        if (entry.maintenanceEndsAt) {
            var endsAt = new Date(entry.maintenanceEndsAt).getTime();
            if (Date.now() >= endsAt) {
                delete window.__cor3UnreachableMarkets[marketType];
                return null;
            }
        }
        return entry;
    };

    // Flag: initial data fetch is currently in progress (markets + mercs + stash + loadout)
    window.__cor3InitialFetchInProgress = false;

    function queueRetryOp(opName) {
        if (!pendingRetryOps.includes(opName)) {
            pendingRetryOps.push(opName);
        }
    }

    function runPendingRetries() {
        if (pendingRetryOps.length === 0) return;
        console.log('[COR3 Helper] Retrying pending operations:', pendingRetryOps.join(', '));
        var ops = pendingRetryOps.slice();
        pendingRetryOps = [];
        tokenExpiredFlag = false;
        ops.forEach(function (op) {
            setTimeout(function () {
                if (op === 'expeditions') window.__cor3RequestExpeditions();
                else if (op === 'stash') window.__cor3RequestStash();
                else if (op === 'dailyOps') window.postMessage({ type: 'COR3_FETCH_DAILY_OPS' }, '*');
                else if (op.startsWith('decision:')) {
                    var payload = op.substring(9);
                    try {
                        var data = JSON.parse(payload);
                        window.__cor3RespondDecision(data.expeditionId, data.messageId, data.selectedOption);
                    } catch (e) { /* silent */ }
                }
            }, humanDelay());
        });
    }

    const OrigFetch = window.fetch;
    window.fetch = function () {
        const args = arguments;
        const input = args[0];
        const init = args[1];
        try {
            const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            // Intercept translation.json for webVersion
            if (url.includes('translation.json')) { // url = /locales/tr/translation.json?v=v1.17.21
                try {
                    const parsedUrl = new URL(url, window.location.origin);
                    if (!webVersion) {
                        webVersion = parsedUrl.searchParams.get('v');
                    }
                    console.log('[COR3 Helper] Captured web version from translation.json:', webVersion);
                    window.__cor3WebVersion = webVersion;
                    setTimeout(function () {
                        window.postMessage({ type: 'COR3_WEB_VERSION', version: webVersion }, '*');
                    }, 250);
                } catch (e) {
                    console.log('[COR3 Helper] Error parsing version:', e);
                }
            }
        } catch (e) { /* silent */ }

        // Intercept users/me response for systemVersion
        var result = OrigFetch.apply(this, args);
        try {
            var fetchUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            // Intercept Socket.IO polling responses via fetch
            if (fetchUrl.includes('socket.io') && fetchUrl.includes('transport=polling')) {
                result.then(function (resp) {
                    if (resp && resp.ok) {
                        resp.clone().text().then(function (text) {
                            parsePollingForDesktopOptions(text);
                        }).catch(function () {});
                    }
                }).catch(function () {});
            }
            if (fetchUrl.includes('api/users/me')) {
                result.then(function (resp) {
                    if (resp && resp.ok) {
                        resp.clone().json().then(function (data) {
                            if (data && data.systemVersion !== undefined) {
                                console.log('[COR3 Helper] Captured system version from api/users/me:', data.systemVersion);
                                window.__cor3SystemVersion = data.systemVersion;
                                window.postMessage({ type: 'COR3_SYSTEM_VERSION', version: data.systemVersion }, '*');
                            }
                        }).catch(function () {});
                    }
                }).catch(function () {});
            }
            // Intercept daily-claim/rewards response
            if (fetchUrl.includes('api/user-daily-claim/rewards')) {
                result.then(function (resp) {
                    if (resp && resp.ok) {
                        resp.clone().json().then(function (data) {
                            if (Array.isArray(data)) {
                                window.postMessage({ type: 'COR3_DAILY_REWARDS', rewards: data }, '*');
                            }
                        }).catch(function () {});
                    }
                }).catch(function () {});
            }
        } catch (e) { /* silent */ }

        return result;
    };

    // --- Helper: Parse Socket.IO polling response for desktop.get.options ---
    // Socket.IO polling responses can contain multiple messages concatenated.
    // Each message is prefixed with its byte length, e.g. "123:42[...]456:42[...]"
    // Or sometimes just a single "42[...]" message.
    function parsePollingForDesktopOptions(responseText) {
        if (!responseText || typeof responseText !== 'string') return;
        // Find all 42["desktop",...] messages in the response
        var startIdx = 0;
        while (startIdx < responseText.length) {
            var msgStart = responseText.indexOf('42["desktop"', startIdx);
            if (msgStart === -1) break;
            // Try to parse from this position
            var jsonStart = msgStart + 2; // skip "42"
            try {
                // Find the matching closing bracket — use a simple approach
                var bracketDepth = 0;
                var inString = false;
                var escape = false;
                var end = -1;
                for (var ci = jsonStart; ci < responseText.length; ci++) {
                    var ch = responseText[ci];
                    if (escape) { escape = false; continue; }
                    if (ch === '\\' && inString) { escape = true; continue; }
                    if (ch === '"') { inString = !inString; continue; }
                    if (inString) continue;
                    if (ch === '[' || ch === '{') bracketDepth++;
                    else if (ch === ']' || ch === '}') {
                        bracketDepth--;
                        if (bracketDepth === 0) { end = ci + 1; break; }
                    }
                }
                if (end > jsonStart) {
                    var jsonStr = responseText.substring(jsonStart, end);
                    var parsed = JSON.parse(jsonStr);
                    if (Array.isArray(parsed) && parsed[0] === 'desktop' && parsed[1]) {
                        var payload = parsed[1];
                        if (payload.event && payload.event.action === 'get.options' && payload.data) {
                            console.log('[COR3 Helper] Desktop get.options found in polling response — folders:', payload.data.folders ? payload.data.folders.length : 0);
                            // Cache Downloads folder ID
                            if (payload.data.folders) {
                                var dlf = payload.data.folders.find(function (f) { return f.name === 'Downloads'; });
                                if (dlf) {
                                    window.__cor3DownloadFolderId = dlf.id;
                                    console.log('[COR3 Helper] Cached Downloads folder ID from polling:', dlf.id);
                                }
                            }
                            // Also relay as postMessage so auto-job-solver can pick it up
                            window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_OPTIONS', data: payload.data, error: payload.error || null }, '*');
                        }
                        // Also handle update.file from polling
                        if (payload.event && (payload.event.action === 'update.file' || payload.event.action === 'open.file' || payload.event.action === 'decrypt.file') && (payload.data || payload.error)) {
                            var pollFileError = payload.error || null;
                            if (!pollFileError && payload.data && payload.data.kind === 'insufficient_power') {
                                pollFileError = { message: 'insufficient_power', kind: 'insufficient_power', ability: payload.data.ability, required: payload.data.required, available: payload.data.available };
                            }
                            window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_FILE', data: payload.data || null, error: pollFileError }, '*');
                            if (payload.event.action === 'update.file') {
                                window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_UPDATE_FILE', data: payload.data || null, error: payload.error || null }, '*');
                            }
                        }
                    }
                }
            } catch (e) { /* parse error — skip */ }
            startIdx = msgStart + 1;
        }
    }

    const OrigXHROpen = XMLHttpRequest.prototype.open;
    const OrigXHRSend = XMLHttpRequest.prototype.send;
    const OrigXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function () {
        this.__cor3Url = arguments[1] || '';
        return OrigXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if ((name === 'Authorization' || name === 'authorization') &&
            value && value.startsWith('Bearer ') &&
            (this.__cor3Url && (this.__cor3Url.includes('cor3') || this.__cor3Url.includes('corie')))) {
            capturedBearerToken = value;
            window.postMessage({ type: 'COR3_BEARER_TOKEN', token: value }, '*');
        }
        return OrigXHRSetHeader.apply(this, arguments);
    };
    // Intercept XHR responses from Socket.IO polling transport
    XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (xhr.__cor3Url && xhr.__cor3Url.includes('socket.io') && xhr.__cor3Url.includes('transport=polling')) {
            xhr.addEventListener('load', function () {
                try {
                    if (xhr.responseText) {
                        parsePollingForDesktopOptions(xhr.responseText);
                    }
                } catch (e) { /* silent */ }
            });
        }
        return OrigXHRSend.apply(this, arguments);
    };

    // Use a Proxy so both `new WebSocket(...)` and instanceof checks work correctly
    const WebSocketProxy = new Proxy(OrigWebSocket, {
        construct(target, args) {
            const ws = new target(...args);
            const url = args[0] || '';

            // Minigame sockets (ice-wall-break, etc.) should NOT be tracked as the
            // active game socket — they handle their own WS protocol and would
            // interfere with command sending if promoted to activeSocket.
            var isMinigameSocket = url.includes('ice-wall-break') || url.includes('minigame') || url.includes('hack') || url.includes('games');
            ws.__cor3IsMinigame = isMinigameSocket;

            if (url.includes('cor3') || url.includes('corie')) {
                console.log('[COR3 Helper] Tracking WebSocket:', url, isMinigameSocket ? '(minigame — excluded from active tracking)' : '');
                ws.__cor3Url = url;
                if (!isMinigameSocket) {
                    trackedSockets.push(ws);
                }

                // Intercept ALL send() calls on this socket to log user-triggered messages
                var origSend = ws.send.bind(ws);
                ws.send = function (data) {
                    try {
                        if (typeof data === 'string') {
                            if (data.indexOf('40{') === 0) {
                                try {
                                    var connectPayload = JSON.parse(data.substring(2));
                                    if (connectPayload.token && connectPayload.token.startsWith('Bearer ')) {
                                        capturedBearerToken = connectPayload.token;
                                        window.postMessage({ type: 'COR3_BEARER_TOKEN', token: connectPayload.token }, '*');
                                    }
                                } catch (e) { /* silent */ }
                            }
                            window.postMessage({ type: 'COR3_WS_LOG', direction: 'sent', message: data }, '*');
                        } else if (data instanceof ArrayBuffer || (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(data))) {
                            decodeBinaryMsg(data, function (str) {
                                if (str) {
                                    window.postMessage({ type: 'COR3_WS_LOG', direction: 'sent', message: str }, '*');
                                    // Capture token from binary 40{...} connect messages
                                    if (str.indexOf('40{') === 0) {
                                        try {
                                            var cp = JSON.parse(str.substring(2));
                                            if (cp.token && cp.token.startsWith('Bearer ')) {
                                                capturedBearerToken = cp.token;
                                                window.postMessage({ type: 'COR3_BEARER_TOKEN', token: cp.token }, '*');
                                            }
                                        } catch (e) { /* silent */ }
                                    }
                                }
                            });
                        } else if (data instanceof Blob) {
                            decodeBinaryMsg(data, function (str) {
                                if (str) {
                                    window.postMessage({ type: 'COR3_WS_LOG', direction: 'sent', message: str }, '*');
                                    // Capture token from binary 40{...} connect messages
                                    if (str.indexOf('40{') === 0) {
                                        try {
                                            var cp = JSON.parse(str.substring(2));
                                            if (cp.token && cp.token.startsWith('Bearer ')) {
                                                capturedBearerToken = cp.token;
                                                window.postMessage({ type: 'COR3_BEARER_TOKEN', token: cp.token }, '*');
                                            }
                                        } catch (e) { /* silent */ }
                                    }
                                }
                            });
                        }
                    } catch (e) { /* silent */ }
                    return origSend(data);
                };

                ws.addEventListener('message', function (event) {
                    try {
                        if (!isMinigameSocket) {
                            if (activeSocket !== ws) {
                                console.log('[COR3 Helper] Active socket changed to:', ws.__cor3Url);
                                activeSocket = ws;
                            }
                            socketLastActivity.set(ws, Date.now());
                        }
                        var raw = event.data;
                        if (raw instanceof ArrayBuffer || raw instanceof Blob || (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(raw) && !(raw instanceof DataView))) {
                            decodeBinaryMsg(raw, function (str) {
                                if (str) handleWsMessage(str, ws);
                            });
                        } else {
                            handleWsMessage(raw, ws);
                        }
                    } catch (e) {
                        // silent
                    }
                });

                // Auto-fetch all data when WS connects (page load/reload)
                ws.addEventListener('open', function () {
                    console.log('[COR3 Helper] WS connected — scheduling initial data fetch');
                    // Wait for connection to stabilize, then fetch all data
                    setTimeout(function () {
                        // Clear pending retry ops — initial fetch covers expeditions, stash, dailyOps
                        if (tokenExpiredFlag || pendingRetryOps.length > 0) {
                            console.log('[COR3 Helper] Clearing pending retries (initial fetch will cover them):', pendingRetryOps.join(', '));
                            pendingRetryOps = [];
                            tokenExpiredFlag = false;
                        }
                        window.__cor3InitialFetch && window.__cor3InitialFetch();
                    }, 3000);
                });

                // Clean up closed sockets
                ws.addEventListener('close', function () {
                    console.log('[COR3 Helper] WS closed');
                    const idx = trackedSockets.indexOf(ws);
                    if (idx !== -1) trackedSockets.splice(idx, 1);
                    socketLastActivity.delete(ws);
                    if (activeSocket === ws) activeSocket = null;
                    // Notify ICE Wall solver when its minigame WS closes
                    if (ws.__cor3IsMinigame && ws.__cor3Url && ws.__cor3Url.indexOf('ice-wall-break') !== -1) {
                        window.postMessage({ type: 'COR3_ICE_WALL_GAME_ENDED' }, '*');
                    }
                });
            }

            return ws;
        },
        get(target, prop, receiver) {
            return Reflect.get(target, prop, receiver);
        }
    });

    // Preserve static properties and prototype
    Object.defineProperty(WebSocketProxy, 'prototype', {
        value: OrigWebSocket.prototype,
        writable: false,
        configurable: false
    });

    window.WebSocket = WebSocketProxy;

    function decodeBinaryMsg(raw, cb) {
        var codec = window.__cor3MsgpackCodec;
        if (!codec) { cb(null); return; }
        if (raw instanceof Blob) {
            raw.arrayBuffer().then(function (buf) {
                try {
                    var pkt = codec.decode(new Uint8Array(buf));
                    cb(codec.packetToString(pkt));
                } catch (e) { cb(null); }
            }).catch(function () { cb(null); });
            return;
        }
        try {
            var u8 = (raw instanceof ArrayBuffer) ? new Uint8Array(raw) : raw;
            var pkt = codec.decode(u8);
            cb(codec.packetToString(pkt));
        } catch (e) { cb(null); }
    }

    function handleWsMessage(rawData, socket) {
        if (typeof rawData !== 'string') return;

        // Log ALL inbound WS messages to content.js for storage (not just 42-prefixed)
        window.postMessage({ type: 'COR3_WS_LOG', direction: 'received', message: rawData }, '*');

        // Socket.IO v4 messages start with "42[" for event frames
        if (!rawData.startsWith('42')) return;

        const jsonStr = rawData.substring(2);
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            return;
        }

        if (!Array.isArray(parsed) || parsed.length < 2) return;

        const eventName = parsed[0];
        const payload = parsed[1];

        // Handle token-expired error — close sockets to force game to reconnect with fresh token
        if (eventName === 'error' && payload && payload.message === 'token-expired') {
            console.log('[COR3 Helper] Token expired detected — closing sockets to force reconnect');
            tokenExpiredFlag = true;
            // Abort all in-flight market refreshes by bumping the abort ID
            __cor3MarketRefreshAbortId++;
            console.log('[COR3 Helper] Bumped market refresh abort ID to', __cor3MarketRefreshAbortId);
            // Reset initial fetch so reconnect does a full fresh fetch (not partial retry)
            if (window.__cor3ResetInitialFetch) window.__cor3ResetInitialFetch();
            // Queue NON-market data fetches for retry (markets will be handled by initialFetch)
            queueRetryOp('expeditions');
            queueRetryOp('stash');
            queueRetryOp('dailyOps');
            window.postMessage({ type: 'COR3_TOKEN_EXPIRED' }, '*');
            // Close all tracked sockets — Socket.IO will auto-reconnect with a new token
            var socketsToClose = trackedSockets.slice();
            for (var i = 0; i < socketsToClose.length; i++) {
                try { socketsToClose[i].close(); } catch (e) {}
            }
            // Safety: if no new socket within 15s, log warning
            setTimeout(function () {
                if (trackedSockets.length === 0) {
                    console.log('[COR3 Helper] No new WebSocket connected after token-expired close — game may need page refresh');
                } else {
                    console.log('[COR3 Helper] WebSocket reconnected after token-expired');
                }
            }, 15000);
            return;
        }

        // Intercept specialists responses (stash expansion timers)
        if (eventName === 'specialists' && payload && payload.data) {
            window.postMessage({
                type: 'COR3_WS_SPECIALISTS',
                data: payload.data
            }, '*');
        }

        // Intercept stash (inventory) responses
        if (eventName === 'stash' && payload && payload.data) {
            window.postMessage({
                type: 'COR3_WS_STASH',
                stash: payload.data
            }, '*');
        }

        // Intercept loadout responses
        if (eventName === 'loadout' && payload) {
            var loadoutAction = payload.event ? payload.event.action : null;
            if (payload.error) {
                window.postMessage({
                    type: 'COR3_WS_LOADOUT_ERROR',
                    action: loadoutAction,
                    error: payload.error
                }, '*');
            }
            if (payload.data) {
                window.postMessage({
                    type: 'COR3_WS_LOADOUT',
                    action: loadoutAction,
                    loadout: payload.data
                }, '*');
                // Cache loadout data in window global for auto-job-solver access
                window.__cor3LoadoutData = payload.data;
                // Also post as auto-job event so solver waitForEvent can catch it
                window.postMessage({
                    type: 'COR3_AUTOJOB_LOADOUT',
                    action: loadoutAction,
                    data: payload.data,
                    error: null
                }, '*');
            }
            if (payload.error) {
                window.postMessage({
                    type: 'COR3_AUTOJOB_LOADOUT',
                    action: loadoutAction,
                    data: null,
                    error: payload.error
                }, '*');
            }
        }

        // Intercept mercenary responses — detect market by faction key (core_main vs usol_employment)
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'get.mercenaries') {
            var mercFactionKey = null;
            if (payload.data && payload.data.mercenaries && payload.data.mercenaries.length > 0) {
                var firstMerc = payload.data.mercenaries[0];
                if (firstMerc.faction && firstMerc.faction.key) mercFactionKey = firstMerc.faction.key;
            }
            // Fallback: check eliteSlots if no regular mercs
            if (!mercFactionKey && payload.data && payload.data.eliteSlots && payload.data.eliteSlots.length > 0) {
                var firstElite = payload.data.eliteSlots[0];
                if (firstElite.mercenary && firstElite.mercenary.faction && firstElite.mercenary.faction.key) mercFactionKey = firstElite.mercenary.faction.key;
                if (!mercFactionKey && firstElite.marketId === USOL_MARKET_ID) mercFactionKey = 'usol_employment';
            }
            if (mercFactionKey === 'usol_employment') {
                window.postMessage({ type: 'COR3_WS_USOL_MERCENARIES', data: payload.data }, '*');
            } else {
                // core_main or unknown — treat as CORE
                if (payload.data && payload.data.mercenaries) {
                    window.__cor3CachedMercIds = payload.data.mercenaries.map(function (m) { return m.id; });
                }
                window.postMessage({ type: 'COR3_WS_MERCENARIES', data: payload.data }, '*');
            }
            return;
        }

        // Intercept expedition config response (locations/zones/goals) — detect USOL by pending flag
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'get.config') {
            // Detect if this is a USOL config response by checking if USOL merc fetch is in progress
            var isUsolConfig = !!window.__cor3UsolMercFetchInProgress;
            if (payload.data && payload.data.locations && payload.data.locations.length > 0) {
                var loc = payload.data.locations[0];
                var zone0 = loc.zones && loc.zones[0] ? loc.zones[0] : null;
                var goal0 = zone0 && zone0.goals && zone0.goals[0] ? zone0.goals[0] : null;
                if (isUsolConfig) {
                    window.__cor3UsolExpConfigIds = {
                        locationConfigId: loc.id,
                        zoneConfigId: zone0 ? zone0.id : null,
                        goalId: goal0 ? goal0.id : null
                    };
                } else {
                    window.__cor3ExpConfigIds = {
                        locationConfigId: loc.id,
                        zoneConfigId: zone0 ? zone0.id : null,
                        goalId: goal0 ? goal0.id : null
                    };
                }
            }
            if (isUsolConfig) {
                window.postMessage({ type: 'COR3_WS_USOL_EXPEDITION_CONFIG', data: payload.data }, '*');
            } else {
                window.postMessage({ type: 'COR3_WS_EXPEDITION_CONFIG', data: payload.data }, '*');
            }
            return;
        }

        // Intercept open.container response
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'open.container') {
            window.postMessage({
                type: 'COR3_WS_CONTAINER_OPENED',
                data: payload.data
            }, '*');
            // Also update expedition data so UI shows container items
            if (payload.data && payload.data.id) {
                window.postMessage({
                    type: 'COR3_WS_EXPEDITIONS',
                    expeditions: [payload.data]
                }, '*');
            }
            return;
        }

        // Intercept collect.all response
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'collect.all') {
            // Check for stash full error
            if (payload.error && (payload.error.message === 'Insufficient stash capacity' || payload.error.message === 'stash.error.insufficient_capacity')) {
                window.postMessage({
                    type: 'COR3_WS_STASH_FULL',
                    error: payload.error.message,
                    requestId: payload.requestId
                }, '*');
            } else if (payload.error && payload.error.message === 'insufficient-credits') {
                console.log('[COR3 Helper] collect.all failed: insufficient credits');
                window.postMessage({
                    type: 'COR3_WS_COLLECT_INSUFFICIENT_CREDITS',
                    error: payload.error.message
                }, '*');
            } else if (payload.error) {
                console.log('[COR3 Helper] collect.all failed with unexpected error:', payload.error.message);
                window.postMessage({
                    type: 'COR3_WS_STASH_FULL',
                    error: payload.error.message,
                    requestId: payload.requestId
                }, '*');
            } else {
                window.postMessage({
                    type: 'COR3_WS_COLLECTED_ALL',
                    data: payload.data
                }, '*');
                // Update expedition data in UI so status reflects collection
                if (payload.data && payload.data.id) {
                    window.postMessage({
                        type: 'COR3_WS_EXPEDITIONS',
                        expeditions: [payload.data]
                    }, '*');
                }
            }
            return;
        }

        // Intercept insert.archive response (expedition fully archived after collect.all)
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'insert.archive') {
            window.postMessage({
                type: 'COR3_WS_EXPEDITION_ARCHIVED',
                data: payload.data
            }, '*');
            return;
        }

        // Intercept launch response
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'launch') {
            // Check for launch errors
            if (payload.error && payload.error.message === 'Maximum 1 active expedition allowed') {
                console.log('[COR3 Helper] Expedition launch failed: Maximum 1 active expedition allowed');
                window.postMessage({
                    type: 'COR3_WS_EXPEDITION_LAUNCH_ERROR',
                    error: payload.error.message
                }, '*');
                return;
            }

            if (payload.error && payload.error.message === 'Mercenary is not available') {
                console.log('[COR3 Helper] Expedition launch failed: Mercenary is not available');
                window.postMessage({
                    type: 'COR3_WS_MERC_NOT_AVAILABLE',
                    error: payload.error.message
                }, '*');
                return;
            }

            // Check for insufficient credits error
            if (payload.error && payload.error.message === 'insufficient-credits') {
                console.log('[COR3 Helper] Expedition launch failed: insufficient credits');
                window.postMessage({
                    type: 'COR3_WS_INSUFFICIENT_CREDITS',
                    error: payload.error.message
                }, '*');
                return;
            }

            // Successful launch
            window.postMessage({
                type: 'COR3_WS_EXPEDITION_LAUNCHED',
                data: payload.data
            }, '*');
            // Clear old expedition decisions when new expedition starts
            window.postMessage({
                type: 'COR3_WS_DECISIONS',
                decisions: [] // Clear decisions by sending empty array
            }, '*');
            // Post launch data as expedition data directly — no need for leave-room/join-room/get.active
            window.postMessage({
                type: 'COR3_WS_EXPEDITIONS',
                expeditions: [payload.data]
            }, '*');
            return;
        }

        // Intercept mercenary configure response (cost/risk/chances)
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'configure') {
            var mercId = (window.__cor3PendingMercConfigures && window.__cor3PendingMercConfigures.length > 0)
                ? window.__cor3PendingMercConfigures.shift() : null;
            window.postMessage({
                type: 'COR3_WS_MERC_CONFIGURE',
                mercenaryId: mercId,
                data: payload.data
            }, '*');
            return;
        }

        // Intercept market responses — handle get.options, get.lots, get.jobs separately
        // Markets are fetched one at a time (sequential per market) but within each market,
        // get.options + get.lots + get.jobs are sent as a parallel batch.
        // get.lots/get.jobs responses don't contain the market ID, so
        // __cor3CurrentMarketFetch (set by get.options response) tracks which market we're fetching.
        if (eventName === 'market' && payload && payload.data) {
            var mktAction = payload.event ? payload.event.action : null;

            // Helper: resolve market type from a market ID
            function resolveMarketType(id) {
                if (id === '019d3ea4-85bd-7389-904d-908ba9194aa0') return 'dark';
                if (id === '019da731-2db5-7d76-9447-1ea3b9b78001') return 'soyuz';
                if (id === '019e4065-6ae8-760d-8724-58ab4f2cf7d7') return 'usol';
                return 'home'; // 019d3ea4-85bd-7389-904d-8f7c85841134
            }
            function marketCacheKey(type) {
                return type === 'dark' ? '__cor3DarkMarketCache'
                    : type === 'soyuz' ? '__cor3SoyuzMarketCache'
                    : type === 'usol' ? '__cor3UsolMarketCache' : '__cor3HomeMarketCache';
            }
            function marketMsgType(type) {
                return type === 'dark' ? 'COR3_WS_DARK_MARKET'
                    : type === 'soyuz' ? 'COR3_WS_SOYUZ_MARKET'
                    : type === 'usol' ? 'COR3_WS_USOL_MARKET' : 'COR3_WS_MARKET';
            }
            function postMarketUpdate(type, cache) {
                window.postMessage({ type: marketMsgType(type), market: cache }, '*');
            }

            // get.options: contains market info, reputation, userCredits (no lots/jobs)
            var mkt = payload.data.market;
            if (mktAction === 'get.options' && mkt && mkt.marketName) {
                var marketType = resolveMarketType(mkt.id);
                var cacheKey = marketCacheKey(marketType);
                // Track which market we're currently fetching (for get.lots/get.jobs routing)
                window.__cor3CurrentMarketFetch = mkt.id;
                // Initialize or reset cache with get.options data
                // Preserve existing jobs/recentJobs/nextJobsResetAt/lots so UI doesn't flicker
                var prevJobs = window[cacheKey] ? window[cacheKey].jobs : undefined;
                var prevRecentJobs = window[cacheKey] ? window[cacheKey].recentJobs : undefined;
                var prevNextJobsResetAt = window[cacheKey] ? window[cacheKey].nextJobsResetAt : undefined;
                var prevLots = window[cacheKey] ? window[cacheKey].lots : undefined;
                window[cacheKey] = Object.assign({}, payload.data);
                if (prevJobs !== undefined) window[cacheKey].jobs = prevJobs;
                if (prevRecentJobs !== undefined) window[cacheKey].recentJobs = prevRecentJobs;
                if (prevNextJobsResetAt !== undefined) window[cacheKey].nextJobsResetAt = prevNextJobsResetAt;
                if (prevLots !== undefined) window[cacheKey].lots = prevLots;
                postMarketUpdate(marketType, window[cacheKey]);
                if (marketType === 'home') window.__cor3LastMarketId = mkt.id;
            }

            // get.lots: merge lots into cached market data
            // Uses __cor3CurrentMarketFetch to identify which market this belongs to
            if (mktAction === 'get.lots' && payload.data.lots) {
                var lotsMarketId = window.__cor3CurrentMarketFetch;
                var lotsType = resolveMarketType(lotsMarketId);
                var lotsCacheKey = marketCacheKey(lotsType);
                if (window[lotsCacheKey]) {
                    window[lotsCacheKey].lots = payload.data.lots;
                    postMarketUpdate(lotsType, window[lotsCacheKey]);
                }
            }

            // get.jobs: merge jobs into cached market data
            // Uses __cor3CurrentMarketFetch to identify which market this belongs to
            if (mktAction === 'get.jobs') {
                var jobsMarketId = window.__cor3CurrentMarketFetch;
                var jobsType = resolveMarketType(jobsMarketId);
                var jobsCacheKey = marketCacheKey(jobsType);
                if (window[jobsCacheKey]) {
                    window[jobsCacheKey].jobs = payload.data.jobs || [];
                    window[jobsCacheKey].recentJobs = payload.data.recentJobs || [];
                    window[jobsCacheKey].nextJobsResetAt = payload.data.nextJobsResetAt || window[jobsCacheKey].nextJobsResetAt;
                    postMarketUpdate(jobsType, window[jobsCacheKey]);
                    // Signal that this market's data is fully loaded
                    window.postMessage({ type: 'COR3_MARKET_FETCH_COMPLETE', marketId: jobsMarketId, marketType: jobsType }, '*');
                }
            }

            // Legacy: handle market responses without action (for backwards compatibility)
            if (!mktAction && mkt && mkt.marketName) {
                var legacyType = resolveMarketType(mkt.id);
                postMarketUpdate(legacyType, payload.data);
                if (legacyType === 'home') window.__cor3LastMarketId = mkt.id;
            }
        }

        // Intercept updater responses for patch version (selectedVersion)
        if (eventName === 'updater' && payload && payload.data) {
            var sv = payload.data.selectedVersion;
            if (sv) {
                console.log('[COR3 Helper] Captured patch version from updater:', sv);
                window.__cor3PatchVersion = sv;
                window.postMessage({ type: 'COR3_PATCH_VERSION', version: sv }, '*');
            }
        }

        // Intercept network-map responses (endpoint set success/failure)
        // detect no-path-to-server, server-in-maintenance, and market-not-reachable errors
        if (eventName === 'network-map' && payload && payload.event) {
            if (payload.event.action === 'set.endpoint') {
                var errMsg = payload.error && payload.error.message;
                var isUnreachableErr = errMsg === 'no-path-to-server' || errMsg === 'server-in-maintenance' || errMsg === 'market-not-reachable';
                if (payload.error && isUnreachableErr) {
                    console.log('[COR3 Helper] Server unreachable: ' + errMsg + ' (dark-pt: ' + !!window.__cor3DarkMarketPathThrough + ', soyuz-pt: ' + !!window.__cor3SoyuzMarketPathThrough + ', usol-pt: ' + !!window.__cor3UsolMarketPathThrough + ')');
                    // During path-through, forward as ENDPOINT_RESULT for the path-through handler to deal with
                    if (window.__cor3DarkMarketPathThrough || window.__cor3SoyuzMarketPathThrough || window.__cor3UsolMarketPathThrough) {
                        window.postMessage({
                            type: 'COR3_WS_ENDPOINT_RESULT',
                            success: false,
                            error: payload.error,
                            serverId: payload.error.serverId || null
                        }, '*');
                    } else if (window.__cor3UsolMarketPending) {
                        // USOL market refresh failed — fetch network-map for maintenance blocker
                        __cor3PostUnreachable('usol', null, USOL_FULL_PATH);
                    } else if (window.__cor3SoyuzMarketPending) {
                        // SOYUZ market refresh failed — fetch network-map for maintenance blocker
                        __cor3PostUnreachable('soyuz', null, SOYUZ_FULL_PATH);
                    } else {
                        // D4RK market refresh failed — fetch network-map for maintenance blocker
                        __cor3PostUnreachable('dark', null, DARK_FULL_PATH);
                    }
                } else {
                    var success = !payload.error;
                    var epServerId = (payload.error && payload.error.serverId) || null;
                    window.postMessage({
                        type: 'COR3_WS_ENDPOINT_RESULT',
                        success: success,
                        data: payload.data,
                        error: payload.error || null,
                        serverId: epServerId
                    }, '*');
                }
            }
            // Intercept get.map for server maintenance data + server type info
            if (payload.event.action === 'get.map' && payload.data && payload.data.servers) {
                var servers = payload.data.servers;
                var maintenanceInfo = {};
                var serverTypeMap = {};
                for (var si = 0; si < servers.length; si++) {
                    var srv = servers[si];
                    maintenanceInfo[srv.id] = {
                        serverName: srv.serverName,
                        isInMaintenance: !!srv.isInMaintenance,
                        maintenanceEndsAt: srv.maintenanceEndsAt || null,
                        timeUntilMaintenance: srv.timeUntilMaintenance || null
                    };
                    // Cache server type + defence rate for loadout power calculations
                    serverTypeMap[srv.id] = {
                        serverName: srv.serverName,
                        serverTypeName: srv.serverTypeName || null,
                        serverDefenceRate: srv.serverDefenceRate || 0
                    };
                }
                window.__cor3ServerTypeMap = serverTypeMap;
                window.postMessage({ type: 'COR3_WS_NETWORK_MAP', servers: maintenanceInfo }, '*');
                // Post full map data for IP Search and other consumers
                window.postMessage({ type: 'COR3_WS_MAP_DATA', servers: payload.data.servers, connections: payload.data.connections || [] }, '*');
            }
            if (payload.event.action === 'maintenance' && payload.data) {
                window.postMessage({ type: 'COR3_WS_MAINTENANCE_STARTED', data: payload.data }, '*');
            }
        }

        // --- Auto Job Solver: Intercept SAI responses ---
        if (eventName === 'sai' && payload && payload.event) {
            var action = payload.event.action;
            // Login status
            if (action === 'get.login.status') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_LOGIN_STATUS', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Login with access
            if (action === 'login.with-access') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_LOGIN_RESULT', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Hack start
            if (action === 'hack.start') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_HACK_START', data: payload.data || null, error: payload.error || null }, '*');
                return;
            }
            // SAI update (hack finished, etc)
            if (action === 'update') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_UPDATE', data: payload.data }, '*');
                return;
            }
            // Get files
            if (action === 'get.files') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_FILES', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // File download
            if (action === 'file.download') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_FILE_DOWNLOAD', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Get logs
            if (action === 'get.logs') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_LOGS', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Log delete
            if (action === 'log.delete') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_LOG_DELETE', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Log download
            if (action === 'log.download') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_LOG_DOWNLOAD', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Transit (IP list)
            if (action === 'get.transit') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_TRANSIT', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Transit add (IP injection result)
            if (action === 'transit.add') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_TRANSIT_ADD', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Transit remove (IP cleanup result)
            if (action === 'transit.remove') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_TRANSIT_REMOVE', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // File delete (file elimination result)
            if (action === 'file.delete') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_FILE_DELETE', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // File upload (data upload result)
            if (action === 'file.upload') {
                window.postMessage({ type: 'COR3_AUTOJOB_SAI_FILE_UPLOAD', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // File search-valuable (valuable seller)
            if (action === 'file.search-valuable') {
                window.postMessage({ type: 'COR3_VALUABLE_FILE_SEARCH', data: payload.data, error: payload.error || null }, '*');
                return;
            }
            // Log search-valuable (valuable seller)
            if (action === 'log.search-valuable') {
                window.postMessage({ type: 'COR3_VALUABLE_LOG_SEARCH', data: payload.data, error: payload.error || null }, '*');
                return;
            }
        }

        // --- Auto Job Solver: Intercept desktop responses ---
        if (eventName === 'desktop' && payload && payload.event) {
            var dAction = payload.event.action;
            console.log('[COR3 Helper] Desktop event:', dAction);
            if (dAction === 'open.folder') {
                window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_FOLDER', data: payload.data, error: payload.error || null }, '*');
            }
            if (dAction === 'update.file' || dAction === 'open.file' || dAction === 'decrypt.file') {
                var fileError = payload.error || null;
                if (!fileError && payload.data && payload.data.kind === 'insufficient_power') {
                    fileError = { message: 'insufficient_power', kind: 'insufficient_power', ability: payload.data.ability, required: payload.data.required, available: payload.data.available };
                }
                window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_FILE', data: payload.data, error: fileError }, '*');
                if (dAction === 'update.file') {
                    window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_UPDATE_FILE', data: payload.data, error: payload.error || null }, '*');
                }
            }
            if (dAction === 'get.file.analysis') {
                window.postMessage({ type: 'COR3_AUTOJOB_FILE_ANALYSIS', data: payload.data, error: payload.error || null }, '*');
            }
            if (dAction === 'get.options') {
                console.log('[COR3 Helper] Desktop get.options received — folders:', payload.data && payload.data.folders ? payload.data.folders.length : 0);
                // Cache Downloads folder ID globally for auto job solver
                if (payload.data && payload.data.folders) {
                    var dlf = payload.data.folders.find(function (f) { return f.name === 'Downloads'; });
                    if (dlf) {
                        window.__cor3DownloadFolderId = dlf.id;
                        console.log('[COR3 Helper] Cached Downloads folder ID:', dlf.id);
                    }
                }
                window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_OPTIONS', data: payload.data, error: payload.error || null }, '*');
            }
        }

        // --- Auto Job Solver: Intercept minigame start ---
        if (eventName === 'minigames' && payload && payload.event && payload.event.action === 'start.minigame') {
            if (payload.data && payload.data.lockExpiresAt && !payload.data.token) {
                window.postMessage({ type: 'COR3_AUTOJOB_MINIGAME_LOCKED', data: payload.data }, '*');
            } else {
                window.postMessage({ type: 'COR3_AUTOJOB_MINIGAME_START', data: payload.data }, '*');
                if (payload.data && payload.data.type === 'EXTERNAL' && payload.data.url && payload.data.url.indexOf('ice-wall-break') !== -1) {
                    window.postMessage({ type: 'COR3_ICE_WALL_MINIGAME_START', data: payload.data }, '*');
                }
            }
        }

        // --- Auto Job Solver: Intercept profile receive.progress (renown/XP) ---
        if (eventName === 'profile' && payload && payload.event && payload.event.action === 'receive.progress') {
            window.postMessage({ type: 'COR3_AUTOJOB_PROFILE_PROGRESS', data: payload.data }, '*');
        }

        // --- Auto Job Solver: Intercept profile receive.credits (credit reward) ---
        if (eventName === 'profile' && payload && payload.event && payload.event.action === 'receive.credits') {
            window.postMessage({ type: 'COR3_AUTOJOB_PROFILE_CREDITS', data: payload.data }, '*');
        }

        // --- Auto Job Solver: Intercept market job.take and job.complete ---
        if (eventName === 'market' && payload && payload.event) {
            if (payload.event.action === 'job.take') {
                window.postMessage({ type: 'COR3_AUTOJOB_JOB_TAKEN', data: payload.data, error: payload.error || null }, '*');
            }
            if (payload.event.action === 'job.complete') {
                console.log('[COR3 Helper] AutoJob: job.complete intercepted', JSON.stringify(payload.data));
                window.postMessage({ type: 'COR3_AUTOJOB_JOB_COMPLETED', data: payload.data, error: payload.error || null }, '*');
            }
            if (payload.event.action === 'job.can-complete') {
                window.postMessage({ type: 'COR3_AUTOJOB_JOB_CAN_COMPLETE', data: payload.data, error: payload.error || null }, '*');
            }
            // Valuable seller: get sellable items
            if (payload.event.action === 'get.sellable-items') {
                window.postMessage({ type: 'COR3_VALUABLE_SELLABLE_ITEMS', data: payload.data, error: payload.error || null }, '*');
            }
            // Valuable seller: sell items
            if (payload.event.action === 'sell.items') {
                window.postMessage({ type: 'COR3_VALUABLE_SELL_RESULT', data: payload.data, error: payload.error || null }, '*');
            }
        }

        // Handle expedition update events for listening-based updates
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'update') {
            console.log('[COR3 Helper] Expedition update event detected - data will flow through existing handlers');
            return;
        }

        // We're interested in "expeditions" responses that contain expedition data
        if (eventName === 'expeditions' && payload && payload.data) {
            // Handle archived expeditions response
            if (payload.event && payload.event.action === 'get.archived') {
                window.postMessage({
                    type: 'COR3_WS_ARCHIVED_EXPEDITIONS',
                    data: payload.data
                }, '*');
                return;
            }

            // Skip merc-related actions — they have their own handlers and
            // must NOT be relayed as expedition data (would trigger auto-send prematurely)
            var expAction = payload.event && payload.event.action;
            if (expAction === 'get.mercenaries' || expAction === 'get.config' || expAction === 'configure') {
                return;
            }

            const expeditions = Array.isArray(payload.data) ? payload.data : [payload.data];

            // Relay full expedition data for expedition info display
            window.postMessage({
                type: 'COR3_WS_EXPEDITIONS',
                expeditions: expeditions
            }, '*');

            const decisionsFound = [];

            for (const expedition of expeditions) {
                if (!expedition.messages) continue;

                for (const msg of expedition.messages) {
                    if (msg.decisionOptions && msg.decisionOptions !== null) {
                        decisionsFound.push({
                            expeditionId: expedition.id,
                            mercenaryCallsign: expedition.mercenary
                                ? expedition.mercenary.callsign
                                : 'Unknown',
                            locationName: expedition.locationName || '',
                            zoneName: expedition.zoneName || '',
                            riskScore: expedition.riskScore || 0,
                            messageId: msg.id,
                            content: msg.content,
                            decisionOptions: msg.decisionOptions,
                            selectedOption: msg.selectedOption,
                            decisionDeadline: msg.decisionDeadline,
                            isResolved: msg.isResolved,
                            isAutoResolved: msg.isAutoResolved || false,
                            createdAt: msg.createdAt
                        });
                    }
                }
            }

            if (decisionsFound.length > 0) {
                window.postMessage({
                    type: 'COR3_WS_DECISIONS',
                    decisions: decisionsFound
                }, '*');
            }
        }
    }

    // Global variables to store versions as fallback
    window.__cor3WebVersion = null;
    window.__cor3SystemVersion = null;
    window.__cor3PatchVersion = null;
    window.__cor3DownloadFolderId = null;

    // Send expedition request through any open tracked socket
    // Joining the expedition room triggers the server to respond with get.active data.
    // We track whether data already arrived to avoid sending a duplicate get.active.
    window.__cor3RequestExpeditions = function () {
        console.log('[COR3 Helper] Requesting expedition data');
        var gotData = false;
        // Listen for the response — if it arrives from room join alone, skip manual send
        var onExpData = function (evt) {
            if (evt.data && evt.data.type === 'COR3_WS_EXPEDITIONS') {
                gotData = true;
                window.removeEventListener('message', onExpData);
            }
        };
        window.addEventListener('message', onExpData);

        enterRooms(['expeditions']).then(function () {
            // Wait a bit — if data already arrived from room join, skip the manual send
            setTimeout(function () {
                window.removeEventListener('message', onExpData);
                if (!gotData) {
                    var msg = '42["event",{"event":{"name":"expeditions","action":"get.active"}}]';
                    wsSend(msg);
                }
            }, 2000);
        });
        return true;
    };

    // Send decision response via WS
    window.__cor3RespondDecision = function (expeditionId, messageId, selectedOption) {
        var payload = JSON.stringify({
            expeditionId: expeditionId,
            messageId: messageId,
            selectedOption: selectedOption
        });
        var msg = '42["event",{"event":{"name":"expeditions","action":"respond.event"},"data":' + payload + '}]';
        console.log('[COR3 Helper] Sending decision response:', selectedOption);
        var sent = wsSend(msg);
        if (!sent) {
            // Queue for retry if socket is down (token-expired)
            queueRetryOp('decision:' + payload);
        }
        return sent;
    };

    // Request archived expeditions
    window.__cor3RequestArchivedExpeditions = function () {
        console.log('[COR3 Helper] Requesting archived expeditions');
        var msg = '42["event",{"event":{"name":"expeditions","action":"get.archived"},"data":{"cursor":null,"limit":20}}]';
        wsSend(msg);
        return true;
    };

    // CORE merc abort handle for cancelling in-flight requests
    var coreMercAbort = null;

    // Request mercenary data: get.mercenaries → (get.config if needed) → configure each merc sequentially
    window.__cor3RequestMercenaries = function (marketId, callback) {
        if (window.__cor3CoreMercFetchInProgress) {
            console.log('[COR3 Helper] CORE merc fetch already in progress — aborting previous');
            if (coreMercAbort) coreMercAbort();
        }
        var mid = marketId || window.__cor3LastMarketId || '019d3ea4-85bd-7389-904d-8f7c85841134';
        console.log('[COR3 Helper] Starting CORE mercenary data fetch for market:', mid);
        window.__cor3CoreMercFetchInProgress = true;

        var aborted = false;
        coreMercAbort = function () {
            aborted = true;
            window.__cor3CoreMercFetchInProgress = false;
            window.removeEventListener('message', onCoreData);
            clearTimeout(coreTimer);
            coreMercAbort = null;
        };

        var getMercs = '42["event",{"event":{"name":"expeditions","action":"get.mercenaries"},"data":{"marketId":"' + mid + '"}}]';
        wsSend(getMercs);
        setTimeout(function () {
            if (aborted) return;
            var getConfig = '42["event",{"event":{"name":"expeditions","action":"get.config"},"data":{"marketId":"' + mid + '"}}]';
            wsSend(getConfig);
        }, humanDelay());

        var coreMercData = null;
        var coreConfigData = null;
        var coreDone = false;
        function onCoreData(evt) {
            if (aborted || coreDone) return;
            if (!evt.data) return;
            if (evt.data.type === 'COR3_WS_MERCENARIES') {
                coreMercData = evt.data.data;
                checkAndConfigureCore();
            }
            if (evt.data.type === 'COR3_WS_EXPEDITION_CONFIG') {
                var loc = evt.data.data && evt.data.data.locations && evt.data.data.locations[0];
                var zone0 = loc && loc.zones && loc.zones[0] ? loc.zones[0] : null;
                var goal0 = zone0 && zone0.goals && zone0.goals[0] ? zone0.goals[0] : null;
                coreConfigData = {
                    locationConfigId: loc ? loc.id : null,
                    zoneConfigId: zone0 ? zone0.id : null,
                    goalId: goal0 ? goal0.id : null
                };
                window.__cor3ExpConfigIds = coreConfigData;
                checkAndConfigureCore();
            }
        }
        function checkAndConfigureCore() {
            if (!coreMercData || !coreConfigData) return;
            coreDone = true;
            window.removeEventListener('message', onCoreData);
            clearTimeout(coreTimer);
            var configIds = coreConfigData;
            var allMercIds = [];
            if (coreMercData.mercenaries) {
                allMercIds = coreMercData.mercenaries.map(function (m) { return m.id; });
            }
            if (coreMercData.eliteSlots) {
                coreMercData.eliteSlots.forEach(function (es) {
                    if (es.mercenary && allMercIds.indexOf(es.mercenary.id) === -1) {
                        allMercIds.push(es.mercenary.id);
                    }
                });
            }
            console.log('[COR3 Helper] Configuring ' + allMercIds.length + ' CORE mercs');
            (function configureNext(i) {
                if (aborted || i >= allMercIds.length) {
                    window.__cor3CoreMercFetchInProgress = false;
                    coreMercAbort = null;
                    if (!aborted) {
                        console.log('[COR3 Helper] CORE merc configure complete');
                        if (callback) callback();
                    }
                    return;
                }
                window.__cor3RequestMercConfigure(allMercIds[i], mid, configIds.locationConfigId, configIds.zoneConfigId, configIds.goalId);
                function onConfigResponse(evt3) {
                    if (aborted) { window.removeEventListener('message', onConfigResponse); return; }
                    if (evt3.data && evt3.data.type === 'COR3_WS_MERC_CONFIGURE') {
                        window.removeEventListener('message', onConfigResponse);
                        clearTimeout(configTimeout);
                        setTimeout(function () { configureNext(i + 1); }, 200);
                    }
                }
                window.addEventListener('message', onConfigResponse);
                var configTimeout = setTimeout(function () {
                    window.removeEventListener('message', onConfigResponse);
                    configureNext(i + 1);
                }, 5000);
            })(0);
        }
        window.addEventListener('message', onCoreData);
        var coreTimer = setTimeout(function () {
            if (!coreDone && !aborted) {
                coreDone = true;
                window.removeEventListener('message', onCoreData);
                window.__cor3CoreMercFetchInProgress = false;
                coreMercAbort = null;
                console.log('[COR3 Helper] CORE merc data fetch timeout');
                if (callback) callback();
            }
        }, 30000);
        return true;
    };

    // Request expedition config (returns location/zone/goal IDs)
    window.__cor3RequestExpeditionConfig = function (marketId) {
        var mid = marketId || window.__cor3LastMarketId || '019d3ea4-85bd-7389-904d-8f7c85841134';
        console.log('[COR3 Helper] Requesting expedition config for market:', mid);
        var msg = '42["event",{"event":{"name":"expeditions","action":"get.config"},"data":{"marketId":"' + mid + '"}}]';
        wsSend(msg);
        return true;
    };

    // Track pending mercenary configure requests (queue of mercenaryIds)
    window.__cor3PendingMercConfigures = [];

    // Request mercenary configure details (cost, risk, chances)
    window.__cor3RequestMercConfigure = function (mercenaryId, marketId, locationConfigId, zoneConfigId, goalId) {
        var mid = marketId || window.__cor3LastMarketId || '019d3ea4-85bd-7389-904d-8f7c85841134';
        console.log('[COR3 Helper] Requesting configure for mercenary:', mercenaryId);
        window.__cor3PendingMercConfigures.push(mercenaryId);
        var data = {
            mercenaryId: mercenaryId,
            marketId: mid,
            locationConfigId: locationConfigId,
            zoneConfigId: zoneConfigId,
            goalId: goalId,
            hasInsurance: false
        };
        var msg = '42["event",{"event":{"name":"expeditions","action":"configure"},"data":' + JSON.stringify(data) + '}]';
        wsSend(msg);
        return true;
    };

    // USOL merc abort handle for cancelling in-flight requests
    var usolMercAbort = null;

    // Request USOL mercenary data: set endpoint → get.mercenaries → (get.config if needed) → configure each merc
    window.__cor3RequestUsolMercenaries = function (callback) {
        var cachedUnreachable = window.__cor3IsMarketUnreachable('usol');
        if (cachedUnreachable) {
            console.log('[COR3 Helper] USOL market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping merc fetch');
            window.postMessage({
                type: 'COR3_WS_USOL_MARKET_UNREACHABLE',
                error: 'no-path-to-server',
                blockerServerName: cachedUnreachable.blockerName,
                maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
                cached: true
            }, '*');
            if (callback) callback();
            return true;
        }
        if (window.__cor3UsolMercFetchInProgress) {
            console.log('[COR3 Helper] USOL merc fetch already in progress — aborting previous');
            if (usolMercAbort) usolMercAbort();
        }
        console.log('[COR3 Helper] Starting USOL mercenary data fetch');
        window.__cor3UsolMercFetchInProgress = true;

        var aborted = false;
        usolMercAbort = function () {
            aborted = true;
            window.__cor3UsolMercFetchInProgress = false;
            usolMercAbort = null;
        };

        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + USOL_SERVER_ID + '"}}]';
        wsSend(setEndpoint);

        var handled = false;
        function onEndpointResult(evt) {
            if (handled || aborted) return;
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                handled = true;
                window.removeEventListener('message', onEndpointResult);
                clearTimeout(epTimer);
                if (evt.data.success === false) {
                    window.__cor3UsolMercFetchInProgress = false;
                    usolMercAbort = null;
                    console.log('[COR3 Helper] USOL merc endpoint unreachable — skipping');
                    if (callback) callback();
                    return;
                }
                setTimeout(function () {
                    if (aborted) return;
                    console.log('[COR3 Helper] Requesting USOL mercenaries');
                    var getMercs = '42["event",{"event":{"name":"expeditions","action":"get.mercenaries"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
                    wsSend(getMercs);
                    setTimeout(function () {
                        if (aborted) return;
                        var getConfig = '42["event",{"event":{"name":"expeditions","action":"get.config"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
                        wsSend(getConfig);
                    }, humanDelay());
                }, humanDelay());

                var usolMercData = null;
                var usolConfigData = null;
                var usolDone = false;
                function onUsolData(evt2) {
                    if (usolDone || aborted) return;
                    if (!evt2.data) return;
                    if (evt2.data.type === 'COR3_WS_USOL_MERCENARIES') {
                        usolMercData = evt2.data.data;
                        checkAndConfigure();
                    }
                    if (evt2.data.type === 'COR3_WS_USOL_EXPEDITION_CONFIG') {
                        var loc = evt2.data.data && evt2.data.data.locations && evt2.data.data.locations[0];
                        var zone0 = loc && loc.zones && loc.zones[0] ? loc.zones[0] : null;
                        var goal0 = zone0 && zone0.goals && zone0.goals[0] ? zone0.goals[0] : null;
                        usolConfigData = {
                            locationConfigId: loc ? loc.id : null,
                            zoneConfigId: zone0 ? zone0.id : null,
                            goalId: goal0 ? goal0.id : null
                        };
                        window.__cor3UsolExpConfigIds = usolConfigData;
                        checkAndConfigure();
                    }
                }
                function checkAndConfigure() {
                    if (!usolMercData || !usolConfigData) return;
                    usolDone = true;
                    window.removeEventListener('message', onUsolData);
                    clearTimeout(usolTimer);
                    var configIds = usolConfigData;
                    var allMercIds = [];
                    if (usolMercData.mercenaries) {
                        allMercIds = usolMercData.mercenaries.map(function (m) { return m.id; });
                    }
                    if (usolMercData.eliteSlots) {
                        usolMercData.eliteSlots.forEach(function (es) {
                            if (es.mercenary && allMercIds.indexOf(es.mercenary.id) === -1) {
                                allMercIds.push(es.mercenary.id);
                            }
                        });
                    }
                    console.log('[COR3 Helper] Configuring ' + allMercIds.length + ' USOL mercs');
                    (function configureNext(i) {
                        if (aborted || i >= allMercIds.length) {
                            window.__cor3UsolMercFetchInProgress = false;
                            usolMercAbort = null;
                            if (!aborted) {
                                console.log('[COR3 Helper] USOL merc configure complete');
                                if (callback) callback();
                            }
                            return;
                        }
                        window.__cor3RequestMercConfigure(allMercIds[i], USOL_MARKET_ID, configIds.locationConfigId, configIds.zoneConfigId, configIds.goalId);
                        function onConfigResponse(evt3) {
                            if (aborted) { window.removeEventListener('message', onConfigResponse); return; }
                            if (evt3.data && evt3.data.type === 'COR3_WS_MERC_CONFIGURE') {
                                window.removeEventListener('message', onConfigResponse);
                                clearTimeout(configTimeout);
                                setTimeout(function () { configureNext(i + 1); }, 200);
                            }
                        }
                        window.addEventListener('message', onConfigResponse);
                        var configTimeout = setTimeout(function () {
                            window.removeEventListener('message', onConfigResponse);
                            configureNext(i + 1);
                        }, 5000);
                    })(0);
                }
                window.addEventListener('message', onUsolData);
                var usolTimer = setTimeout(function () {
                    if (!usolDone && !aborted) {
                        usolDone = true;
                        window.removeEventListener('message', onUsolData);
                        window.__cor3UsolMercFetchInProgress = false;
                        usolMercAbort = null;
                        console.log('[COR3 Helper] USOL merc data fetch timeout');
                        if (callback) callback();
                    }
                }, 30000);
            }
            if (evt.data && evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
                handled = true;
                window.removeEventListener('message', onEndpointResult);
                clearTimeout(epTimer);
                window.__cor3UsolMercFetchInProgress = false;
                usolMercAbort = null;
                console.log('[COR3 Helper] USOL merc endpoint unreachable');
                if (callback) callback();
            }
        }
        window.addEventListener('message', onEndpointResult);
        var epTimer = setTimeout(function () {
            if (!handled && !aborted) {
                handled = true;
                window.removeEventListener('message', onEndpointResult);
                window.__cor3UsolMercFetchInProgress = false;
                usolMercAbort = null;
                console.log('[COR3 Helper] USOL merc endpoint timeout');
                if (callback) callback();
            }
        }, 10000);
        return true;
    };

    // Configure and launch expedition with mercenary
    // For non-HOME markets, set.endpoint to the market server first
    window.__cor3LaunchExpedition = function (configData) {
        console.log('[COR3 Helper] Launching expedition with config:', configData);
        var marketId = configData.marketId;
        var needsEndpoint = marketId && marketId !== '019d3ea4-85bd-7389-904d-8f7c85841134'; // not HOME
        var serverId = null;
        if (marketId === USOL_MARKET_ID) serverId = USOL_SERVER_ID;

        function doConfigureAndLaunch() {
            var configureMsg = '42["event",{"event":{"name":"expeditions","action":"configure"},"data":' + JSON.stringify(configData) + '}]';
            wsSend(configureMsg);
            // After configure, launch after a delay (launch needs same data as configure)
            setTimeout(function () {
                var launchMsg = '42["event",{"event":{"name":"expeditions","action":"launch"},"data":' + JSON.stringify(configData) + '}]';
                wsSend(launchMsg);
                console.log('[COR3 Helper] Expedition launch sent');
            }, humanDelay() + 500);
        }

        if (needsEndpoint && serverId) {
            console.log('[COR3 Helper] Setting endpoint to market server before launch:', serverId);
            var setEp = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + serverId + '"}}]';
            wsSend(setEp);
            var epHandled = false;
            function onEpResult(evt) {
                if (epHandled) return;
                if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                    epHandled = true;
                    window.removeEventListener('message', onEpResult);
                    clearTimeout(epTimeout);
                    if (evt.data.success === false) {
                        console.log('[COR3 Helper] Endpoint unreachable for launch, aborting');
                        return;
                    }
                    setTimeout(doConfigureAndLaunch, humanDelay());
                }
            }
            window.addEventListener('message', onEpResult);
            var epTimeout = setTimeout(function () {
                if (!epHandled) {
                    epHandled = true;
                    window.removeEventListener('message', onEpResult);
                    console.log('[COR3 Helper] Endpoint timeout for launch, proceeding anyway');
                    doConfigureAndLaunch();
                }
            }, 8000);
        } else {
            doConfigureAndLaunch();
        }
        return true;
    };

    // Open reward container for a completed expedition
    window.__cor3OpenContainer = function (expeditionId) {
        console.log('[COR3 Helper] Opening container for expedition:', expeditionId);
        var msg = '42["event",{"event":{"name":"expeditions","action":"open.container"},"data":{"expeditionId":"' + expeditionId + '"}}]';
        wsSend(msg);
        return true;
    };

    // Collect all contents from an opened container
    window.__cor3CollectAll = function (expeditionId) {
        console.log('[COR3 Helper] Collecting all from expedition:', expeditionId);
        var msg = '42["event",{"event":{"name":"expeditions","action":"collect.all"},"data":{"expeditionId":"' + expeditionId + '"}}]';
        wsSend(msg);
        return true;
    };

    // Get a random human-like delay (400–900ms)
    function humanDelay() {
        return 400 + Math.floor(Math.random() * 500);
    }

    // Send a WS message on the active socket (most recently received messages)
    // Throttled: minimum 250ms between sends to avoid "Too many requests" errors.
    // Uses timestamp-based approach: if last send was <250ms ago, delay this send.
    var WS_THROTTLE_MS = 250;
    var wsSendLastTime = 0;
    var wsSendQueue = [];
    var wsSendFlushTimer = null;
    var WS_QUEUE_MAX = 50;

    var _ceChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
    var _ceCbs = [];
    if (_ceChannel) {
        _ceChannel.port1.onmessage = function () {
            var cbs = _ceCbs.slice();
            _ceCbs.length = 0;
            for (var i = 0; i < cbs.length; i++) cbs[i]();
        };
    }
    function ceNextTick(fn) {
        if (_ceChannel) { _ceCbs.push(fn); _ceChannel.port2.postMessage(0); }
        else { setTimeout(fn, 0); }
    }
    function scheduleFlush(delayMs) {
        if (wsSendFlushTimer) return;
        if (delayMs <= 0) { ceNextTick(wsSendFlush); wsSendFlushTimer = true; return; }
        var target = Date.now() + delayMs;
        function tick() {
            if (Date.now() >= target) { wsSendFlush(); return; }
            var rem = target - Date.now();
            if (rem > 200) { setTimeout(function () { ceNextTick(tick); }, Math.min(rem - 50, 500)); }
            else { ceNextTick(tick); }
        }
        wsSendFlushTimer = true;
        ceNextTick(tick);
    }

    function wsSendRaw(msg) {
        var toSend = msg;
        var codec = window.__cor3MsgpackCodec;
        if (codec && codec.isReady() && typeof msg === 'string') {
            var buf = codec.stringToPacketBuffer(msg);
            if (buf) toSend = buf;
        }

        if (activeSocket && activeSocket.readyState === OrigWebSocket.OPEN) {
            activeSocket.send(toSend);
            wsSendLastTime = Date.now();
            return true;
        }

        let bestSocket = null;
        let bestTime = 0;
        for (const ws of trackedSockets) {
            if (ws.readyState === OrigWebSocket.OPEN) {
                const lastActivity = socketLastActivity.get(ws) || 0;
                if (lastActivity > bestTime) {
                    bestTime = lastActivity;
                    bestSocket = ws;
                }
            }
        }

        if (bestSocket) {
            activeSocket = bestSocket;
            bestSocket.send(toSend);
            wsSendLastTime = Date.now();
            return true;
        }

        console.log('[COR3 Helper] No active WebSocket found — re-queuing message for retry');
        // Re-queue message and retry after a short delay
        if (wsSendQueue.length < WS_QUEUE_MAX) {
            wsSendQueue.unshift(msg);
            scheduleFlush(2000);
        } else {
            console.log('[COR3 Helper] No active WebSocket and queue full — message dropped');
        }
        return false;
    }

    function wsSendFlush() {
        wsSendFlushTimer = null;
        if (wsSendQueue.length === 0) return;
        var now = Date.now();
        var elapsed = now - wsSendLastTime;
        if (elapsed >= WS_THROTTLE_MS) {
            var next = wsSendQueue.shift();
            wsSendRaw(next);
            if (wsSendQueue.length > 0) {
                scheduleFlush(WS_THROTTLE_MS);
            }
        } else {
            scheduleFlush(WS_THROTTLE_MS - elapsed);
        }
    }

    function wsSend(msg) {
        var now = Date.now();
        var elapsed = now - wsSendLastTime;
        if (elapsed >= WS_THROTTLE_MS && wsSendQueue.length === 0) {
            // Can send immediately
            wsSendRaw(msg);
        } else {
            // Queue and schedule flush
            wsSendQueue.push(msg);
            // Overflow protection: drop oldest messages if queue grows too large
            if (wsSendQueue.length > WS_QUEUE_MAX) {
                var dropped = wsSendQueue.length - WS_QUEUE_MAX;
                wsSendQueue = wsSendQueue.slice(dropped);
                console.log('[COR3 Helper] WS send queue overflow — dropped ' + dropped + ' oldest message(s)');
            }
            if (!wsSendFlushTimer) {
                scheduleFlush(Math.max(0, WS_THROTTLE_MS - elapsed));
            }
        }
        return true;
    }

    // --- Room state tracking ---
    const joinedRooms = new Set();

    function delay(ms) {
        return new Promise(function (resolve) {
            var target = Date.now() + ms;
            function check() {
                if (Date.now() >= target) { resolve(); return; }
                var remaining = target - Date.now();
                if (remaining > 200) {
                    setTimeout(function () { ceNextTick(check); }, Math.min(remaining - 50, 500));
                } else {
                    ceNextTick(check);
                }
            }
            ceNextTick(check);
        });
    }

    // Send a leave-room message. Only sends if tracked as joined.
    function leaveRoom(room) {
        if (!joinedRooms.has(room)) return false;
        wsSend('42["leave-room",{"room":"' + room + '"}]');
        joinedRooms.delete(room);
        return true;
    }

    // Send a join-room message and mark as joined.
    // New format includes jwtToken and clientVersion.
    function sendJoin(room) {
        var joinData = { room: room };
        // Include jwtToken (strip "Bearer " prefix from captured token)
        if (capturedBearerToken) {
            var jwt = capturedBearerToken;
            if (jwt.startsWith('Bearer ')) jwt = jwt.substring(7);
            joinData.jwtToken = jwt;
        }
        // Include clientVersion from captured web version
        if (window.__cor3WebVersion) {
            joinData.clientVersion = window.__cor3WebVersion;
        }
        wsSend('42["join-room",' + JSON.stringify(joinData) + ']');
        joinedRooms.add(room);
    }

    // Leave multiple rooms in order (child first), with human delays between.
    function leaveRoomsInOrder(rooms) {
        var chain = Promise.resolve();
        rooms.forEach(function (room) {
            chain = chain.then(function () {
                if (leaveRoom(room)) {
                    return delay(humanDelay());
                }
            });
        });
        return chain;
    }

    // Join multiple rooms in order (parent first), with human delays between.
    function joinRoomsInOrder(rooms) {
        var chain = Promise.resolve();
        rooms.forEach(function (room) {
            chain = chain.then(function () {
                sendJoin(room);
                return delay(humanDelay());
            });
        });
        return chain;
    }

    // Enter rooms properly: leave any already-joined rooms (child→parent),
    // then join them all fresh (parent→child).
    // `rooms` must be in parent→child order, e.g. ['network-map', 'market']
    function enterRooms(rooms) {
        // Build leave list: reverse order (child first), only rooms we're in
        var toLeave = rooms.slice().reverse().filter(function (r) { return joinedRooms.has(r); });
        return leaveRoomsInOrder(toLeave).then(function () {
            return joinRoomsInOrder(rooms);
        });
    }

    // Send stash request: leave if in room, delay, then re-join
    window.__cor3RequestStash = function () {
        console.log('[COR3 Helper] Requesting stash data');
        enterRooms(['stash']);
        return true;
    };

    // Sell an item from stash
    window.__cor3SellItem = function (itemId, quantity, skipStashRefresh) {
        quantity = quantity || 1;
        console.log('[COR3 Helper] Selling item:', itemId, 'qty:', quantity);
        var msg = '42["event",{"event":{"name":"stash","action":"sell.item"},"data":{"itemId":"' + itemId + '","quantity":' + quantity + '}}]';
        wsSend(msg);
        if (!skipStashRefresh) {
            setTimeout(function () {
                window.__cor3RequestStash();
            }, 1500);
        }
        return true;
    };

    // --- Specialists WS send function ---
    window.__cor3RequestSpecialists = function () {
        console.log('[COR3 Helper] Requesting specialists data');
        var msg = '42["event",{"event":{"name":"specialists","action":"get.state"},"data":{}}]';
        wsSend(msg);
        return true;
    };

    // --- Loadout WS send functions ---
    window.__cor3RequestLoadout = function () {
        console.log('[COR3 Helper] Requesting loadout data');
        var msg = '42["event",{"event":{"name":"loadout","action":"get.options"}}]';
        wsSend(msg);
        return true;
    };
    window.__cor3EquipHardware = function (moduleConfigId) {
        console.log('[COR3 Helper] Equipping hardware:', moduleConfigId);
        var msg = '42["event",{"event":{"name":"loadout","action":"equip.hardware"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
        wsSend(msg);
    };
    window.__cor3EquipSoftware = function (moduleConfigId) {
        console.log('[COR3 Helper] Equipping software:', moduleConfigId);
        var msg = '42["event",{"event":{"name":"loadout","action":"equip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
        wsSend(msg);
    };
    window.__cor3UnequipSoftware = function (moduleConfigId) {
        console.log('[COR3 Helper] Unequipping software:', moduleConfigId);
        var msg = '42["event",{"event":{"name":"loadout","action":"unequip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
        wsSend(msg);
    };

    // --- Auto Job Solver WS send functions ---
    window.__cor3AutoJobTake = function (marketId, jobId) {
        var msg = '42["event",{"event":{"name":"market","action":"job.take"},"data":{"marketId":"' + marketId + '","jobId":"' + jobId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobComplete = function (marketId, jobId) {
        var msg = '42["event",{"event":{"name":"market","action":"job.complete"},"data":{"marketId":"' + marketId + '","jobId":"' + jobId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobDismiss = function (marketId, jobId) {
        var msg = '42["event",{"event":{"name":"market","action":"job.dismiss"},"data":{"marketId":"' + marketId + '","jobId":"' + jobId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobGetMarketOptions = function (marketId) {
        // Update current market fetch tracker so the response handler routes jobs to the correct market cache
        window.__cor3CurrentMarketFetch = marketId;
        var msg = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + marketId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobSetEndpoint = function (serverId) {
        var msg = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobGetLoginStatus = function (serverId) {
        var msg = '42["event",{"event":{"name":"sai","action":"get.login.status"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobLoginWithAccess = function (serverId, accessGrantId) {
        var msg = '42["event",{"event":{"name":"sai","action":"login.with-access"},"data":{"serverId":"' + serverId + '","accessGrantId":"' + accessGrantId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobHackStart = function (serverId) {
        var msg = '42["event",{"event":{"name":"sai","action":"hack.start"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobGetFiles = function (serverId) {
        var msg = '42["event",{"event":{"name":"sai","action":"get.files"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobFileDownload = function (serverId, fileId) {
        var msg = '42["event",{"event":{"name":"sai","action":"file.download"},"data":{"serverId":"' + serverId + '","fileId":"' + fileId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobGetLogs = function (serverId) {
        var msg = '42["event",{"event":{"name":"sai","action":"get.logs"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobLogDelete = function (serverId, seq) {
        var msg = '42["event",{"event":{"name":"sai","action":"log.delete"},"data":{"serverId":"' + serverId + '","seq":' + seq + '}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobLogDownload = function (serverId, seq) {
        var msg = '42["event",{"event":{"name":"sai","action":"log.download"},"data":{"serverId":"' + serverId + '","seq":' + seq + '}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobGetTransit = function (serverId) {
        var msg = '42["event",{"event":{"name":"sai","action":"get.transit"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobTransitAdd = function (serverId, ip, description) {
        description = description || '';
        var msg = '42["event",{"event":{"name":"sai","action":"transit.add"},"data":{"serverId":"' + serverId + '","ip":"' + ip + '","description":"' + description + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobOpenFolder = function (folderId) {
        var msg = '42["event",{"event":{"name":"desktop","action":"open.folder"},"data":{"folderId":"' + folderId + '","source":"desktop"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobGetDesktopOptions = function () {
        var msg = '42["event",{"event":{"name":"desktop","action":"get.options"},"data":{}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobDecryptFile = function (fileId) {
        var msg = '42["event",{"event":{"name":"desktop","action":"decrypt.file"},"data":{"fileId":"' + fileId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobGetNetworkMap = function () {
        var msg = '42["event",{"event":{"name":"network-map","action":"get.map"},"data":{}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobFileDelete = function (serverId, fileId) {
        var msg = '42["event",{"event":{"name":"sai","action":"file.delete"},"data":{"serverId":"' + serverId + '","fileId":"' + fileId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobFileUpload = function (serverId, name, sizeMb) {
        var msg = '42["event",{"event":{"name":"sai","action":"file.upload"},"data":{"serverId":"' + serverId + '","name":"' + name + '","sizeMb":' + (sizeMb || 0) + '}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobTransitRemove = function (serverId, ip) {
        var msg = '42["event",{"event":{"name":"sai","action":"transit.remove"},"data":{"serverId":"' + serverId + '","ip":"' + ip + '"}}]';
        wsSend(msg);
    };
    // --- Auto Job Solver: file analysis + loadout commands ---
    window.__cor3AutoJobGetFileAnalysis = function (fileId) {
        var msg = '42["event",{"event":{"name":"desktop","action":"get.file.analysis"},"data":{"fileId":"' + fileId + '","source":"desktop"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobRequestLoadout = function () {
        var msg = '42["event",{"event":{"name":"loadout","action":"get.options"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobEquipHardware = function (moduleConfigId) {
        var msg = '42["event",{"event":{"name":"loadout","action":"equip.hardware"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobEquipSoftware = function (moduleConfigId) {
        var msg = '42["event",{"event":{"name":"loadout","action":"equip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
        wsSend(msg);
    };
    window.__cor3AutoJobUnequipSoftware = function (moduleConfigId) {
        var msg = '42["event",{"event":{"name":"loadout","action":"unequip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
        wsSend(msg);
    };
    // --- Auto Valuable Seller WS send functions ---
    window.__cor3ValuableFileSearch = function (serverId) {
        var msg = '42["event",{"event":{"name":"sai","action":"file.search-valuable"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3ValuableLogSearch = function (serverId) {
        var msg = '42["event",{"event":{"name":"sai","action":"log.search-valuable"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(msg);
    };
    window.__cor3ValuableGetSellableItems = function (marketId) {
        var msg = '42["event",{"event":{"name":"market","action":"get.sellable-items"},"data":{"marketId":"' + marketId + '"}}]';
        wsSend(msg);
    };
    window.__cor3ValuableSellItems = function (marketId, items) {
        var msg = '42["event",{"event":{"name":"market","action":"sell.items"},"data":{"marketId":"' + marketId + '","items":' + JSON.stringify(items) + '}}]';
        wsSend(msg);
    };

    window.__cor3RequestUpdater = function () {
        console.log('[COR3 Helper] Requesting updater data');
        var msg = '42["event",{"event":{"name":"updater","action":"get.patches"},"data":{}}]';
        wsSend(msg);
    };

    // HOME Market: send get.options + get.lots + get.jobs in parallel batch
    var HOME_MARKET_ID = '019d3ea4-85bd-7389-904d-8f7c85841134';
    window.__cor3RequestMarket = function (callback) {
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Requesting HOME market (batch: options+lots+jobs)');
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
        var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
        // Send all three at once — server processes in order, responses arrive in order
        wsSend(getOptions);
        wsSend(getLots);
        wsSend(getJobs);
        // Wait for COR3_MARKET_FETCH_COMPLETE (fired after get.jobs response is processed)
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                window.removeEventListener('message', onComplete);
                clearTimeout(homeTimer);
                console.log('[COR3 Helper] HOME market fetch aborted (token-expired)');
                return;
            }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'home') {
                window.removeEventListener('message', onComplete);
                clearTimeout(homeTimer);
                console.log('[COR3 Helper] HOME market fetch complete');
                if (callback) callback();
            }
        }
        window.addEventListener('message', onComplete);
        var homeTimer = setTimeout(function () {
            window.removeEventListener('message', onComplete);
            console.log('[COR3 Helper] HOME market fetch timeout');
            if (callback) callback();
        }, 15000);
        return true;
    };

    // D4RK Market: set endpoint first (no room join), then send get.options
    // If no-path-to-server, attempt path-through: hack RM7-E1L5 → RM7-E1SCP → retry D4RK
    var DARK_SERVER_ID = '019d29c5-4b37-79bf-b23e-304d8ea03c15';
    var DARK_MARKET_ID = '019d3ea4-85bd-7389-904d-908ba9194aa0';
    var PATH_THROUGH_SERVERS = [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' }
    ];
    window.__cor3DarkMarketPathThrough = false;

    // Helper: wait for a specific postMessage event type with timeout (MAIN world)
    function __cor3WaitForMsg(eventType, timeoutMs) {
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
            }, timeoutMs || 10000);
        });
    }

    // Ensure access to a server (login status check → hack if needed)
    function __cor3EnsureServerAccess(serverId, serverName) {
        return new Promise(function (resolve, reject) {
            console.log('[COR3 Helper] Path-through: checking access to ' + serverName);
            var getLoginStatus = '42["event",{"event":{"name":"sai","action":"get.login.status"},"data":{"serverId":"' + serverId + '"}}]';
            wsSend(getLoginStatus);
            __cor3WaitForMsg('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000).then(function (loginData) {
                if (loginData.data && loginData.data.activeAccesses && loginData.data.activeAccesses.length > 0) {
                    console.log('[COR3 Helper] Path-through: ' + serverName + ' already has access');
                    resolve();
                    return;
                }
                // Need to hack
                console.log('[COR3 Helper] Path-through: ' + serverName + ' no access — hacking...');
                // Enable decrypt solver for the hack minigame
                window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER' }, '*');
                var hackStart = '42["event",{"event":{"name":"sai","action":"hack.start"},"data":{"serverId":"' + serverId + '"}}]';
                wsSend(hackStart);
                __cor3WaitForMsg('COR3_AUTOJOB_SAI_HACK_START', 30000).then(function (hackData) {
                    if (hackData.error) {
                        reject(new Error(serverName + ' hack failed: ' + (hackData.error.message || JSON.stringify(hackData.error))));
                        return;
                    }
                    console.log('[COR3 Helper] Path-through: ' + serverName + ' hack started, waiting for solver...');
                    // Wait briefly for SAI update, then check login status
                    __cor3WaitForMsg('COR3_AUTOJOB_SAI_UPDATE', 5000).catch(function () {}).then(function () {
                        // Whether SAI update arrived or timed out, check login status
                        var retries = 3;
                        function checkAccess(attempt) {
                            console.log('[COR3 Helper] Path-through: ' + serverName + ' checking access (attempt ' + attempt + '/' + retries + ')');
                            wsSend(getLoginStatus);
                            __cor3WaitForMsg('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000).then(function (data) {
                                if (data.data && data.data.activeAccesses && data.data.activeAccesses.length > 0) {
                                    console.log('[COR3 Helper] Path-through: ' + serverName + ' access confirmed');
                                    resolve();
                                } else if (attempt < retries) {
                                    setTimeout(function () { checkAccess(attempt + 1); }, 3000);
                                } else {
                                    reject(new Error(serverName + ' no access after hack'));
                                }
                            }).catch(function () {
                                if (attempt < retries) {
                                    setTimeout(function () { checkAccess(attempt + 1); }, 3000);
                                } else {
                                    reject(new Error(serverName + ' login status timeout'));
                                }
                            });
                        }
                        setTimeout(function () { checkAccess(1); }, 1500);
                    });
                }).catch(function (e) {
                    reject(new Error(serverName + ' hack start timeout'));
                });
            }).catch(function () {
                reject(new Error(serverName + ' login status timeout'));
            });
        });
    }

    // Full path (all servers) for maintenance checking — includes non-hackable servers
    var DARK_FULL_PATH = [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' },
        { name: 'D4RK RM7MI', id: DARK_SERVER_ID }
    ];
    var SOYUZ_FULL_PATH = [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
        { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
        { name: 'SRM7-N3L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a107' },
        { name: 'SRM7-M', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108' }
    ];
    var USOL_FULL_PATH = [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
        { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' },
        { name: 'URM7-S5L2', id: '019e4052-c317-7388-9d71-85b98a02d5fb' },
        { name: 'URM7-M', id: '019e4052-c317-7388-9d71-883ffb1560cd' }
    ];

    // Fetch network-map and find the first server on `pathServers` that is in maintenance.
    // Returns Promise<{blockerName, maintenanceEndsAt}> or null if none found.
    function __cor3FetchMaintenanceBlocker(pathServers) {
        return new Promise(function (resolve) {
            var getMap = '42["event",{"event":{"name":"network-map","action":"get.map"},"data":{}}]';
            wsSend(getMap);
            var done = false;
            function onMap(evt) {
                if (done) return;
                if (evt.data && evt.data.type === 'COR3_WS_NETWORK_MAP' && evt.data.servers) {
                    done = true;
                    window.removeEventListener('message', onMap);
                    clearTimeout(mapTimer);
                    var servers = evt.data.servers;
                    for (var i = 0; i < pathServers.length; i++) {
                        var info = servers[pathServers[i].id];
                        if (info && info.isInMaintenance) {
                            resolve({ blockerName: pathServers[i].name, maintenanceEndsAt: info.maintenanceEndsAt || null });
                            return;
                        }
                    }
                    resolve(null);
                }
            }
            window.addEventListener('message', onMap);
            var mapTimer = setTimeout(function () {
                if (!done) {
                    done = true;
                    window.removeEventListener('message', onMap);
                    resolve(null);
                }
            }, 8000);
        });
    }

    // Post an UNREACHABLE message with maintenance info fetched from network-map
    function __cor3PostUnreachable(marketType, serverName, pathServers) {
        var msgType = marketType === 'usol' ? 'COR3_WS_USOL_MARKET_UNREACHABLE'
            : marketType === 'soyuz' ? 'COR3_WS_SOYUZ_MARKET_UNREACHABLE' : 'COR3_WS_DARK_MARKET_UNREACHABLE';
        __cor3FetchMaintenanceBlocker(pathServers).then(function (blocker) {
            if (blocker) {
                window.__cor3UnreachableMarkets[marketType] = {
                    blockerName: blocker.blockerName,
                    maintenanceEndsAt: blocker.maintenanceEndsAt,
                    detectedAt: Date.now()
                };
                console.log('[COR3 Helper] Cached unreachable ' + marketType + ': ' + blocker.blockerName + ' maintenance until ' + (blocker.maintenanceEndsAt || 'unknown'));
            }
            window.postMessage({
                type: msgType,
                error: 'no-path-to-server',
                blockerServerName: blocker ? blocker.blockerName : (serverName || null),
                maintenanceEndsAt: blocker ? blocker.maintenanceEndsAt : null
            }, '*');
        });
    }

    // Run path-through: ensure access to intermediate servers, then retry D4RK endpoint
    function __cor3DarkMarketPathThroughRetry() {
        window.__cor3DarkMarketPathThrough = true;
        console.log('[COR3 Helper] Path-through: starting for D4RK market access');

        var serverIndex = 0;
        function processNextServer() {
            if (serverIndex >= PATH_THROUGH_SERVERS.length) {
                // All intermediate servers accessed — retry D4RK endpoint
                // Turn off path-through flag so normal error handling applies
                window.__cor3DarkMarketPathThrough = false;
                console.log('[COR3 Helper] Path-through: all intermediate servers accessed, retrying D4RK endpoint');
                var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + DARK_SERVER_ID + '"}}]';
                wsSend(setEndpoint);
                // Listen for success or unreachable
                var retryDone = false;
                function onRetryResult(evt) {
                    if (retryDone) return;
                    if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                        clearTimeout(retryTimer);
                        console.log('[COR3 Helper] Path-through: D4RK endpoint set successfully');
                        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
                        wsSend(getOptions);
                    }
                    // COR3_WS_DARK_MARKET_UNREACHABLE is already posted by the interceptor (flag is off),
                    // and content.js will pick it up — so just clean up
                    if (evt.data && evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                        clearTimeout(retryTimer);
                        console.log('[COR3 Helper] Path-through: D4RK endpoint still unreachable after path-through');
                    }
                }
                window.addEventListener('message', onRetryResult);
                var retryTimer = setTimeout(function () {
                    if (!retryDone) {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                    }
                }, 10000);
                return;
            }

            var server = PATH_THROUGH_SERVERS[serverIndex];
            console.log('[COR3 Helper] Path-through: setting endpoint to ' + server.name);
            var setEp = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + server.id + '"}}]';
            wsSend(setEp);

            // Wait for endpoint result
            var epDone = false;
            function onEndpoint(evt) {
                if (epDone) return;
                if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                    epDone = true;
                    window.removeEventListener('message', onEndpoint);
                    clearTimeout(epTimer);
                    // Check if endpoint failed (unreachable intermediate server)
                    if (evt.data.success === false) {
                        window.__cor3DarkMarketPathThrough = false;
                        console.log('[COR3 Helper] Path-through: ' + server.name + ' unreachable — aborting');
                        __cor3PostUnreachable('dark', server.name, DARK_FULL_PATH);
                        return;
                    }
                    // Endpoint set — ensure access
                    __cor3EnsureServerAccess(server.id, server.name).then(function () {
                        serverIndex++;
                        processNextServer();
                    }).catch(function (e) {
                        window.__cor3DarkMarketPathThrough = false;
                        console.log('[COR3 Helper] Path-through: ' + server.name + ' access failed — ' + e.message);
                        __cor3PostUnreachable('dark', server.name, DARK_FULL_PATH);
                    });
                }
            }
            window.addEventListener('message', onEndpoint);
            var epTimer = setTimeout(function () {
                if (!epDone) {
                    epDone = true;
                    window.removeEventListener('message', onEndpoint);
                    // Timeout — try to continue (endpoint may already be set)
                    __cor3EnsureServerAccess(server.id, server.name).then(function () {
                        serverIndex++;
                        processNextServer();
                    }).catch(function () {
                        window.__cor3DarkMarketPathThrough = false;
                        __cor3PostUnreachable('dark', server.name, DARK_FULL_PATH);
                    });
                }
            }, 10000);
        }
        processNextServer();
    }

    window.__cor3RequestDarkMarket = function (callback) {
        var cachedUnreachable = window.__cor3IsMarketUnreachable('dark');
        if (cachedUnreachable) {
            console.log('[COR3 Helper] D4RK market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping set.endpoint');
            window.postMessage({
                type: 'COR3_WS_DARK_MARKET_UNREACHABLE',
                error: 'no-path-to-server',
                blockerServerName: cachedUnreachable.blockerName,
                maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
                cached: true
            }, '*');
            if (callback) callback();
            return true;
        }
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Setting D4RK endpoint');
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + DARK_SERVER_ID + '"}}]';
        wsSend(setEndpoint);

        function fetchDarkBatch(cb) {
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                console.log('[COR3 Helper] D4RK market fetch aborted (token-expired)');
                return;
            }
            console.log('[COR3 Helper] Requesting D4RK market (batch: options+lots+jobs)');
            var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
            var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
            var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
            wsSend(getOptions);
            wsSend(getLots);
            wsSend(getJobs);
            function onComplete(evt) {
                if (!evt.data) return;
                if (myAbortId !== __cor3MarketRefreshAbortId) {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] D4RK market fetch aborted (token-expired)');
                    return;
                }
                if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'dark') {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] D4RK market fetch complete');
                    if (cb) cb();
                }
            }
            window.addEventListener('message', onComplete);
            var tmr = setTimeout(function () {
                window.removeEventListener('message', onComplete);
                console.log('[COR3 Helper] D4RK market fetch timeout');
                if (cb) cb();
            }, 15000);
        }

        // Listen for endpoint result or unreachable to decide if path-through is needed
        var handled = false;
        function onDarkEndpoint(evt) {
            if (handled) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                handled = true;
                window.removeEventListener('message', onDarkEndpoint);
                clearTimeout(darkEpTimer);
                console.log('[COR3 Helper] D4RK endpoint aborted (token-expired)');
                return;
            }
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                handled = true;
                window.removeEventListener('message', onDarkEndpoint);
                clearTimeout(darkEpTimer);
                fetchDarkBatch(callback);
            }
            if (evt.data && evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') {
                handled = true;
                window.removeEventListener('message', onDarkEndpoint);
                clearTimeout(darkEpTimer);
                // Try path-through instead of immediately failing
                console.log('[COR3 Helper] D4RK endpoint unreachable — attempting path-through');
                __cor3DarkMarketPathThroughRetry();
                if (callback) callback();
            }
        }
        window.addEventListener('message', onDarkEndpoint);
        var darkEpTimer = setTimeout(function () {
            if (!handled) {
                handled = true;
                window.removeEventListener('message', onDarkEndpoint);
                // Timeout — assume endpoint was set (may already be set), send batch
                console.log('[COR3 Helper] D4RK endpoint timeout — requesting market data anyway');
                fetchDarkBatch(callback);
            }
        }, 5000);
        return true;
    };

    // Market refresh: re-fetch full data (sequential)
    window.__cor3RefreshMarket = function (callback) {
        window.__cor3RequestMarket(callback);
        return true;
    };

    // D4RK Market refresh: re-fetch full data (sequential)
    window.__cor3RefreshDarkMarket = function (callback) {
        window.__cor3RequestDarkMarket(callback);
        return true;
    };

    // SOYUZ Market: set endpoint to SRM7-M server, then send get.options
    // If no-path-to-server, attempt path-through: hack all hackable servers on the way
    // Path: HOME → RM7-E1L3 → RM7-N2ECP → RM7-N2L2 → RM7-N2L3 → RM7-W3NCP → RM7-N1L1 → SRM7-N3L1 → SRM7-M
    // Hackable: RM7-E1L3, RM7-N2ECP, RM7-N2L2, RM7-N2L3, RM7-W3NCP, RM7-N1L1
    // Non-hackable: SRM7-N3L1, SRM7-M (skip these)
    var SOYUZ_SERVER_ID = '019da6f1-16f7-75a6-b6d3-0b1d5f92a108'; // SRM7-M
    var SOYUZ_MARKET_ID = '019da731-2db5-7d76-9447-1ea3b9b78001';
    var SOYUZ_PATH_THROUGH_SERVERS = [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
        { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' }
    ];
    window.__cor3SoyuzMarketPathThrough = false;

    // Run path-through for SOYUZ: ensure access to intermediate hackable servers, then retry
    function __cor3SoyuzMarketPathThroughRetry() {
        window.__cor3SoyuzMarketPathThrough = true;
        console.log('[COR3 Helper] Path-through: starting for SOYUZ market access');

        var serverIndex = 0;
        function processNextServer() {
            if (serverIndex >= SOYUZ_PATH_THROUGH_SERVERS.length) {
                // All hackable intermediate servers accessed — retry SOYUZ endpoint
                window.__cor3SoyuzMarketPathThrough = false;
                console.log('[COR3 Helper] Path-through: all intermediate servers accessed, retrying SOYUZ endpoint');
                var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + SOYUZ_SERVER_ID + '"}}]';
                wsSend(setEndpoint);
                var retryDone = false;
                function onRetryResult(evt) {
                    if (retryDone) return;
                    if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                        clearTimeout(retryTimer);
                        console.log('[COR3 Helper] Path-through: SOYUZ endpoint set successfully');
                        var getOpt = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
                        wsSend(getOpt);
                    }
                    if (evt.data && evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE') {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                        clearTimeout(retryTimer);
                        console.log('[COR3 Helper] Path-through: SOYUZ endpoint still unreachable after path-through');
                    }
                }
                window.addEventListener('message', onRetryResult);
                var retryTimer = setTimeout(function () {
                    if (!retryDone) {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                    }
                }, 10000);
                return;
            }

            var server = SOYUZ_PATH_THROUGH_SERVERS[serverIndex];
            console.log('[COR3 Helper] Path-through: setting endpoint to ' + server.name);
            var setEp = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + server.id + '"}}]';
            wsSend(setEp);

            var epDone = false;
            function onEndpoint(evt) {
                if (epDone) return;
                if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                    epDone = true;
                    window.removeEventListener('message', onEndpoint);
                    clearTimeout(epTimer);
                    if (evt.data.success === false) {
                        window.__cor3SoyuzMarketPathThrough = false;
                        console.log('[COR3 Helper] Path-through: ' + server.name + ' unreachable — aborting');
                        __cor3PostUnreachable('soyuz', server.name, SOYUZ_FULL_PATH);
                        return;
                    }
                    __cor3EnsureServerAccess(server.id, server.name).then(function () {
                        serverIndex++;
                        processNextServer();
                    }).catch(function (e) {
                        window.__cor3SoyuzMarketPathThrough = false;
                        console.log('[COR3 Helper] Path-through: ' + server.name + ' access failed — ' + e.message);
                        __cor3PostUnreachable('soyuz', server.name, SOYUZ_FULL_PATH);
                    });
                }
            }
            window.addEventListener('message', onEndpoint);
            var epTimer = setTimeout(function () {
                if (!epDone) {
                    epDone = true;
                    window.removeEventListener('message', onEndpoint);
                    __cor3EnsureServerAccess(server.id, server.name).then(function () {
                        serverIndex++;
                        processNextServer();
                    }).catch(function () {
                        window.__cor3SoyuzMarketPathThrough = false;
                        __cor3PostUnreachable('soyuz', server.name, SOYUZ_FULL_PATH);
                    });
                }
            }, 10000);
        }
        processNextServer();
    }

    window.__cor3RequestSoyuzMarket = function (callback) {
        var cachedUnreachable = window.__cor3IsMarketUnreachable('soyuz');
        if (cachedUnreachable) {
            console.log('[COR3 Helper] SOYUZ market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping set.endpoint');
            window.postMessage({
                type: 'COR3_WS_SOYUZ_MARKET_UNREACHABLE',
                error: 'no-path-to-server',
                blockerServerName: cachedUnreachable.blockerName,
                maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
                cached: true
            }, '*');
            if (callback) callback();
            return true;
        }
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Setting SOYUZ endpoint');
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + SOYUZ_SERVER_ID + '"}}]';
        window.__cor3SoyuzMarketPending = true;
        wsSend(setEndpoint);

        function fetchSoyuzBatch(cb) {
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                console.log('[COR3 Helper] SOYUZ market fetch aborted (token-expired)');
                return;
            }
            console.log('[COR3 Helper] Requesting SOYUZ market (batch: options+lots+jobs)');
            var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
            var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
            var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
            wsSend(getOptions);
            wsSend(getLots);
            wsSend(getJobs);
            function onComplete(evt) {
                if (!evt.data) return;
                if (myAbortId !== __cor3MarketRefreshAbortId) {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] SOYUZ market fetch aborted (token-expired)');
                    return;
                }
                if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'soyuz') {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] SOYUZ market fetch complete');
                    if (cb) cb();
                }
            }
            window.addEventListener('message', onComplete);
            var tmr = setTimeout(function () {
                window.removeEventListener('message', onComplete);
                console.log('[COR3 Helper] SOYUZ market fetch timeout');
                if (cb) cb();
            }, 15000);
        }

        var handled = false;
        function onSoyuzEndpoint(evt) {
            if (handled) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                handled = true;
                window.removeEventListener('message', onSoyuzEndpoint);
                clearTimeout(soyuzEpTimer);
                window.__cor3SoyuzMarketPending = false;
                console.log('[COR3 Helper] SOYUZ endpoint aborted (token-expired)');
                return;
            }
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                handled = true;
                window.removeEventListener('message', onSoyuzEndpoint);
                clearTimeout(soyuzEpTimer);
                window.__cor3SoyuzMarketPending = false;
                fetchSoyuzBatch(callback);
            }
            if (evt.data && evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE') {
                handled = true;
                window.removeEventListener('message', onSoyuzEndpoint);
                clearTimeout(soyuzEpTimer);
                window.__cor3SoyuzMarketPending = false;
                // Try path-through instead of immediately failing
                console.log('[COR3 Helper] SOYUZ endpoint unreachable — attempting path-through');
                __cor3SoyuzMarketPathThroughRetry();
                if (callback) callback();
            }
        }
        window.addEventListener('message', onSoyuzEndpoint);
        var soyuzEpTimer = setTimeout(function () {
            if (!handled) {
                handled = true;
                window.removeEventListener('message', onSoyuzEndpoint);
                window.__cor3SoyuzMarketPending = false;
                console.log('[COR3 Helper] SOYUZ endpoint timeout');
                if (callback) callback();
            }
        }, 10000);
        return true;
    };

    // SOYUZ Market refresh: re-fetch full data (sequential)
    window.__cor3RefreshSoyuzMarket = function (callback) {
        window.__cor3RequestSoyuzMarket(callback);
        return true;
    };

    // USOL Market: set endpoint to URM7-M server, then send get.options
    // Path: HOME → RM7-E1L5 → RM7-E1SCP → RM7-S4L2 → RM7-S4L3 → URM7-S5L2 → URM7-M
    // Hackable: RM7-E1L5, RM7-E1SCP, RM7-S4L2, RM7-S4L3, URM7-S5L2
    // Non-hackable: URM7-M (market server)
    var USOL_SERVER_ID = '019e4052-c317-7388-9d71-883ffb1560cd'; // URM7-M
    var USOL_MARKET_ID = '019e4065-6ae8-760d-8724-58ab4f2cf7d7';
    var USOL_PATH_THROUGH_SERVERS = [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
        { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' },
        { name: 'URM7-S5L2', id: '019e4052-c317-7388-9d71-85b98a02d5fb' }
    ];
    window.__cor3UsolMarketPathThrough = false;

    // Run path-through for USOL: ensure access to intermediate hackable servers, then retry
    function __cor3UsolMarketPathThroughRetry() {
        window.__cor3UsolMarketPathThrough = true;
        console.log('[COR3 Helper] Path-through: starting for USOL market access');

        var serverIndex = 0;
        function processNextServer() {
            if (serverIndex >= USOL_PATH_THROUGH_SERVERS.length) {
                window.__cor3UsolMarketPathThrough = false;
                console.log('[COR3 Helper] Path-through: all intermediate servers accessed, retrying USOL endpoint');
                var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + USOL_SERVER_ID + '"}}]';
                wsSend(setEndpoint);
                var retryDone = false;
                function onRetryResult(evt) {
                    if (retryDone) return;
                    if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                        clearTimeout(retryTimer);
                        console.log('[COR3 Helper] Path-through: USOL endpoint set successfully');
                        var getOpt = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
                        wsSend(getOpt);
                    }
                    if (evt.data && evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                        clearTimeout(retryTimer);
                        console.log('[COR3 Helper] Path-through: USOL endpoint still unreachable after path-through');
                    }
                }
                window.addEventListener('message', onRetryResult);
                var retryTimer = setTimeout(function () {
                    if (!retryDone) {
                        retryDone = true;
                        window.removeEventListener('message', onRetryResult);
                    }
                }, 10000);
                return;
            }

            var server = USOL_PATH_THROUGH_SERVERS[serverIndex];
            console.log('[COR3 Helper] Path-through: setting endpoint to ' + server.name);
            var setEp = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + server.id + '"}}]';
            wsSend(setEp);

            var epDone = false;
            function onEndpoint(evt) {
                if (epDone) return;
                if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                    epDone = true;
                    window.removeEventListener('message', onEndpoint);
                    clearTimeout(epTimer);
                    if (evt.data.success === false) {
                        window.__cor3UsolMarketPathThrough = false;
                        console.log('[COR3 Helper] Path-through: ' + server.name + ' unreachable — aborting');
                        __cor3PostUnreachable('usol', server.name, USOL_FULL_PATH);
                        return;
                    }
                    __cor3EnsureServerAccess(server.id, server.name).then(function () {
                        serverIndex++;
                        processNextServer();
                    }).catch(function (e) {
                        window.__cor3UsolMarketPathThrough = false;
                        console.log('[COR3 Helper] Path-through: ' + server.name + ' access failed — ' + e.message);
                        __cor3PostUnreachable('usol', server.name, USOL_FULL_PATH);
                    });
                }
            }
            window.addEventListener('message', onEndpoint);
            var epTimer = setTimeout(function () {
                if (!epDone) {
                    epDone = true;
                    window.removeEventListener('message', onEndpoint);
                    __cor3EnsureServerAccess(server.id, server.name).then(function () {
                        serverIndex++;
                        processNextServer();
                    }).catch(function () {
                        window.__cor3UsolMarketPathThrough = false;
                        __cor3PostUnreachable('usol', server.name, USOL_FULL_PATH);
                    });
                }
            }, 10000);
        }
        processNextServer();
    }

    window.__cor3RequestUsolMarket = function (callback) {
        var cachedUnreachable = window.__cor3IsMarketUnreachable('usol');
        if (cachedUnreachable) {
            console.log('[COR3 Helper] USOL market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping set.endpoint');
            window.postMessage({
                type: 'COR3_WS_USOL_MARKET_UNREACHABLE',
                error: 'no-path-to-server',
                blockerServerName: cachedUnreachable.blockerName,
                maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
                cached: true
            }, '*');
            if (callback) callback();
            return true;
        }
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Setting USOL endpoint');
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + USOL_SERVER_ID + '"}}]';
        window.__cor3UsolMarketPending = true;
        wsSend(setEndpoint);

        function fetchUsolBatch(cb) {
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                console.log('[COR3 Helper] USOL market fetch aborted (token-expired)');
                return;
            }
            console.log('[COR3 Helper] Requesting USOL market (batch: options+lots+jobs)');
            var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
            var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
            var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
            wsSend(getOptions);
            wsSend(getLots);
            wsSend(getJobs);
            function onComplete(evt) {
                if (!evt.data) return;
                if (myAbortId !== __cor3MarketRefreshAbortId) {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] USOL market fetch aborted (token-expired)');
                    return;
                }
                if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'usol') {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] USOL market fetch complete');
                    if (cb) cb();
                }
            }
            window.addEventListener('message', onComplete);
            var tmr = setTimeout(function () {
                window.removeEventListener('message', onComplete);
                console.log('[COR3 Helper] USOL market fetch timeout');
                if (cb) cb();
            }, 15000);
        }

        var handled = false;
        function onUsolEndpoint(evt) {
            if (handled) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                handled = true;
                window.removeEventListener('message', onUsolEndpoint);
                clearTimeout(usolEpTimer);
                window.__cor3UsolMarketPending = false;
                console.log('[COR3 Helper] USOL endpoint aborted (token-expired)');
                return;
            }
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                handled = true;
                window.removeEventListener('message', onUsolEndpoint);
                clearTimeout(usolEpTimer);
                window.__cor3UsolMarketPending = false;
                fetchUsolBatch(callback);
            }
            if (evt.data && evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
                handled = true;
                window.removeEventListener('message', onUsolEndpoint);
                clearTimeout(usolEpTimer);
                window.__cor3UsolMarketPending = false;
                console.log('[COR3 Helper] USOL endpoint unreachable — attempting path-through');
                __cor3UsolMarketPathThroughRetry();
                if (callback) callback();
            }
        }
        window.addEventListener('message', onUsolEndpoint);
        var usolEpTimer = setTimeout(function () {
            if (!handled) {
                handled = true;
                window.removeEventListener('message', onUsolEndpoint);
                window.__cor3UsolMarketPending = false;
                console.log('[COR3 Helper] USOL endpoint timeout');
                if (callback) callback();
            }
        }, 10000);
        return true;
    };

    // USOL Market refresh: re-fetch full data (sequential)
    window.__cor3RefreshUsolMarket = function (callback) {
        window.__cor3RequestUsolMarket(callback);
        return true;
    };

    // --- Sequential all-markets refresh (one at a time: USOL → SOYUZ → D4RK → HOME) ---
    // Each market fully completes (set.endpoint → batch options+lots+jobs) before the next starts.
    // This prevents interleaved WS messages that confuse the server and our response handlers.
    // On token-expired, the abortId check stops the sequence.
    window.__cor3RefreshAllMarketsSequential = function (callback, opts) {
        opts = opts || {};
        var order = opts.order || ['usol', 'soyuz', 'dark', 'home']; // default: furthest first
        var skipLots = !!opts.skipLots; // auto-jobs mode: skip get.lots
        var idx = 0;
        var myAbortId = __cor3MarketRefreshAbortId;

        function refreshNext() {
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                console.log('[COR3 Helper] Sequential refresh aborted (token-expired)');
                window.postMessage({ type: 'COR3_ALL_MARKETS_REFRESHED' }, '*');
                return;
            }
            if (idx >= order.length) {
                console.log('[COR3 Helper] Sequential refresh: all markets done');
                window.postMessage({ type: 'COR3_ALL_MARKETS_REFRESHED' }, '*');
                if (callback) callback();
                return;
            }
            var market = order[idx];
            idx++;
            console.log('[COR3 Helper] Sequential refresh: starting ' + market.toUpperCase());
            if (market === 'usol') {
                if (skipLots) {
                    window.__cor3RequestUsolMarketJobsOnly(function () { refreshNext(); });
                } else {
                    window.__cor3RequestUsolMarket(function () { refreshNext(); });
                }
            } else if (market === 'soyuz') {
                if (skipLots) {
                    window.__cor3RequestSoyuzMarketJobsOnly(function () { refreshNext(); });
                } else {
                    window.__cor3RequestSoyuzMarket(function () { refreshNext(); });
                }
            } else if (market === 'dark') {
                if (skipLots) {
                    window.__cor3RequestDarkMarketJobsOnly(function () { refreshNext(); });
                } else {
                    window.__cor3RequestDarkMarket(function () { refreshNext(); });
                }
            } else {
                if (skipLots) {
                    window.__cor3RequestMarketJobsOnly(function () { refreshNext(); });
                } else {
                    window.__cor3RequestMarket(function () { refreshNext(); });
                }
            }
        }
        refreshNext();
        return true;
    };

    // --- Jobs-only market fetch variants (get.options + get.jobs in parallel, skip get.lots) ---
    // Used by auto-jobs refresh to reduce unnecessary WS traffic.

    window.__cor3RequestMarketJobsOnly = function (callback) {
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Requesting HOME market (batch: options+jobs, jobs-only)');
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
        wsSend(getOptions);
        wsSend(getJobs);
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                return;
            }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'home') {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                console.log('[COR3 Helper] HOME market jobs-only fetch complete');
                if (callback) callback();
            }
        }
        window.addEventListener('message', onComplete);
        var tmr = setTimeout(function () {
            window.removeEventListener('message', onComplete);
            console.log('[COR3 Helper] HOME market jobs-only fetch timeout');
            if (callback) callback();
        }, 15000);
    };

    window.__cor3RequestDarkMarketJobsOnly = function (callback) {
        var cachedUnreachable = window.__cor3IsMarketUnreachable('dark');
        if (cachedUnreachable) {
            console.log('[COR3 Helper] D4RK market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping jobs-only');
            window.postMessage({
                type: 'COR3_WS_DARK_MARKET_UNREACHABLE',
                error: 'no-path-to-server',
                blockerServerName: cachedUnreachable.blockerName,
                maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
                cached: true
            }, '*');
            if (callback) callback();
            return true;
        }
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Setting D4RK endpoint (jobs-only)');
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + DARK_SERVER_ID + '"}}]';
        wsSend(setEndpoint);

        function fetchDarkJobsBatch(cb) {
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                console.log('[COR3 Helper] D4RK market jobs-only fetch aborted (token-expired)');
                return;
            }
            console.log('[COR3 Helper] Requesting D4RK market (batch: options+jobs, jobs-only)');
            var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
            var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
            wsSend(getOptions);
            wsSend(getJobs);
            function onComplete(evt) {
                if (!evt.data) return;
                if (myAbortId !== __cor3MarketRefreshAbortId) {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    return;
                }
                if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'dark') {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] D4RK market jobs-only fetch complete');
                    if (cb) cb();
                }
            }
            window.addEventListener('message', onComplete);
            var tmr = setTimeout(function () {
                window.removeEventListener('message', onComplete);
                console.log('[COR3 Helper] D4RK market jobs-only fetch timeout');
                if (cb) cb();
            }, 15000);
        }

        var handled = false;
        function onEndpoint(evt) {
            if (handled) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                return;
            }
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                fetchDarkJobsBatch(callback);
            }
            if (evt.data && evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                console.log('[COR3 Helper] D4RK endpoint unreachable (jobs-only) — attempting path-through');
                __cor3DarkMarketPathThroughRetry();
                if (callback) callback();
            }
        }
        window.addEventListener('message', onEndpoint);
        var epTmr = setTimeout(function () {
            if (!handled) {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                console.log('[COR3 Helper] D4RK endpoint timeout (jobs-only) — requesting data anyway');
                fetchDarkJobsBatch(callback);
            }
        }, 5000);
    };

    window.__cor3RequestSoyuzMarketJobsOnly = function (callback) {
        var cachedUnreachable = window.__cor3IsMarketUnreachable('soyuz');
        if (cachedUnreachable) {
            console.log('[COR3 Helper] SOYUZ market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping jobs-only');
            window.postMessage({
                type: 'COR3_WS_SOYUZ_MARKET_UNREACHABLE',
                error: 'no-path-to-server',
                blockerServerName: cachedUnreachable.blockerName,
                maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
                cached: true
            }, '*');
            if (callback) callback();
            return true;
        }
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Setting SOYUZ endpoint (jobs-only)');
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + SOYUZ_SERVER_ID + '"}}]';
        window.__cor3SoyuzMarketPending = true;
        wsSend(setEndpoint);

        function fetchSoyuzJobsBatch(cb) {
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                console.log('[COR3 Helper] SOYUZ market jobs-only fetch aborted (token-expired)');
                return;
            }
            console.log('[COR3 Helper] Requesting SOYUZ market (batch: options+jobs, jobs-only)');
            var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
            var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
            wsSend(getOptions);
            wsSend(getJobs);
            function onComplete(evt) {
                if (!evt.data) return;
                if (myAbortId !== __cor3MarketRefreshAbortId) {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    return;
                }
                if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'soyuz') {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] SOYUZ market jobs-only fetch complete');
                    if (cb) cb();
                }
            }
            window.addEventListener('message', onComplete);
            var tmr = setTimeout(function () {
                window.removeEventListener('message', onComplete);
                console.log('[COR3 Helper] SOYUZ market jobs-only fetch timeout');
                if (cb) cb();
            }, 15000);
        }

        var handled = false;
        function onEndpoint(evt) {
            if (handled) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                window.__cor3SoyuzMarketPending = false;
                return;
            }
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                window.__cor3SoyuzMarketPending = false;
                fetchSoyuzJobsBatch(callback);
            }
            if (evt.data && evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE') {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                window.__cor3SoyuzMarketPending = false;
                console.log('[COR3 Helper] SOYUZ endpoint unreachable (jobs-only) — attempting path-through');
                __cor3SoyuzMarketPathThroughRetry();
                if (callback) callback();
            }
        }
        window.addEventListener('message', onEndpoint);
        var epTmr = setTimeout(function () {
            if (!handled) {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                window.__cor3SoyuzMarketPending = false;
                console.log('[COR3 Helper] SOYUZ endpoint timeout (jobs-only)');
                if (callback) callback();
            }
        }, 10000);
    };

    window.__cor3RequestUsolMarketJobsOnly = function (callback) {
        var cachedUnreachable = window.__cor3IsMarketUnreachable('usol');
        if (cachedUnreachable) {
            console.log('[COR3 Helper] USOL market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping jobs-only');
            window.postMessage({
                type: 'COR3_WS_USOL_MARKET_UNREACHABLE',
                error: 'no-path-to-server',
                blockerServerName: cachedUnreachable.blockerName,
                maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
                cached: true
            }, '*');
            if (callback) callback();
            return true;
        }
        var myAbortId = __cor3MarketRefreshAbortId;
        console.log('[COR3 Helper] Setting USOL endpoint (jobs-only)');
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + USOL_SERVER_ID + '"}}]';
        window.__cor3UsolMarketPending = true;
        wsSend(setEndpoint);

        function fetchUsolJobsBatch(cb) {
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                console.log('[COR3 Helper] USOL market jobs-only fetch aborted (token-expired)');
                return;
            }
            console.log('[COR3 Helper] Requesting USOL market (batch: options+jobs, jobs-only)');
            var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
            var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
            wsSend(getOptions);
            wsSend(getJobs);
            function onComplete(evt) {
                if (!evt.data) return;
                if (myAbortId !== __cor3MarketRefreshAbortId) {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    return;
                }
                if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'usol') {
                    window.removeEventListener('message', onComplete);
                    clearTimeout(tmr);
                    console.log('[COR3 Helper] USOL market jobs-only fetch complete');
                    if (cb) cb();
                }
            }
            window.addEventListener('message', onComplete);
            var tmr = setTimeout(function () {
                window.removeEventListener('message', onComplete);
                console.log('[COR3 Helper] USOL market jobs-only fetch timeout');
                if (cb) cb();
            }, 15000);
        }

        var handled = false;
        function onEndpoint(evt) {
            if (handled) return;
            if (myAbortId !== __cor3MarketRefreshAbortId) {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                window.__cor3UsolMarketPending = false;
                return;
            }
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                window.__cor3UsolMarketPending = false;
                fetchUsolJobsBatch(callback);
            }
            if (evt.data && evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                clearTimeout(epTmr);
                window.__cor3UsolMarketPending = false;
                console.log('[COR3 Helper] USOL endpoint unreachable (jobs-only) — attempting path-through');
                __cor3UsolMarketPathThroughRetry();
                if (callback) callback();
            }
        }
        window.addEventListener('message', onEndpoint);
        var epTmr = setTimeout(function () {
            if (!handled) {
                handled = true;
                window.removeEventListener('message', onEndpoint);
                window.__cor3UsolMarketPending = false;
                console.log('[COR3 Helper] USOL endpoint timeout (jobs-only)');
                if (callback) callback();
            }
        }, 10000);
    };

    // Auto-fetch all data on page load (called when WS opens)
    var initialFetchDone = false;
    window.__cor3ResetInitialFetch = function () {
        initialFetchDone = false;
        console.log('[COR3 Helper] Reset initial fetch flag for reconnect');
    };
    // Flag: initial merc fetch complete (markets + mercs all done)
    window.__cor3InitialMercsFetchDone = false;

    window.__cor3InitialFetch = function () {
        if (initialFetchDone) return;
        initialFetchDone = true;
        window.__cor3InitialMercsFetchDone = false;
        window.__cor3InitialFetchInProgress = true;
        console.log('[COR3 Helper] Running initial data fetch (page load)');

        // Trigger daily ops fetch via content script
        window.postMessage({ type: 'COR3_FETCH_DAILY_OPS' }, '*');

        // Follow Refresh All order:
        // 1. Markets sequentially: HOME → D4RK → SOYUZ → USOL
        // 2. Expedition data (server auto-provides via room join — no explicit request needed)
        // 3. Stash (inventory)
        // 4. CORE mercs → USOL mercs
        // 5. Archived expeditions
        // 6. Loadout
        // 7. Updater
        window.__cor3RequestMarket(function () {
            console.log('[COR3 Helper] Initial: HOME done, starting D4RK');
            window.__cor3RequestDarkMarket(function () {
                console.log('[COR3 Helper] Initial: D4RK done, starting SOYUZ');
                window.__cor3RequestSoyuzMarket(function () {
                    console.log('[COR3 Helper] Initial: SOYUZ done, starting USOL');
                    window.__cor3RequestUsolMarket(function () {
                        console.log('[COR3 Helper] Initial: All markets fetched');
                        // Expedition data already received from server room join — no request needed
                        // Notify content script that expedition data can be rendered
                        window.postMessage({ type: 'COR3_WS_EXPEDITIONS_READY' }, '*');
                        // Fetch stash (inventory)
                        setTimeout(function () {
                            window.__cor3RequestStash();
                        }, humanDelay());
                        // Fetch specialists data (stash expansion timers) after stash
                        setTimeout(function () {
                            window.__cor3RequestSpecialists();
                        }, humanDelay() + 500);
                        // CORE mercs after stash
                        setTimeout(function () {
                            console.log('[COR3 Helper] Initial: Starting CORE mercs');
                            window.__cor3RequestMercenaries(null, function () {
                                window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
                                console.log('[COR3 Helper] Initial: CORE mercs done, starting USOL mercs');
                                // USOL mercs after CORE done
                                setTimeout(function () {
                                    window.__cor3RequestUsolMercenaries(function () {
                                        window.postMessage({ type: 'COR3_USOL_MERCS_DONE' }, '*');
                                        window.__cor3InitialMercsFetchDone = true;
                                        console.log('[COR3 Helper] Initial: All mercs done');
                                        // Archived expeditions after mercs
                                        setTimeout(function () {
                                            window.__cor3RequestArchivedExpeditions();
                                        }, humanDelay());
                                        // Loadout after archived
                                        setTimeout(function () {
                                            window.__cor3RequestLoadout();
                                        }, 2000);
                                        // Updater
                                        setTimeout(function () {
                                            window.__cor3RequestUpdater();
                                            window.__cor3InitialFetchInProgress = false;
                                            console.log('[COR3 Helper] Initial data fetch complete');
                                            window.postMessage({ type: 'COR3_INITIAL_FETCH_DONE' }, '*');
                                        }, 3500);
                                    });
                                }, humanDelay());
                            });
                        }, 2500);
                    });
                });
            });
        });
    };

    window.__cor3KeepAlive = function () {
        console.log('[COR3 Helper] Keeping service worker alive!');
    };

    // Periodic socket health check: clean up dead sockets and detect stale connections
    setInterval(function () {
        const now = Date.now();
        // Clean up CLOSED sockets that weren't properly removed
        for (var i = trackedSockets.length - 1; i >= 0; i--) {
            var ws = trackedSockets[i];
            if (ws.readyState === OrigWebSocket.CLOSED || ws.readyState === OrigWebSocket.CLOSING) {
                console.log('[COR3 Helper] Cleaning up dead socket');
                trackedSockets.splice(i, 1);
                socketLastActivity.delete(ws);
                if (activeSocket === ws) activeSocket = null;
            }
        }
        // Warn if activeSocket hasn't received messages in 90s
        if (activeSocket) {
            var lastActivity = socketLastActivity.get(activeSocket) || 0;
            if (now - lastActivity > 90000) {
                console.log('[COR3 Helper] Active socket stale (no messages for 90s) — may need reconnect');
            }
        }
    }, 60000);

    // Listen for requests from content script
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'COR3_REQUEST_EXPEDITIONS') {
            window.__cor3RequestExpeditions();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_STASH') {
            window.__cor3RequestStash();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_SPECIALISTS') {
            window.__cor3RequestSpecialists();
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

    // Re-post version data after content.js is loaded (document_idle).
    // The initial postMessage calls may fire before content.js listener is ready.
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

    console.log('[COR3 Helper] WebSocket interceptor installed');
})();
