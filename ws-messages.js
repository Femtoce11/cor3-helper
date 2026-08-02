// ws-messages.js — WebSocket message logging via IndexedDB (content script context)
// Runs on cor3.gg origin. Writes immediately on each message. Purges entries >24h old.

const COR3_WS_DB_NAME = 'cor3_ws_db';
const COR3_WS_DB_VERSION = 2;
const COR3_WS_STORE = 'messages';
const COR3_WS_LOGS_STORE = 'logs';
const COR3_WS_MAX_AGE = 24 * 60 * 60 * 1000;
const COR3_WS_MAX_ENTRIES = 30000;
const COR3_WS_LOGS_MAX_ENTRIES = 30000;

let _wsDbInstance = null;
let _wsLastPurge = 0;

function _wsInvalidateDb() {
    _wsDbInstance = null;
}

function _wsOpenDb() {
    if (_wsDbInstance) {
        // Verify the cached connection is still usable
        try {
            if (!_wsDbInstance.objectStoreNames.contains(COR3_WS_STORE)) {
                _wsInvalidateDb();
            }
        } catch (e) {
            // Connection is dead (InvalidStateError) — reopen
            _wsInvalidateDb();
        }
    }
    if (_wsDbInstance) return Promise.resolve(_wsDbInstance);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(COR3_WS_DB_NAME, COR3_WS_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(COR3_WS_STORE)) {
                const store = db.createObjectStore(COR3_WS_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains(COR3_WS_LOGS_STORE)) {
                const logStore = db.createObjectStore(COR3_WS_LOGS_STORE, { keyPath: 'id', autoIncrement: true });
                logStore.createIndex('timestamp', 'timestamp', { unique: false });
                logStore.createIndex('category', 'category', { unique: false });
                logStore.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
            }
        };
        req.onsuccess = (e) => {
            _wsDbInstance = e.target.result;
            _wsDbInstance.onclose = () => { _wsInvalidateDb(); };
            _wsDbInstance.onerror = () => { _wsInvalidateDb(); };
            _wsDbInstance.onversionchange = () => { _wsDbInstance.close(); _wsInvalidateDb(); };
            console.log('[COR3 WS-Log] IndexedDB opened successfully');
            resolve(_wsDbInstance);
        };
        req.onerror = (e) => {
            console.log('[COR3 WS-Log] IndexedDB open failed:', e.target.error);
            reject(e.target.error);
        };
    });
}

async function _wsPurgeOld() {
    const now = Date.now();
    if (now - _wsLastPurge < 60000) return;
    _wsLastPurge = now;
    try {
        const db = await _wsOpenDb();
        const cutoff = new Date(now - COR3_WS_MAX_AGE).toISOString();
        const tx = db.transaction(COR3_WS_STORE, 'readwrite');
        const idx = tx.objectStore(COR3_WS_STORE).index('timestamp');
        const range = IDBKeyRange.upperBound(cutoff, true);
        let purged = 0;
        const req = idx.openCursor(range);
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { cursor.delete(); purged++; cursor.continue(); }
        };
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
        if (purged > 0) console.log('[COR3 WS-Log] Purged', purged, 'WS entries older than 24h');
        const tx2 = db.transaction(COR3_WS_LOGS_STORE, 'readwrite');
        const idx2 = tx2.objectStore(COR3_WS_LOGS_STORE).index('timestamp');
        const range2 = IDBKeyRange.upperBound(cutoff, true);
        let purged2 = 0;
        const req2 = idx2.openCursor(range2);
        req2.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { cursor.delete(); purged2++; cursor.continue(); }
        };
        await new Promise((resolve, reject) => { tx2.oncomplete = resolve; tx2.onerror = () => reject(tx2.error); });
        if (purged2 > 0) console.log('[COR3 WS-Log] Purged', purged2, 'log entries older than 24h');
        // Count-based trim: keep at most COR3_WS_MAX_ENTRIES in messages store
        await _wsTrimByCount(db, COR3_WS_STORE, COR3_WS_MAX_ENTRIES);
        // Count-based trim: keep at most COR3_WS_LOGS_MAX_ENTRIES in logs store
        await _wsTrimByCount(db, COR3_WS_LOGS_STORE, COR3_WS_LOGS_MAX_ENTRIES);
    } catch (e) {
        console.log('[COR3 WS-Log] Purge failed:', e);
    }
}

