// content-early.js
// Runs in MAIN world at document_start — before the page creates any WebSocket.
// Hooks WebSocket to intercept cor3/corie messages and relays decisions via postMessage.

(function () {
    if (window.__cor3WsInterceptorActive) return;
    window.__cor3WsInterceptorActive = true;

    const OrigWebSocket = window.WebSocket;
    const trackedSockets = [];

    // --- Intercept Bearer token from outgoing fetch/XHR requests ---
    let capturedBearerToken = null;

    const OrigFetch = window.fetch;
    window.fetch = function () {
        const args = arguments;
        const input = args[0];
        const init = args[1];
        // Check for Authorization header in fetch calls to corie/cor3
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
        } catch (e) { /* silent */ }
        return OrigFetch.apply(this, args);
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
                trackedSockets.push(ws);

                ws.addEventListener('message', function (event) {
                    try {
                        handleWsMessage(event.data);
                    } catch (e) {
                        // silent
                    }
                });

                // Auto-fetch all data when WS connects (page load/reload)
                ws.addEventListener('open', function () {
                    console.log('[COR3 Helper] WS connected — scheduling initial data fetch');
                    // Wait for connection to stabilize, then fetch all data
                    setTimeout(function () {
                        window.__cor3InitialFetch && window.__cor3InitialFetch();
                    }, 3000);
                });

                // Clean up closed sockets
                ws.addEventListener('close', function () {
                    const idx = trackedSockets.indexOf(ws);
                    if (idx !== -1) trackedSockets.splice(idx, 1);
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

    function handleWsMessage(rawData) {
        if (typeof rawData !== 'string') return;

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

        // Intercept stash (inventory) responses
        if (eventName === 'stash' && payload && payload.data) {
            window.postMessage({
                type: 'COR3_WS_STASH',
                stash: payload.data
            }, '*');
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
                }
            }
        }

        // Intercept network-map responses (endpoint set success/failure)
        if (eventName === 'network-map' && payload && payload.event) {
            if (payload.event.action === 'set.endpoint') {
                var success = !(payload.data && payload.data.error);
                window.postMessage({
                    type: 'COR3_WS_ENDPOINT_RESULT',
                    success: success,
                    data: payload.data
                }, '*');
            }
        }

        // We're interested in "expeditions" responses that contain expedition data
        if (eventName === 'expeditions' && payload && payload.data) {
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
                            messageId: msg.id,
                            content: msg.content,
                            decisionOptions: msg.decisionOptions,
                            selectedOption: msg.selectedOption,
                            decisionDeadline: msg.decisionDeadline,
                            isResolved: msg.isResolved,
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

    // Send expedition request through any open tracked socket
    // Joining the expedition room triggers the server to respond with get.active data.
    // We track whether data already arrived to avoid sending a duplicate get.active.
    window.__cor3RequestExpeditions = function () {
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
                    console.log('[COR3 Helper] Sent expeditions get.active (no auto-response from room join)');
                } else {
                    console.log('[COR3 Helper] Expedition data arrived from room join — skipped manual get.active');
                }
            }, 2000);
        });
        return true;
    };

    // Helper: get a random human-like delay (400–900ms)
    function humanDelay() {
        return 400 + Math.floor(Math.random() * 500);
    }

    // Helper: send a WS message on first open tracked socket
    function wsSend(msg) {
        for (const ws of trackedSockets) {
            if (ws.readyState === OrigWebSocket.OPEN) {
                ws.send(msg);
                return true;
            }
        }
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
        console.log('[COR3 Helper] Leaving room:', room);
        wsSend('42["leave-room",{"room":"' + room + '"}]');
        joinedRooms.delete(room);
        return true;
    }

    // Send a join-room message and mark as joined.
    function sendJoin(room) {
        console.log('[COR3 Helper] Joining room:', room);
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
        enterRooms(['stash']);
        return true;
    };

    // HOME Market: just send get.options (no room joins needed)
    window.__cor3RequestMarket = function () {
        var msg = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"019d3ea4-85bd-7389-904d-8f7c85841134"}}]';
        console.log('[COR3 Helper] Requesting HOME market options');
        wsSend(msg);
        return true;
    };

    // D4RK Market: set endpoint first (no room join), then send get.options
    window.__cor3RequestDarkMarket = function () {
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"019d29c5-4b37-79bf-b23e-304d8ea03c15"}}]';
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"019d3ea4-85bd-7389-904d-908ba9194aa0"}}]';
        console.log('[COR3 Helper] Setting D4RK endpoint (no room join), then requesting options');
        wsSend(setEndpoint);
        setTimeout(function () {
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
    };

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
        if (event.data && event.data.type === 'COR3_STOP_DECRYPT_SOLVER') {
            window.__solverAbort = true;
            console.log('[COR3 Helper] Decrypt solver stop signal sent.');
        }
        if (event.data && event.data.type === 'COR3_START_DECRYPT_SOLVER') {
            // If solver is already running, do nothing
            if (window.__solverActive && !window.__solverAbort) return;
            // If solver was stopped, reset flags and re-inject will handle it
            window.__solverAbort = false;
            window.__solverActive = false;
            console.log('[COR3 Helper] Decrypt solver restart signal — ready for re-injection.');
        }
    });

    console.log('[COR3 Helper] WebSocket interceptor installed at document_start');
})();
