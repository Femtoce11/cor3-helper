// content-early entry point — wires all modules together into a single IIFE via esbuild.
// Import order matters: state first, then ws layer, then features, then listeners.

// Prevent double-execution (e.g. if injected twice)
if (window.__cor3WsInterceptorActive) throw new Error('COR3 already active');
window.__cor3WsInterceptorActive = true;

// 1. Shared state (constants, globals, mutable vars)
import './state.js';

// 2. WS proxy (intercepts WebSocket constructor, tracks sockets)
import { installWebSocketProxy } from './ws-proxy.js';

// 3. WS send (throttled send, room management)
// (auto-registers on import — no explicit init needed)
import './ws-send.js';

// 4. HTTP intercept (fetch/XHR overrides for version capture, polling, bearer token)
import { installHttpIntercept } from './http-intercept.js';

// 5. WS message handler (inbound event dispatch)
import { handleWsMessage, setPostUnreachable } from './ws-message-handler.js';

// 6. WS commands (window.__cor3* send wrappers)
import './ws-commands.js';

// 7. Expeditions (request, respond, mercs, launch, collect)
import './expeditions.js';

// 7b. Drone missions (get.options, launch, events, claim, repair, archived)
import './drone.js';

// 8. Market requests (HOME, D4RK, SOYUZ, USOL — full, jobs-only, path-through, refresh)
import { __cor3PostUnreachable } from './market-requests.js';

// 9. Initial data fetch orchestration
import './initial-fetch.js';

// 10. Message listener (postMessage handler for content.js / popup commands)
import { installMessageListener, installSocketHealthCheck, scheduleVersionRepost } from './message-listener.js';

// --- Boot ---
(function () {
    // Wire the postUnreachable callback into ws-message-handler to break circular dep
    setPostUnreachable(__cor3PostUnreachable);
    installWebSocketProxy(handleWsMessage);
    installHttpIntercept();
    installSocketHealthCheck();
    installMessageListener();
    scheduleVersionRepost();
    console.log('[COR3 Helper] WebSocket interceptor installed');
})();
