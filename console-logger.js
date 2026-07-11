// console-logger.js — Intercepts console.log/warn/error and stores entries.
// Works in two modes:
//   1. Extension contexts (content script, background, popup) — writes to chrome.storage.local + IndexedDB
//   2. MAIN world (content-early.js) — stores in window.__cor3ConsoleLogs array + IndexedDB
//
// Storage key: 'cor3_console_logs' (extension contexts share one key, source is per-entry).
// Each entry: { timestamp, level, source, args (stringified arguments) }
// Both modes also write to IndexedDB 'logs' store (category 'page-console' or 'ext-console')
// so logs survive page refreshes and can be read uniformly by DevTools panel and copy button.
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

    // ─── IndexedDB writer (shared by both modes) ───
    // Writes to cor3_ws_db / 'logs' store with category 'page-console' or 'ext-console'.
    // Lightweight and fire-and-forget — failures are silently ignored to avoid
    // interfering with normal console output.
    var IDB_NAME = 'cor3_ws_db';
    var IDB_VERSION = 2;
    var IDB_STORE = 'logs';
    var _idbInstance = null;
    var _idbQueue = [];
    var _idbFlushTimer = null;
    var _idbOpening = false;

    function _idbOpen() {
        if (_idbInstance) {
            try { _idbInstance.objectStoreNames.contains(IDB_STORE); return Promise.resolve(_idbInstance); }
            catch (e) { _idbInstance = null; }
        }
        if (_idbOpening) return new Promise(function (r) { setTimeout(function () { r(_idbInstance); }, 200); });
        _idbOpening = true;
        return new Promise(function (resolve) {
            try {
                var req = indexedDB.open(IDB_NAME, IDB_VERSION);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains('messages')) {
                        var s = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                        s.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(IDB_STORE)) {
                        var ls = db.createObjectStore(IDB_STORE, { keyPath: 'id', autoIncrement: true });
                        ls.createIndex('timestamp', 'timestamp', { unique: false });
                        ls.createIndex('category', 'category', { unique: false });
                        ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                    }
                };
                req.onsuccess = function (e) { _idbInstance = e.target.result; _idbOpening = false; resolve(_idbInstance); };
                req.onerror = function () { _idbOpening = false; resolve(null); };
            } catch (e) { _idbOpening = false; resolve(null); }
        });
    }

    function _idbWrite(category, entry) {
        _idbQueue.push({ timestamp: entry.timestamp, category: category, message: '[' + entry.source + '] ' + entry.args, level: entry.level });
        if (!_idbFlushTimer) _idbFlushTimer = setTimeout(_idbFlush, 300);
    }

    function _idbFlush() {
        _idbFlushTimer = null;
        if (_idbQueue.length === 0) return;
        var batch = _idbQueue.splice(0);
        _idbOpen().then(function (db) {
            if (!db) return;
            try {
                var tx = db.transaction(IDB_STORE, 'readwrite');
                var store = tx.objectStore(IDB_STORE);
                for (var i = 0; i < batch.length; i++) store.add(batch[i]);
            } catch (e) { /* silently ignore */ }
        });
    }

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
                // Also persist to IndexedDB for DevTools panel / copy
                _idbWrite('page-console', entry);
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
            var entry = {
                timestamp: new Date().toISOString(),
                level: level,
                source: source,
                args: stringifyArgs(arguments)
            };
            _writeQueue.push(entry);
            scheduleFlush();
            // Also persist to IndexedDB for DevTools panel / copy
            // Only content scripts run on cor3.gg origin (same IndexedDB as the page)
            if (source === 'content') _idbWrite('ext-console', entry);
        };
    }

    console.log = intercept('log', origLog);
    console.warn = intercept('warn', origWarn);
    console.error = intercept('error', origError);
})();
