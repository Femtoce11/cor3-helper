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

        // Intercept market responses
        if (eventName === 'market' && payload && payload.data) {
            // Determine which market this is based on the market id
            var mkt = payload.data.market;
            if (mkt && mkt.id === '019d3ea4-85bd-7389-904d-908ba9194aa0') {
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
    window.__cor3RequestExpeditions = function () {
        const msg = '42["event",{"event":{"name":"expeditions","action":"get.config"}}]';
        for (const ws of trackedSockets) {
            if (ws.readyState === OrigWebSocket.OPEN) {
                console.log('[COR3 Helper] Sending expeditions request via WS');
                ws.send(msg);
                return true;
            }
        }
        console.log('[COR3 Helper] No open WebSocket found, tracked:', trackedSockets.length);
        return false;
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

    // HOME Market: join network-map (parent) then market (child), then send get.options
    window.__cor3RequestMarket = function () {
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"019d3ea4-85bd-7389-904d-8f7c85841134"}}]';

        enterRooms(['network-map', 'market']).then(function () {
            console.log('[COR3 Helper] Requesting HOME market options');
            wsSend(getOptions);
        });
        return true;
    };

    // D4RK Market: join network-map, set endpoint, join market, send get.options
    // The endpoint set can fail — we listen for the response via COR3_WS_ENDPOINT_RESULT
    var darkEndpointPending = false;

    window.__cor3RequestDarkMarket = function () {
        var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"019d29c5-4b37-79bf-b23e-304d8ea03c15"}}]';
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"019d3ea4-85bd-7389-904d-908ba9194aa0"}}]';

        // We need network-map room to set endpoint
        // First, leave market room if joined (from HOME market)
        var p = Promise.resolve();
        if (joinedRooms.has('market')) {
            p = p.then(function () {
                leaveRoom('market');
                return delay(humanDelay());
            });
        }
        // Make sure we're in network-map
        if (!joinedRooms.has('network-map')) {
            p = p.then(function () {
                sendJoin('network-map');
                return delay(humanDelay());
            });
        }

        // Set the endpoint server
        p.then(function () {
            console.log('[COR3 Helper] Setting D4RK endpoint server');
            darkEndpointPending = true;
            wsSend(setEndpoint);
            return delay(1500); // wait for endpoint response
        }).then(function () {
            if (!darkEndpointPending) {
                // Already handled by the response listener
                return;
            }
            // Timeout: assume failure if no response came
            darkEndpointPending = false;
            window.postMessage({
                type: 'COR3_WS_DARK_MARKET_UNAVAILABLE'
            }, '*');
        });
        return true;
    };

    // Listen for endpoint result and continue D4RK market flow
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'COR3_WS_ENDPOINT_RESULT') {
            if (!darkEndpointPending) return;
            darkEndpointPending = false;

            if (!event.data.success) {
                console.log('[COR3 Helper] D4RK endpoint failed');
                window.postMessage({ type: 'COR3_WS_DARK_MARKET_UNAVAILABLE' }, '*');
                return;
            }

            // Endpoint set successfully — now join market room and request options
            var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"019d3ea4-85bd-7389-904d-908ba9194aa0"}}]';
            delay(humanDelay()).then(function () {
                sendJoin('market');
                return delay(humanDelay());
            }).then(function () {
                console.log('[COR3 Helper] Requesting D4RK market options');
                wsSend(getOptions);
            });
        }
    });

    // Market leave: child first (market), then parent (network-map)
    window.__cor3LeaveMarket = function () {
        return leaveRoomsInOrder(['market', 'network-map']);
    };

    // Leave only the market room (keep network-map for D4RK)
    window.__cor3LeaveMarketRoom = function () {
        return leaveRoomsInOrder(['market']);
    };

    // Market refresh: leave child→parent, wait, then re-enter parent→child
    window.__cor3RefreshMarket = function () {
        window.__cor3LeaveMarket().then(function () {
            return delay(humanDelay());
        }).then(function () {
            window.__cor3RequestMarket();
        });
        return true;
    };

    // D4RK Market refresh: leave market room, then run the full D4RK request flow
    window.__cor3RefreshDarkMarket = function () {
        var p = Promise.resolve();
        if (joinedRooms.has('market')) {
            p = p.then(function () {
                leaveRoom('market');
                return delay(humanDelay());
            });
        }
        p.then(function () {
            window.__cor3RequestDarkMarket();
        });
        return true;
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
        if (event.data && event.data.type === 'COR3_LEAVE_MARKET_ROOM') {
            window.__cor3LeaveMarketRoom();
        }
        if (event.data && event.data.type === 'COR3_LEAVE_STASH') {
            leaveRoom('stash');
        }
    });

    console.log('[COR3 Helper] WebSocket interceptor installed at document_start');
})();
