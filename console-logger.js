// console-logger.js — Intercepts console.log/warn/error and stores entries.
// Works in two modes:
//   1. Extension contexts (content script, background, popup) — writes to chrome.storage.local
//   2. MAIN world (content-early.js) — stores in window.__cor3ConsoleLogs array
//
// Storage key: 'cor3_console_logs' (extension contexts share one key, source is per-entry).
// Each entry: { timestamp, level, source, args (stringified arguments) }
// Purges entries older than 24h on every write (debounced).

(function () {
    'use strict';

    // Detect context
    var hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    var isMainWorld = !hasStorage && typeof window !== 'undefined';

    // Auto-detect source context
    var source = 'unknown';
    if (hasStorage) {
        if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
            source = 'background';
        } else if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
            source = 'popup';
        } else {
            source = 'content';
        }
    }

    var MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours
    var MAX_ENTRIES = 5000;
    var PURGE_INTERVAL = 60000; // purge at most once per minute
    var _lastPurge = 0;

    // Stringify arguments safely
    function stringifyArgs(args) {
        var parts = [];
        for (var i = 0; i < args.length; i++) {
            try {
                if (typeof args[i] === 'string') {
                    parts.push(args[i]);
                } else if (args[i] instanceof Error) {
                    parts.push(args[i].message + (args[i].stack ? '\n' + args[i].stack : ''));
                } else {
                    parts.push(JSON.stringify(args[i]));
                }
            } catch (e) {
                parts.push('[unserializable]');
            }
        }
        return parts.join(' ');
    }

    // ─── MAIN WORLD MODE ───
    if (isMainWorld) {
        if (!window.__cor3ConsoleLogs) window.__cor3ConsoleLogs = [];
        var logs = window.__cor3ConsoleLogs;

        var origLog = console.log;
        var origWarn = console.warn;
        var origError = console.error;

        function intercept(level, origFn) {
            // For warn/error: call origFn via setTimeout so the extension file
            // is NOT in the call stack — prevents Chrome from capturing these as
            // extension errors on the chrome://extensions error page.
            var detach = level === 'warn' || level === 'error';
            return function () {
                if (detach) {
                    var args = Array.prototype.slice.call(arguments);
                    setTimeout(function () { origFn.apply(console, args); }, 0);
                } else {
                    origFn.apply(console, arguments);
                }
                var entry = {
                    timestamp: new Date().toISOString(),
                    level: level,
                    source: 'page',
                    args: stringifyArgs(arguments)
                };
                logs.push(entry);
                // Trim if over max
                while (logs.length > MAX_ENTRIES) logs.shift();
                // Purge old entries periodically
                var now = Date.now();
                if (now - _lastPurge > PURGE_INTERVAL) {
                    _lastPurge = now;
                    var cutoff = new Date(now - MAX_AGE).toISOString();
                    while (logs.length > 0 && logs[0].timestamp < cutoff) logs.shift();
                }
            };
        }

        console.log = intercept('log', origLog);
        console.warn = intercept('warn', origWarn);
        console.error = intercept('error', origError);
        return;
    }

    // ─── EXTENSION CONTEXT MODE (content script, background, popup) ───
    if (!hasStorage) return; // bail if neither mode applies

    var STORAGE_KEY = 'cor3_console_logs';
    var _writeQueue = [];
    var _flushTimer = null;

    function flushQueue() {
        _flushTimer = null;
        if (_writeQueue.length === 0) return;
        var batch = _writeQueue.splice(0);
        chrome.storage.local.get(STORAGE_KEY, function (data) {
            var existing = data[STORAGE_KEY] || [];
            existing = existing.concat(batch);
            // Purge old
            var now = Date.now();
            if (now - _lastPurge > PURGE_INTERVAL) {
                _lastPurge = now;
                var cutoff = new Date(now - MAX_AGE).toISOString();
                while (existing.length > 0 && existing[0].timestamp < cutoff) existing.shift();
            }
            // Trim if over max
            while (existing.length > MAX_ENTRIES) existing.shift();
            var obj = {};
            obj[STORAGE_KEY] = existing;
            chrome.storage.local.set(obj);
        });
    }

    function scheduleFlush() {
        if (_flushTimer) return;
        _flushTimer = setTimeout(flushQueue, 500); // batch writes every 500ms
    }

    var origLog = console.log;
    var origWarn = console.warn;
    var origError = console.error;

    function intercept(level, origFn) {
        return function () {
            origFn.apply(console, arguments);
            _writeQueue.push({
                timestamp: new Date().toISOString(),
                level: level,
                source: source,
                args: stringifyArgs(arguments)
            });
            scheduleFlush();
        };
    }

    console.log = intercept('log', origLog);
    console.warn = intercept('warn', origWarn);
    console.error = intercept('error', origError);
})();