async function _wsTrimByCount(db, storeName, maxEntries) {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const countReq = store.count();
    const count = await new Promise((resolve) => { countReq.onsuccess = () => resolve(countReq.result); countReq.onerror = () => resolve(0); });
    if (count <= maxEntries) return;
    const excess = count - maxEntries;
    const tx2 = db.transaction(storeName, 'readwrite');
    const store2 = tx2.objectStore(storeName);
    let deleted = 0;
    const cursorReq = store2.openCursor();
    cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && deleted < excess) { cursor.delete(); deleted++; cursor.continue(); }
    };
    await new Promise((resolve, reject) => { tx2.oncomplete = resolve; tx2.onerror = () => reject(tx2.error); });
    if (deleted > 0) console.log('[COR3 WS-Log] Trimmed', deleted, 'entries from', storeName, '(limit:', maxEntries, ')');
}

async function _wsWriteEntry(entry) {
    const db = await _wsOpenDb();
    const tx = db.transaction(COR3_WS_STORE, 'readwrite');
    tx.objectStore(COR3_WS_STORE).add(entry);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => {
            console.log('[COR3 WS-Log] Write failed:', tx.error);
            reject(tx.error);
        };
    });
}

function _sanitizeWsMessage(msg) {
    return String(msg);
}

async function cor3LogWsMessage(direction, message) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            direction: direction,
            message: _sanitizeWsMessage(message)
        };
        try {
            await _wsWriteEntry(entry);
        } catch (e) {
            // Retry once on stale connection (NotFoundError / InvalidStateError)
            if (e && (e.name === 'NotFoundError' || e.name === 'InvalidStateError')) {
                console.log('[COR3 WS-Log] Stale DB connection (' + e.name + ') — reopening and retrying');
                _wsInvalidateDb();
                await _wsWriteEntry(entry);
            } else {
                throw e;
            }
        }
        _wsPurgeOld();
    } catch (e) {
        console.log('[COR3 WS-Log] cor3LogWsMessage error:', e);
    }
}

async function cor3ClearWsMessages() {
    try {
        const db = await _wsOpenDb();
        const tx = db.transaction(COR3_WS_STORE, 'readwrite');
        tx.objectStore(COR3_WS_STORE).clear();
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
        console.log('[COR3 WS-Log] All messages cleared');
    } catch (e) {
        console.log('[COR3 WS-Log] Clear failed:', e);
    }
}

async function cor3LogEntry(category, message, level) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            category: category,
            message: String(message),
            level: level || 'info'
        };
        const db = await _wsOpenDb();
        const tx = db.transaction(COR3_WS_LOGS_STORE, 'readwrite');
        tx.objectStore(COR3_WS_LOGS_STORE).add(entry);
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    } catch (e) {
        if (e && (e.name === 'NotFoundError' || e.name === 'InvalidStateError')) {
            _wsInvalidateDb();
            try {
                const db = await _wsOpenDb();
                const tx = db.transaction(COR3_WS_LOGS_STORE, 'readwrite');
                tx.objectStore(COR3_WS_LOGS_STORE).add({
                    timestamp: new Date().toISOString(),
                    category: category,
                    message: String(message),
                    level: level || 'info'
                });
                await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
            } catch (e2) {
                console.log('[COR3 WS-Log] cor3LogEntry retry failed:', e2);
            }
        }
    }
}

async function cor3ClearLogsByCategory(category) {
    try {
        const db = await _wsOpenDb();
        const tx = db.transaction(COR3_WS_LOGS_STORE, 'readwrite');
        const idx = tx.objectStore(COR3_WS_LOGS_STORE).index('category');
        const range = IDBKeyRange.only(category);
        const req = idx.openCursor(range);
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
        };
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
        console.log('[COR3 WS-Log] Cleared logs for category:', category);
    } catch (e) {
        console.log('[COR3 WS-Log] Clear logs failed:', e);
    }
}
