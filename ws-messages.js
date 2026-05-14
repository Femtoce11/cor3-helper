// ws-messages.js — WebSocket message logging via IndexedDB (content script context)
// Runs on cor3.gg origin. Writes immediately on each message. Purges entries >24h old.

const COR3_WS_DB_NAME = 'cor3_ws_db';
const COR3_WS_DB_VERSION = 1;
const COR3_WS_STORE = 'messages';
const COR3_WS_MAX_AGE = 24 * 60 * 60 * 1000;

let _wsDbInstance = null;
let _wsLastPurge = 0;

function _wsOpenDb() {
    if (_wsDbInstance) return Promise.resolve(_wsDbInstance);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(COR3_WS_DB_NAME, COR3_WS_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(COR3_WS_STORE)) {
                const store = db.createObjectStore(COR3_WS_STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        req.onsuccess = (e) => {
            _wsDbInstance = e.target.result;
            _wsDbInstance.onclose = () => { _wsDbInstance = null; };
            _wsDbInstance.onversionchange = () => { _wsDbInstance.close(); _wsDbInstance = null; };
            console.log('[COR3 WS-Log] IndexedDB opened successfully');
            resolve(_wsDbInstance);
        };
        req.onerror = (e) => {
            console.error('[COR3 WS-Log] IndexedDB open failed:', e.target.error);
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
        if (purged > 0) console.log('[COR3 WS-Log] Purged', purged, 'entries older than 24h');
    } catch (e) {
        console.warn('[COR3 WS-Log] Purge failed:', e);
    }
}

async function cor3LogWsMessage(direction, message) {
    try {
        const entry = {
            timestamp: new Date().toISOString(),
            direction: direction,
            message: String(message)
        };
        const db = await _wsOpenDb();
        const tx = db.transaction(COR3_WS_STORE, 'readwrite');
        tx.objectStore(COR3_WS_STORE).add(entry);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => {
                console.error('[COR3 WS-Log] Write failed:', tx.error);
                reject(tx.error);
            };
        });
        _wsPurgeOld();
    } catch (e) {
        console.error('[COR3 WS-Log] cor3LogWsMessage error:', e);
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
        console.error('[COR3 WS-Log] Clear failed:', e);
    }
}
