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
                else if (op === 'market') window.__cor3RequestMarket();
                else if (op === 'darkMarket') window.__cor3RequestDarkMarket();
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
            if (url.includes('cor3') || url.includes('corie')) {
                let headers = init && init.headers;
                if (!headers && input && input.headers) headers = input.headers;
                if (headers) {
                    let authVal = null;
                    if (typeof headers.get === 'function') {
                        authVal = headers.get('Authorization') || headers.get('authorization');
                    } else if (typeof headers === 'object') {
                        authVal = headers['Authorization'] || headers['authorization'];
                    }
                    if (authVal && authVal.startsWith('Bearer ')) {
                        capturedBearerToken = authVal;
                        window.postMessage({ type: 'COR3_BEARER_TOKEN', token: authVal }, '*');
                    }
                }
            }
            // Intercept translation.json for webVersion
            if (url.includes('translation.json')) { // url = /locales/tr/translation.json?v=v1.17.21
                try {
                    const parsedUrl = new URL(url, window.location.origin);
                    if (!webVersion) {
                        webVersion = parsedUrl.searchParams.get('v');
                    }
                    console.log('[COR3 Helper] Captured web version from translation.json:', webVersion);
                    window.__cor3WebVersion = webVersion;
                } catch (e) {
                    console.log('[COR3 Helper] Error parsing version:', e);
                }
            }
        } catch (e) { /* silent */ }

        // Intercept users/me response for systemVersion
        var result = OrigFetch.apply(this, args);
        try {
            var fetchUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            if (fetchUrl.includes('api/users/me')) {
                result.then(function (resp) {
                    if (resp && resp.ok) {
                        resp.clone().json().then(function (data) {
                            if (data && data.systemVersion !== undefined) {
                                console.log('[COR3 Helper] Captured system version from api/users/me:', data.systemVersion);
                                window.__cor3SystemVersion = data.systemVersion;
                                window.postMessage({ type: 'COR3_SYSTEM_VERSION', version: data.systemVersion }, '*');
                                if (webVersion) {
                                    window.postMessage({ type: 'COR3_WEB_VERSION', version: webVersion }, '*');
                                }
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

    const OrigXHROpen = XMLHttpRequest.prototype.open;
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

    // Use a Proxy so both `new WebSocket(...)` and instanceof checks work correctly
    const WebSocketProxy = new Proxy(OrigWebSocket, {
        construct(target, args) {
            const ws = new target(...args);
            const url = args[0] || '';

            if (url.includes('cor3') || url.includes('corie')) {
                console.log('[COR3 Helper] Tracking WebSocket:', url);
                ws.__cor3Url = url;
                trackedSockets.push(ws);

                ws.addEventListener('message', function (event) {
                    try {
                        // Mark this socket as active and update last activity time
                        if (activeSocket !== ws) {
                            console.log('[COR3 Helper] Active socket changed to:', ws.__cor3Url);
                            activeSocket = ws;
                        }
                        socketLastActivity.set(ws, Date.now());
                        handleWsMessage(event.data, ws);
                    } catch (e) {
                        // silent
                    }
                });

                // Auto-fetch all data when WS connects (page load/reload)
                ws.addEventListener('open', function () {
                    console.log('[COR3 Helper] WS connected — scheduling initial data fetch');
                    // Wait for connection to stabilize, then fetch all data
                    setTimeout(function () {
                        // If this is a reconnect after token-expired, retry pending ops
                        if (tokenExpiredFlag || pendingRetryOps.length > 0) {
                            setTimeout(function () { runPendingRetries(); }, 2000);
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

    function handleWsMessage(rawData, socket) {
        if (typeof rawData !== 'string') return;

        // Log inbound WS message to content.js for storage
        if (rawData.startsWith('42')) {
            window.postMessage({ type: 'COR3_WS_LOG', direction: 'received', message: rawData }, '*');
        }

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
            // Queue all data fetches for retry after reconnect
            queueRetryOp('expeditions');
            queueRetryOp('market');
            queueRetryOp('darkMarket');
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
                    console.warn('[COR3 Helper] No new WebSocket connected after token-expired close — game may need page refresh');
                } else {
                    console.log('[COR3 Helper] WebSocket reconnected after token-expired');
                }
            }, 15000);
            return;
        }

        // Intercept stash (inventory) responses
        if (eventName === 'stash' && payload && payload.data) {
            window.postMessage({
                type: 'COR3_WS_STASH',
                stash: payload.data
            }, '*');
        }

        // Intercept mercenary responses
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'get.mercenaries') {
            // Cache mercenary IDs for configure calls
            if (payload.data && payload.data.mercenaries) {
                window.__cor3CachedMercIds = payload.data.mercenaries.map(function (m) { return m.id; });
            }
            window.postMessage({
                type: 'COR3_WS_MERCENARIES',
                data: payload.data
            }, '*');
            // Auto-request expedition config if not already cached
            if (!window.__cor3ExpConfigIds) {
                setTimeout(function () {
                    window.__cor3RequestExpeditionConfig();
                }, 500);
            } else if (window.__cor3CachedMercIds) {
                // Config already available, configure each merc sequentially with human delays
                var ids = window.__cor3ExpConfigIds;
                var mercIds = window.__cor3CachedMercIds.slice();
                (function configureNext(i) {
                    if (i >= mercIds.length) return;
                    setTimeout(function () {
                        window.__cor3RequestMercConfigure(mercIds[i], null, ids.locationConfigId, ids.zoneConfigId, ids.objectiveId);
                        configureNext(i + 1);
                    }, humanDelay() + 400);
                })(0);
            }
            return;
        }

        // Intercept expedition config response (locations/zones/objectives)
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'get.config') {
            // Store config IDs for mercenary configure calls
            if (payload.data && payload.data.locations && payload.data.locations.length > 0) {
                var loc = payload.data.locations[0];
                window.__cor3ExpConfigIds = {
                    locationConfigId: loc.id,
                    zoneConfigId: loc.zones && loc.zones[0] ? loc.zones[0].id : null,
                    objectiveId: loc.zones && loc.zones[0] && loc.zones[0].objectives && loc.zones[0].objectives[0] ? loc.zones[0].objectives[0].id : null
                };
            }
            window.postMessage({
                type: 'COR3_WS_EXPEDITION_CONFIG',
                data: payload.data
            }, '*');
            // If mercenaries are cached, auto-configure each sequentially with human delays
            if (window.__cor3CachedMercIds && window.__cor3ExpConfigIds) {
                var ids = window.__cor3ExpConfigIds;
                var mercIds = window.__cor3CachedMercIds.slice();
                (function configureNext(i) {
                    if (i >= mercIds.length) return;
                    setTimeout(function () {
                        window.__cor3RequestMercConfigure(mercIds[i], null, ids.locationConfigId, ids.zoneConfigId, ids.objectiveId);
                        configureNext(i + 1);
                    }, humanDelay() + 400);
                })(0);
            }
            return;
        }

        // Intercept open.container response
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'open.container') {
            window.postMessage({
                type: 'COR3_WS_CONTAINER_OPENED',
                data: payload.data
            }, '*');
            return;
        }

        // Intercept collect.all response
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'collect.all') {
            // Check for stash full error
            if (payload.error && payload.error.message === 'stash.error.insufficient_capacity') {
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
            }
            return;
        }

        // Intercept launch response
        if (eventName === 'expeditions' && payload && payload.event && payload.event.action === 'launch') {
            // Check for launch errors
            if (payload.error && payload.error.message === 'Maximum 1 active expedition allowed') {
                console.log('[COR3 Helper] Expedition launch failed: Maximum 1 active expedition allowed');
                window.postMessage({
                    type: 'COR3_WS_EXPEDITION_LAUNCH_ERROR',
                    error: payload.error.message,
                    retryAfter: 120000 // 2 minutes in milliseconds
                }, '*');
                // Schedule retry after 2 minutes
                setTimeout(function() {
                    console.log('[COR3 Helper] Retrying expedition launch after 2 minutes');
                    window.postMessage({
                        type: 'COR3_WS_EXPEDITION_RETRY_LAUNCH',
                        retryData: payload.requestId
                    }, '*');
                }, 120000);
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
            // Immediately request fresh expedition data to update UI and reset 30-second timer
            setTimeout(function() {
                window.__cor3RequestExpeditions();
            }, 1000 + Math.floor(Math.random() * 500));
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

        // Intercept market responses — only relay actual market data (not "connected" acks)
        if (eventName === 'market' && payload && payload.data) {
            var mkt = payload.data.market;
            // Skip connection acknowledgments (action: "connected") — they don't contain real market data
            if (mkt && mkt.marketName) {
                if (mkt.id === '019d3ea4-85bd-7389-904d-908ba9194aa0') {
                    window.postMessage({
                        type: 'COR3_WS_DARK_MARKET',
                        market: payload.data
                    }, '*');
                } else {
                    window.postMessage({
                        type: 'COR3_WS_MARKET',
                        market: payload.data
                    }, '*');
                    // Store HOME market ID (mercenary fetch removed — now handled by Refresh All)
                    window.__cor3LastMarketId = mkt.id;
                }
            }
        }

        // Intercept network-map responses (endpoint set success/failure)
        // detect no-path-to-server error for dark market
        if (eventName === 'network-map' && payload && payload.event) {
            if (payload.event.action === 'set.endpoint') {
                if (payload.error && payload.error.message === 'no-path-to-server') {
                    console.log('[COR3 Helper] D4RK market unreachable: no-path-to-server');
                    window.postMessage({
                        type: 'COR3_WS_DARK_MARKET_UNREACHABLE',
                        error: payload.error.message,
                        serverId: payload.error.serverId
                    }, '*');
                } else {
                    var success = !payload.error;
                    window.postMessage({
                        type: 'COR3_WS_ENDPOINT_RESULT',
                        success: success,
                        data: payload.data
                    }, '*');
                }
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

    // Request mercenary data (requires marketId)
    window.__cor3RequestMercenaries = function (marketId) {
        var mid = marketId || window.__cor3LastMarketId || '019d3ea4-85bd-7389-904d-8f7c85841134';
        console.log('[COR3 Helper] Requesting mercenary data for market:', mid);
        var msg = '42["event",{"event":{"name":"expeditions","action":"get.mercenaries"},"data":{"marketId":"' + mid + '"}}]';
        wsSend(msg);
        return true;
    };

    // Request expedition config (returns location/zone/objective IDs)
    window.__cor3RequestExpeditionConfig = function () {
        console.log('[COR3 Helper] Requesting expedition config');
        var msg = '42["event",{"event":{"name":"expeditions","action":"get.config"}}]';
        wsSend(msg);
        return true;
    };

    // Track pending mercenary configure requests (queue of mercenaryIds)
    window.__cor3PendingMercConfigures = [];

    // Request mercenary configure details (cost, risk, chances)
    window.__cor3RequestMercConfigure = function (mercenaryId, marketId, locationConfigId, zoneConfigId, objectiveId) {
        var mid = marketId || window.__cor3LastMarketId || '019d3ea4-85bd-7389-904d-8f7c85841134';
        console.log('[COR3 Helper] Requesting configure for mercenary:', mercenaryId);
        window.__cor3PendingMercConfigures.push(mercenaryId);
        var data = {
            mercenaryId: mercenaryId,
            marketId: mid,
            locationConfigId: locationConfigId,
            zoneConfigId: zoneConfigId,
            objectiveId: objectiveId,
            hasInsurance: false
        };
        var msg = '42["event",{"event":{"name":"expeditions","action":"configure"},"data":' + JSON.stringify(data) + '}]';
        wsSend(msg);
        return true;
    };

    // Configure and launch expedition with mercenary
    window.__cor3LaunchExpedition = function (configData) {
        console.log('[COR3 Helper] Launching expedition with config:', configData);
        var configureMsg = '42["event",{"event":{"name":"expeditions","action":"configure"},"data":' + JSON.stringify(configData) + '}]';
        wsSend(configureMsg);
        // After configure, launch after a delay (launch needs same data as configure)
        setTimeout(function () {
            var launchMsg = '42["event",{"event":{"name":"expeditions","action":"launch"},"data":' + JSON.stringify(configData) + '}]';
            wsSend(launchMsg);
            console.log('[COR3 Helper] Expedition launch sent');
        }, humanDelay() + 500);
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
    function wsSend(msg) {
        // Log outbound WS message to content.js for storage
        window.postMessage({ type: 'COR3_WS_LOG', direction: 'sent', message: msg }, '*');

        // Prefer the activeSocket if it's still open
        if (activeSocket && activeSocket.readyState === OrigWebSocket.OPEN) {
            activeSocket.send(msg);
            return true;
        }

        // Fall back to most recently active socket
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
            activeSocket = bestSocket; // Update active socket
            bestSocket.send(msg);
            return true;
        }

        // No open socket found
        console.warn('[COR3 Helper] No active WebSocket found — message not sent');
        return false;
    }

    // --- Room state tracking ---
    const joinedRooms = new Set();

    function delay(ms) {
        return new Promise(function (r) { setTimeout(r, ms); });
    }

    // Send a leave-room message. Only sends if tracked as joined.
    function leaveRoom(room) {
        if (!joinedRooms.has(room)) return false;
        wsSend('42["leave-room",{"room":"' + room + '"}]');
        joinedRooms.delete(room);
        return true;
    }

    // Send a join-room message and mark as joined.
    function sendJoin(room) {
        wsSend('42["join-room",{"room":"' + room + '"}]');
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

    // HOME Market: just send get.options (no room joins needed)
    window.__cor3RequestMarket = function () {
        console.log('[COR3 Helper] Requesting HOME market options');
        var msg = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"019d3ea4-85bd-7389-904d-8f7c85841134"}}]';
        wsSend(msg);
        return true;
    };

    // D4RK Market: set endpoint first (no room join), then send get.options
    window.__cor3RequestDarkMarket = function () {
        console.log('[COR3 Helper] Setting D4RK endpoint');
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"019d29c5-4b37-79bf-b23e-304d8ea03c15"}}]';
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"019d3ea4-85bd-7389-904d-908ba9194aa0"}}]';
        wsSend(setEndpoint);
        setTimeout(function () {
            console.log('[COR3 Helper] Requesting D4RK market options');
            wsSend(getOptions);
        }, 1500);
        return true;
    };

    // Market refresh: just re-send get.options
    window.__cor3RefreshMarket = function () {
        window.__cor3RequestMarket();
        return true;
    };

    // D4RK Market refresh: just re-send get.options
    window.__cor3RefreshDarkMarket = function () {
        window.__cor3RequestDarkMarket();
        return true;
    };

    // Auto-fetch all data on page load (called when WS opens)
    var initialFetchDone = false;
    window.__cor3ResetInitialFetch = function () {
        initialFetchDone = false;
        console.log('[COR3 Helper] Reset initial fetch flag for reconnect');
    };
    window.__cor3InitialFetch = function () {
        if (initialFetchDone) return;
        initialFetchDone = true;
        console.log('[COR3 Helper] Running initial data fetch (page load)');

        // Trigger daily ops fetch via content script
        window.postMessage({ type: 'COR3_FETCH_DAILY_OPS' }, '*');

        // Fetch both markets — Market-1 is instant, Market-2 needs endpoint set first
        window.__cor3RequestMarket();
        setTimeout(function () {
            window.__cor3RequestDarkMarket();
        }, 1000);

        // Fetch expeditions after a short delay
        setTimeout(function () {
            window.__cor3RequestExpeditions();
        }, 2000);

        // Fetch stash (inventory) at end of queue with human delay
        setTimeout(function () {
            window.__cor3RequestStash();
        }, 6000);

        // Fetch archived expeditions after stash
        setTimeout(function () {
            window.__cor3RequestArchivedExpeditions();
        }, 8000);

        // Mercenaries are fetched via Refresh All in popup or on explicit request
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
                console.warn('[COR3 Helper] Active socket stale (no messages for 90s) — may need reconnect');
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
        if (event.data && event.data.type === 'COR3_REQUEST_MARKET') {
            window.__cor3RequestMarket();
        }
        if (event.data && event.data.type === 'COR3_REQUEST_DARK_MARKET') {
            window.__cor3RequestDarkMarket();
        }
        if (event.data && event.data.type === 'COR3_REFRESH_MARKET') {
            window.__cor3RefreshMarket();
        }
        if (event.data && event.data.type === 'COR3_REFRESH_DARK_MARKET') {
            window.__cor3RefreshDarkMarket();
        }
        if (event.data && event.data.type === 'COR3_LEAVE_STASH') {
            leaveRoom('stash');
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
            window.__cor3RequestMercenaries();
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
        if (event.data && event.data.type === 'COR3_KEEP_ALIVE') {
            window.__cor3KeepAlive();
        }
    });

    console.log('[COR3 Helper] WebSocket interceptor installed');
})();
