// Drone missions: inbound WS interception + outbound command wrappers.
// The drone ("Personal Drone Assembling") feature is a linear mission pipeline:
// get.options -> launch -> in-flight events -> completed -> claim -> repair.
import { wsSend } from './ws-send.js';

// --- Inbound: called from ws-message-handler.js for every parsed event frame.
// Returns true when the event was a drone-missions frame (handled here).
export function handleDroneMessage(eventName, payload) {
    if (eventName !== 'drone-missions' || !payload) return false;

    var dmAction = payload.event ? payload.event.action : null;

    if (payload.error) {
        window.postMessage({ type: 'COR3_WS_DRONE_ERROR', action: dmAction, error: payload.error }, '*');
        return true;
    }
    if (!payload.data) return true;

    if (dmAction === 'get.options') {
        window.postMessage({ type: 'COR3_WS_DRONE_OPTIONS', data: payload.data }, '*');
    } else if (dmAction === 'repair') {
        // repair returns the same full options shape as get.options
        window.postMessage({ type: 'COR3_WS_DRONE_OPTIONS', data: payload.data }, '*');
        window.postMessage({ type: 'COR3_WS_DRONE_REPAIR', data: payload.data }, '*');
    } else if (dmAction === 'launch') {
        window.postMessage({ type: 'COR3_WS_DRONE_MISSION', data: payload.data }, '*');
        window.postMessage({ type: 'COR3_WS_DRONE_LAUNCHED', data: payload.data }, '*');
    } else if (dmAction === 'claim') {
        window.postMessage({ type: 'COR3_WS_DRONE_MISSION', data: payload.data }, '*');
        window.postMessage({ type: 'COR3_WS_DRONE_CLAIMED', data: payload.data }, '*');
    } else if (dmAction === 'resolve.event') {
        window.postMessage({ type: 'COR3_WS_DRONE_MISSION', data: payload.data }, '*');
    } else if (dmAction === 'event') {
        window.postMessage({ type: 'COR3_WS_DRONE_EVENT', data: payload.data }, '*');
    } else if (dmAction === 'completed') {
        window.postMessage({ type: 'COR3_WS_DRONE_COMPLETED', data: payload.data }, '*');
    } else if (dmAction === 'get.archived') {
        window.postMessage({ type: 'COR3_WS_DRONE_ARCHIVED', data: payload.data }, '*');
    }
    return true;
}

// --- Outbound WS send wrappers ---
window.__cor3RequestDroneOptions = function () {
    console.log('[COR3 Helper] Requesting drone options');
    var msg = '42["event",{"event":{"name":"drone-missions","action":"get.options"},"data":{}}]';
    wsSend(msg);
    return true;
};
window.__cor3LaunchDrone = function (locationConfigId, missionConfigId) {
    console.log('[COR3 Helper] Launching drone mission:', locationConfigId, missionConfigId);
    var data = { locationConfigId: locationConfigId, missionConfigId: missionConfigId };
    var msg = '42["event",{"event":{"name":"drone-missions","action":"launch"},"data":' + JSON.stringify(data) + '}]';
    wsSend(msg);
    return true;
};
window.__cor3ResolveDroneEvent = function (missionId, eventId, optionId) {
    console.log('[COR3 Helper] Resolving drone event:', eventId, '->', optionId);
    var data = { missionId: missionId, eventId: eventId, optionId: optionId };
    var msg = '42["event",{"event":{"name":"drone-missions","action":"resolve.event"},"data":' + JSON.stringify(data) + '}]';
    wsSend(msg);
    return true;
};
window.__cor3ClaimDrone = function (missionId) {
    console.log('[COR3 Helper] Claiming drone mission:', missionId);
    var msg = '42["event",{"event":{"name":"drone-missions","action":"claim"},"data":{"missionId":"' + missionId + '"}}]';
    wsSend(msg);
    return true;
};
window.__cor3RepairDrone = function (targetDurability) {
    targetDurability = targetDurability || 100;
    console.log('[COR3 Helper] Repairing drone to durability:', targetDurability);
    var msg = '42["event",{"event":{"name":"drone-missions","action":"repair"},"data":{"targetDurability":' + targetDurability + '}}]';
    wsSend(msg);
    return true;
};
window.__cor3RequestDroneArchived = function (cursor, limit) {
    console.log('[COR3 Helper] Requesting drone archived missions');
    var data = { cursor: cursor || null, limit: limit || 20 };
    var msg = '42["event",{"event":{"name":"drone-missions","action":"get.archived"},"data":' + JSON.stringify(data) + '}]';
    wsSend(msg);
    return true;
};

// --- postMessage bridge (from content.js isolated world) ---
window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data) return;
    var t = event.data.type;
    if (t === 'COR3_REQUEST_DRONE_OPTIONS') window.__cor3RequestDroneOptions();
    else if (t === 'COR3_LAUNCH_DRONE') window.__cor3LaunchDrone(event.data.locationConfigId, event.data.missionConfigId);
    else if (t === 'COR3_RESOLVE_DRONE_EVENT') window.__cor3ResolveDroneEvent(event.data.missionId, event.data.eventId, event.data.optionId);
    else if (t === 'COR3_CLAIM_DRONE') window.__cor3ClaimDrone(event.data.missionId);
    else if (t === 'COR3_REPAIR_DRONE') window.__cor3RepairDrone(event.data.targetDurability);
    else if (t === 'COR3_REQUEST_DRONE_ARCHIVED') window.__cor3RequestDroneArchived(event.data.cursor, event.data.limit);
});
