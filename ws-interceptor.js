// ws-interceptor.js
// Injected into the page context to intercept WebSocket messages.
// Communicates back to the content script via window.postMessage.

(function () {
    if (window.__cor3WsInterceptorActive) return;
    window.__cor3WsInterceptorActive = true;

    const OrigWebSocket = window.WebSocket;
    const trackedSockets = [];

    window.WebSocket = function (...args) {
        const ws = new OrigWebSocket(...args);
        const url = args[0] || '';

        if (url.includes('cor3') || url.includes('corie')) {
            trackedSockets.push(ws);

            const origOnMessage = Object.getOwnPropertyDescriptor(
                OrigWebSocket.prototype, 'onmessage'
            );

            ws.addEventListener('message', function (event) {
                try {
                    handleWsMessage(event.data);
                } catch (e) {
                    // silent
                }
            });
        }

        return ws;
    };

    // Preserve prototype chain
    window.WebSocket.prototype = OrigWebSocket.prototype;
    window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
    window.WebSocket.OPEN = OrigWebSocket.OPEN;
    window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
    window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

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

    // Also provide a way to request expedition data via existing sockets
    window.__cor3RequestExpeditions = function () {
        const msg = '42["event",{"event":{"name":"expeditions","action":"get.config"}}]';
        for (const ws of trackedSockets) {
            if (ws.readyState === OrigWebSocket.OPEN) {
                ws.send(msg);
                return true;
            }
        }
        return false;
    };

    // Listen for requests from content script
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (event.data && event.data.type === 'COR3_REQUEST_EXPEDITIONS') {
            window.__cor3RequestExpeditions();
        }
    });
})();
