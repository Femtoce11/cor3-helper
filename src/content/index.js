// content.js — modular entry point

// Import all modules (side-effects: intervals, storage listeners, auto-start solvers, DOM tweaks)
import './helpers.js';
import './auto-update-markets.js';
import './auto-choose.js';
import './auto-send.js';
import './drone.js';
import './alarms.js';
import './auto-refresh.js';
import './solvers.js';
import './dom-tweaks.js';
import './log-writers.js';

// Setup functions (register listeners)
import { setupWsRelay } from './ws-relay.js';
import { setupMessageListener } from './message-listener.js';
import { setupEngineRelay } from './engine-relay.js';
import { checkAutoSendOnExpeditionData } from './auto-send.js';

setupWsRelay();
setupMessageListener();
setupEngineRelay();

// On page load: check cached expedition data for auto-send trigger
setTimeout(() => {
    chrome.storage.local.get('expeditionsData', (result) => {
        if (result.expeditionsData) {
            console.log('[COR3 Helper] Page load: checking cached expedition data for auto-send');
            checkAutoSendOnExpeditionData(result.expeditionsData);
        }
    });
}, 5000);

// Listen for autoSendMerc toggle changes to trigger auto-send check
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.autoSendMerc) return;
    const newVal = changes.autoSendMerc.newValue;
    if (newVal && newVal.enabled) {
        console.log('[COR3 Helper] Auto-send mercenary enabled — checking expedition data');
        chrome.storage.local.get('expeditionsData', (result) => {
            if (result.expeditionsData) {
                checkAutoSendOnExpeditionData(result.expeditionsData);
            }
        });
    }
});

// Capture extension errors to IndexedDB for DevTools panel
window.addEventListener('error', (e) => {
    if (typeof cor3LogEntry === 'function') {
        cor3LogEntry('error-logs', (e.filename || '') + ':' + (e.lineno || 0) + ' ' + (e.message || ''), 'error');
    }
});
window.addEventListener('unhandledrejection', (e) => {
    if (typeof cor3LogEntry === 'function') {
        var msg = e.reason ? (e.reason.stack || e.reason.message || String(e.reason)) : 'Unhandled rejection';
        cor3LogEntry('error-logs', msg, 'error');
    }
});

// Clean up auto-jobs state on page reload — always start fresh
// (autoJobsLockedJobs is preserved — the solver reads and clears it on next start)
chrome.storage.local.remove('initialFetchDoneAt');
chrome.storage.local.get('autoJobsRunning', (data) => {
    if (data.autoJobsRunning) {
        console.log('[COR3 Helper] Page reloaded — clearing stale auto-jobs state');
        chrome.storage.local.set({ autoJobsRunning: false, autoJobsQueue: [] });
    }
});
