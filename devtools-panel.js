// devtools-panel.js — CORE Helper DevTools panel logic

(function () {
    'use strict';

    const SERVER_ID_MAP = {
        '019d1b0a-13a9-77dd-b41f-33f06f2df284': 'RM7-E1L3',
        '019d1b0a-13a9-77dd-b41f-374ee144bd07': 'RM7-E1L5',
        '019d1b0a-13a9-77dd-b41f-3a21d490cb2d': 'RM7-E1SCP',
        '019d1b0a-13a9-77dd-b41f-3ffb5f671742': 'RM7-S4L4',
        '019d53aa-5101-7f08-b3dd-378b0ddcf7d0': 'RM7-E1L2CT',
        '019d29c5-4b37-7436-aef9-89af09560af3': 'D4RK RM7CE',
        '019d29c5-4b37-79bf-b23e-304d8ea03c15': 'D4RK RM7MI',
        '019d29c5-4b37-7de9-b46c-022179bcb5eb': 'D4RK 2IV2',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a105': 'RM7-N2ECP',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a101': 'RM7-N2L2',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a102': 'RM7-N2L3',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a103': 'RM7-W3L2',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a104': 'RM7-N1L1',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a106': 'RM7-W3NCP',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a108': 'SRM7-M'
    };
    const MARKET_ID_MAP = {
        '019d3ea4-85bd-7389-904d-8f7c85841134': 'HOME',
        '019d3ea4-85bd-7389-904d-908ba9194aa0': 'D4RK',
        '019da731-2db5-7d76-9447-1ea3b9b78001': 'SOYUZ'
    };

    const NO_SERVER_ACTIONS = new Set(['get.map', 'network-map']);
    const PAGE_SIZE = 1000;

    // --- IndexedDB access via chrome.scripting.executeScript ---
    // The DB lives on the cor3.gg origin (written by content script ws-messages.js).
    // DevTools panel runs on chrome-extension:// origin and cannot access it directly.
    // We use chrome.scripting.executeScript to run queries in the inspected tab's context.

    function getInspectedTabId() {
        return chrome.devtools.inspectedWindow.tabId;
    }

    async function runInTab(fn, args) {
        const tabId = getInspectedTabId();
        if (!tabId) {
            console.warn('[COR3 Panel] No inspected tab ID');
            return null;
        }
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: fn,
                args: args || []
            });
            if (results && results[0]) return results[0].result;
            return null;
        } catch (e) {
            console.error('[COR3 Panel] executeScript failed:', e);
            return null;
        }
    }

    async function dbCount() {
        const result = await runInTab(() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('cor3_ws_db', 1);
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('messages')) { db.close(); resolve(0); return; }
                    const tx = db.transaction('messages', 'readonly');
                    const cr = tx.objectStore('messages').count();
                    cr.onsuccess = () => { resolve(cr.result); db.close(); };
                    cr.onerror = () => { resolve(0); db.close(); };
                };
                req.onerror = () => resolve(0);
            });
        });
        console.log('[COR3 Panel] dbCount =', result);
        return result || 0;
    }

    async function dbGetPage(start, limit) {
        const result = await runInTab((s, l) => {
            return new Promise((resolve) => {
                const req = indexedDB.open('cor3_ws_db', 1);
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('messages')) { db.close(); resolve([]); return; }
                    const tx = db.transaction('messages', 'readonly');
                    const store = tx.objectStore('messages');
                    const results = [];
                    let skipped = 0;
                    const cur = store.openCursor();
                    cur.onsuccess = (ev) => {
                        const cursor = ev.target.result;
                        if (!cursor || results.length >= l) { resolve(results); db.close(); return; }
                        if (skipped < s) { skipped++; cursor.continue(); return; }
                        results.push(cursor.value);
                        cursor.continue();
                    };
                    cur.onerror = () => { resolve(results); db.close(); };
                };
                req.onerror = () => resolve([]);
            });
        }, [start, limit]);
        console.log('[COR3 Panel] dbGetPage(' + start + ',' + limit + ') returned', (result || []).length, 'entries');
        return result || [];
    }

    async function dbGetAfter(isoTs) {
        const result = await runInTab((ts) => {
            return new Promise((resolve) => {
                const req = indexedDB.open('cor3_ws_db', 1);
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('messages')) { db.close(); resolve([]); return; }
                    const tx = db.transaction('messages', 'readonly');
                    const idx = tx.objectStore('messages').index('timestamp');
                    const range = IDBKeyRange.lowerBound(ts, true);
                    const results = [];
                    const cur = idx.openCursor(range);
                    cur.onsuccess = (ev) => {
                        const cursor = ev.target.result;
                        if (!cursor) { resolve(results); db.close(); return; }
                        results.push(cursor.value);
                        cursor.continue();
                    };
                    cur.onerror = () => { resolve(results); db.close(); };
                };
                req.onerror = () => resolve([]);
            });
        }, [isoTs]);
        return result || [];
    }

    async function dbClear() {
        await runInTab(() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('cor3_ws_db', 1);
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('messages')) { db.close(); resolve(); return; }
                    const tx = db.transaction('messages', 'readwrite');
                    tx.objectStore('messages').clear();
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => { db.close(); resolve(); };
                };
                req.onerror = () => resolve();
            });
        });
        console.log('[COR3 Panel] dbClear completed');
    }

    // --- State ---
    let allMessages = [];
    let filteredMessages = [];
    let selectedIndex = -1;
    let liveMode = false;
    let liveTimer = null;
    let lastLiveTimestamp = null;
    let detailFormat = 'pretty';
    let selectedRawMessage = '';
    let currentPage = -1; // -1 = latest page (XXX-now)
    let totalCount = 0;

    // Detail search state
    let detailSearchMatches = [];
    let detailSearchCurrent = -1;
    let detailSearchQuery = '';

    // --- DOM refs ---
    const messageList = document.getElementById('messageList');
    const emptyState = document.getElementById('emptyState');
    const detailPanel = document.getElementById('detailPanel');
    const detailMeta = document.getElementById('detailMeta');
    const detailBody = document.getElementById('detailBody');
    const detailClose = document.getElementById('detailClose');
    const detailResizeHandle = document.getElementById('detailResizeHandle');
    const detailFormatSelect = document.getElementById('detailFormatSelect');
    const detailSearchInput = document.getElementById('detailSearchInput');
    const detailSearchBtn = document.getElementById('detailSearchBtn');
    const detailSearchCount = document.getElementById('detailSearchCount');
    const searchInput = document.getElementById('searchInput');
    const filterSent = document.getElementById('filterSent');
    const filterReceived = document.getElementById('filterReceived');
    const statsLabel = document.getElementById('statsLabel');
    const pageSelector = document.getElementById('pageSelector');
    const btnLive = document.getElementById('btnLive');
    const btnClear = document.getElementById('btnClear');
    const btnSendToggle = document.getElementById('btnSendToggle');
    const sendPanel = document.getElementById('sendPanel');
    const sendInput = document.getElementById('sendInput');
    const btnSend = document.getElementById('btnSend');
    const listHeader = document.getElementById('listHeader');
    const btnExport = document.getElementById('btnExport');
    const exportMenu = document.getElementById('exportMenu');
    const btnExportJson = document.getElementById('btnExportJson');
    const btnExportMd = document.getElementById('btnExportMd');

    // --- Helpers ---
    function formatTime(isoStr) {
        try {
            const d = new Date(isoStr);
            return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
                + '.' + String(d.getMilliseconds()).padStart(3, '0');
        } catch (e) { return '??:??:??'; }
    }

    function formatSize(str) {
        const len = str ? str.length : 0;
        if (len < 1024) return len + ' B';
        return (len / 1024).toFixed(1) + ' KB';
    }

    function parseEvent(msg) {
        // Socket.IO v4 format: 42["eventName", ...] or 42/namespace,["eventName", ...]
        if (!msg || typeof msg !== 'string') return { event: '—', payload: null };
        const match = msg.match(/^42(?:\/[^,]*,)?\["([^"]+)"/);
        if (match) {
            return { event: match[1], payload: msg };
        }
        if (msg === '2') return { event: 'ping', payload: null };
        if (msg === '3') return { event: 'pong', payload: null };
        if (msg.startsWith('0{')) return { event: 'handshake', payload: msg };
        if (msg === '40') return { event: 'connect', payload: null };
        return { event: '—', payload: msg };
    }

    // Extract the parsed JSON data from a Socket.IO 42-frame message
    function parseMsgData(msg) {
        if (!msg || typeof msg !== 'string') return null;
        const match = msg.match(/^42(?:\/[^,]*,)?(\[.+)$/s);
        if (!match) return null;
        try {
            const arr = JSON.parse(match[1]);
            if (Array.isArray(arr) && arr.length >= 2) return arr[1];
        } catch (e) { /* silent */ }
        return null;
    }

    // Extract action from parsed payload (data.event.action or data.action)
    function extractAction(data) {
        if (!data || typeof data !== 'object') return '—';
        if (data.event && data.event.action) return data.event.action;
        if (data.action) return data.action;
        return '—';
    }

    // Resolve server name from serverId or marketId in the parsed data
    function resolveServer(data) {
        if (!data || typeof data !== 'object') return '—';
        // For actions where server info is not meaningful, show '—'
        const action = extractAction(data);
        if (NO_SERVER_ACTIONS.has(action)) return '—';
        // Check data.serverId directly
        if (data.serverId && SERVER_ID_MAP[data.serverId]) return SERVER_ID_MAP[data.serverId];
        if (data.serverId) return data.serverId.substring(0, 8) + '…';
        // Check nested data.data.serverId
        if (data.data && data.data.serverId && SERVER_ID_MAP[data.data.serverId]) return SERVER_ID_MAP[data.data.serverId];
        if (data.data && data.data.serverId) return data.data.serverId.substring(0, 8) + '…';
        // Check data.data.currentEndpointId (set.endpoint server responses)
        if (data.data && data.data.currentEndpointId && SERVER_ID_MAP[data.data.currentEndpointId]) return SERVER_ID_MAP[data.data.currentEndpointId];
        if (data.data && data.data.currentEndpointId) return data.data.currentEndpointId.substring(0, 8) + '…';
        // Check data.marketId → resolve to market name (client msgs: get.options, get.lots, get.jobs)
        if (data.marketId && MARKET_ID_MAP[data.marketId]) return MARKET_ID_MAP[data.marketId];
        // Check nested data.data.marketId (client msgs send marketId inside data)
        if (data.data && data.data.marketId && MARKET_ID_MAP[data.data.marketId]) return MARKET_ID_MAP[data.data.marketId];
        if (data.data && data.data.market && data.data.market.id && MARKET_ID_MAP[data.data.market.id]) return MARKET_ID_MAP[data.data.market.id];
        return '—';
    }

    function tryPrettyPrint(raw) {
        if (!raw) return '';
        // Try to extract the JSON array from a Socket.IO frame
        const match = raw.match(/^42(?:\/[^,]*,)?(\[.+)$/s);
        if (match) {
            try {
                const parsed = JSON.parse(match[1]);
                const event = parsed[0];
                const data = parsed.length > 1 ? parsed.slice(1) : [];
                let result = 'Event: ' + event + '\n';
                if (data.length === 1) {
                    result += '\n' + JSON.stringify(data[0], null, 2);
                } else if (data.length > 1) {
                    result += '\n' + JSON.stringify(data, null, 2);
                }
                return result;
            } catch (e) { /* fall through */ }
        }
        // Handshake (0{...})
        if (raw.startsWith('0{')) {
            try {
                return 'Handshake\n\n' + JSON.stringify(JSON.parse(raw.substring(1)), null, 2);
            } catch (e) { /* fall through */ }
        }
        // Try plain JSON
        try {
            return JSON.stringify(JSON.parse(raw), null, 2);
        } catch (e) { /* fall through */ }
        return raw;
    }

    // --- Tree View Renderer (Chrome Network tab style previews) ---
    function buildTreeView(raw) {
        let data;
        const match = raw.match(/^42(?:\/[^,]*,)?(\[.+)$/s);
        if (match) {
            try { data = JSON.parse(match[1]); } catch (e) { return null; }
        } else if (raw.startsWith('0{')) {
            try { data = JSON.parse(raw.substring(1)); } catch (e) { return null; }
        } else {
            try { data = JSON.parse(raw); } catch (e) { return null; }
        }

        const container = document.createElement('div');
        container.className = 'tree-view';
        renderTreeNode(container, data, null, true);
        return container;
    }

    function objectPreview(value, maxLen) {
        if (value === null || typeof value !== 'object') return '';
        try {
            const s = JSON.stringify(value);
            return s.length > maxLen ? s.substring(0, maxLen) + '…' : s;
        } catch (e) { return ''; }
    }

    function renderTreeNode(parent, value, key, expanded) {
        const node = document.createElement('div');
        node.className = 'tree-node';

        if (value !== null && typeof value === 'object') {
            const isArray = Array.isArray(value);
            const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
            const openBracket = isArray ? '[' : '{';
            const closeBracket = isArray ? ']' : '}';

            const toggle = document.createElement('span');
            toggle.className = 'tree-toggle';
            toggle.textContent = expanded ? '▼' : '▶';
            node.appendChild(toggle);

            if (key !== null) {
                const keySpan = document.createElement('span');
                keySpan.className = 'tree-key';
                keySpan.textContent = JSON.stringify(String(key)) + ': ';
                node.appendChild(keySpan);
            }

            const bracket = document.createElement('span');
            bracket.className = 'tree-bracket';
            if (entries.length === 0) {
                bracket.textContent = openBracket + closeBracket;
            } else {
                bracket.textContent = openBracket;
            }
            node.appendChild(bracket);

            const previewSpan = document.createElement('span');
            previewSpan.className = 'tree-preview';
            previewSpan.style.color = '#6c7086';
            if (entries.length > 0) {
                previewSpan.textContent = expanded ? '' : ' ' + objectPreview(value, 120);
            }
            node.appendChild(previewSpan);

            const children = document.createElement('div');
            children.className = 'tree-children' + (expanded ? '' : ' collapsed');

            for (const [k, v] of entries) {
                renderTreeNode(children, v, k, false);
            }

            const closeLine = document.createElement('div');
            closeLine.className = 'tree-node';
            const closeBr = document.createElement('span');
            closeBr.className = 'tree-bracket';
            closeBr.textContent = closeBracket;
            closeLine.appendChild(closeBr);
            children.appendChild(closeLine);

            parent.appendChild(node);
            parent.appendChild(children);

            toggle.addEventListener('click', () => {
                const isCollapsed = children.classList.toggle('collapsed');
                toggle.textContent = isCollapsed ? '▶' : '▼';
                previewSpan.textContent = isCollapsed && entries.length > 0 ? ' ' + objectPreview(value, 120) : '';
            });
        } else {
            const indent = document.createElement('span');
            indent.style.display = 'inline-block';
            indent.style.width = '14px';
            node.appendChild(indent);

            if (key !== null) {
                const keySpan = document.createElement('span');
                keySpan.className = 'tree-key';
                keySpan.textContent = JSON.stringify(String(key)) + ': ';
                node.appendChild(keySpan);
            }

            const valSpan = document.createElement('span');
            if (typeof value === 'string') {
                valSpan.className = 'tree-string';
                valSpan.textContent = JSON.stringify(value);
            } else if (typeof value === 'number') {
                valSpan.className = 'tree-number';
                valSpan.textContent = String(value);
            } else if (typeof value === 'boolean') {
                valSpan.className = 'tree-boolean';
                valSpan.textContent = String(value);
            } else {
                valSpan.className = 'tree-null';
                valSpan.textContent = 'null';
            }
            node.appendChild(valSpan);
            parent.appendChild(node);
        }
    }

    // --- Detail Search (works in raw/pretty AND tree view) ---
    function performDetailSearch() {
        const query = detailSearchInput.value.trim();
        detailSearchQuery = query;
        detailSearchMatches = [];
        detailSearchCurrent = -1;
        detailSearchCount.textContent = '';
        if (!query) return;

        if (detailFormat === 'tree') {
            performTreeSearch(query);
            return;
        }

        const text = detailBody.textContent;
        const lower = text.toLowerCase();
        const queryLower = query.toLowerCase();
        let idx = 0;
        while (idx < lower.length) {
            const found = lower.indexOf(queryLower, idx);
            if (found === -1) break;
            detailSearchMatches.push({ start: found, end: found + query.length });
            idx = found + 1;
        }

        if (detailSearchMatches.length === 0) {
            detailSearchCount.textContent = '0 matches';
            return;
        }

        detailSearchCurrent = 0;
        highlightDetailMatches();
    }

    function performTreeSearch(query) {
        const queryLower = query.toLowerCase();
        const nodes = detailBody.querySelectorAll('.tree-node');
        detailSearchMatches = [];
        nodes.forEach(node => {
            const text = node.textContent.toLowerCase();
            if (text.includes(queryLower)) {
                detailSearchMatches.push({ node });
            }
        });
        if (detailSearchMatches.length === 0) {
            detailSearchCount.textContent = '0 matches';
            return;
        }
        detailSearchCurrent = 0;
        highlightTreeMatch();
    }

    function highlightTreeMatch() {
        detailBody.querySelectorAll('.tree-node').forEach(n => n.style.background = '');
        if (detailSearchMatches.length === 0) return;
        const m = detailSearchMatches[detailSearchCurrent];
        if (!m || !m.node) return;
        let el = m.node;
        while (el && el !== detailBody) {
            if (el.classList && el.classList.contains('tree-children') && el.classList.contains('collapsed')) {
                el.classList.remove('collapsed');
                const prev = el.previousElementSibling;
                if (prev) {
                    const tog = prev.querySelector('.tree-toggle');
                    if (tog) tog.textContent = '▼';
                    const pv = prev.querySelector('.tree-preview');
                    if (pv) pv.textContent = '';
                }
            }
            el = el.parentElement;
        }
        m.node.style.background = '#f9e2af33';
        m.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        detailSearchCount.textContent = `${detailSearchCurrent + 1}/${detailSearchMatches.length}`;
    }

    function highlightDetailMatches() {
        if (detailSearchMatches.length === 0) return;

        const text = detailBody.textContent;
        const fragment = document.createDocumentFragment();
        let lastEnd = 0;

        for (let i = 0; i < detailSearchMatches.length; i++) {
            const m = detailSearchMatches[i];
            if (m.start > lastEnd) {
                fragment.appendChild(document.createTextNode(text.substring(lastEnd, m.start)));
            }
            const span = document.createElement('span');
            span.className = 'search-highlight' + (i === detailSearchCurrent ? ' current' : '');
            span.textContent = text.substring(m.start, m.end);
            if (i === detailSearchCurrent) span.id = 'currentSearchMatch';
            fragment.appendChild(span);
            lastEnd = m.end;
        }
        if (lastEnd < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastEnd)));
        }

        detailBody.innerHTML = '';
        detailBody.appendChild(fragment);
        detailSearchCount.textContent = `${detailSearchCurrent + 1}/${detailSearchMatches.length}`;

        const current = document.getElementById('currentSearchMatch');
        if (current) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function nextDetailMatch() {
        if (detailSearchMatches.length === 0) {
            performDetailSearch();
            return;
        }
        detailSearchCurrent = (detailSearchCurrent + 1) % detailSearchMatches.length;
        if (detailFormat === 'tree') {
            highlightTreeMatch();
        } else {
            highlightDetailMatches();
        }
    }

    // --- Page selector ---
    async function refreshPageSelector() {
        totalCount = await dbCount();
        const pages = Math.ceil(totalCount / PAGE_SIZE);
        const prevVal = pageSelector.value;
        pageSelector.innerHTML = '';
        if (pages === 0) {
            const opt = document.createElement('option');
            opt.value = '-1';
            opt.textContent = '0-now';
            pageSelector.appendChild(opt);
        } else {
            for (let i = 0; i < pages; i++) {
                const start = i * PAGE_SIZE;
                const isLast = i === pages - 1;
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = isLast ? `${start}-now` : `${start}-${start + PAGE_SIZE}`;
                pageSelector.appendChild(opt);
            }
        }
        if (currentPage === -1 || currentPage >= pages) {
            pageSelector.value = String(Math.max(0, pages - 1));
            currentPage = Math.max(0, pages - 1);
        } else {
            pageSelector.value = String(currentPage);
        }
    }

    async function loadCurrentPage() {
        const start = currentPage * PAGE_SIZE;
        allMessages = await dbGetPage(start, PAGE_SIZE);
        applyFilters();
    }

    async function pullLiveMessages() {
        try {
            if (!lastLiveTimestamp) return;
            const newMsgs = await dbGetAfter(lastLiveTimestamp);
            if (newMsgs.length === 0) return;
            console.log('[COR3 Panel] Live pull:', newMsgs.length, 'new messages');
            for (const m of newMsgs) allMessages.push(m);
            if (allMessages.length > PAGE_SIZE) {
                allMessages = allMessages.slice(allMessages.length - PAGE_SIZE);
            }
            lastLiveTimestamp = newMsgs[newMsgs.length - 1].timestamp;
            applyFilters();
            await refreshPageSelector();
        } catch (e) {
            console.error('[COR3 Panel] Failed to pull live WS messages:', e);
        }
    }

    // --- Filtering ---
    function applyFilters() {
        const search = searchInput.value.toLowerCase().trim();
        const showSent = filterSent.checked;
        const showReceived = filterReceived.checked;

        filteredMessages = allMessages.filter(m => {
            if (m.direction === 'sent' && !showSent) return false;
            if (m.direction === 'received' && !showReceived) return false;
            if (search) {
                const parsed = parseEvent(m.message);
                const msgData = parseMsgData(m.message);
                const action = msgData ? extractAction(msgData) : '';
                const server = msgData ? resolveServer(msgData) : '';
                const haystack = (parsed.event + ' ' + action + ' ' + server + ' ' + (m.message || '')).toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            return true;
        });

        renderList();
        updateStats();
    }

    // --- Render message list ---
    function renderList() {
        if (filteredMessages.length === 0) {
            messageList.innerHTML = '';
            messageList.appendChild(emptyState);
            emptyState.style.display = '';
            return;
        }
        emptyState.style.display = 'none';

        const fragment = document.createDocumentFragment();
        for (let i = 0; i < filteredMessages.length; i++) {
            const m = filteredMessages[i];
            const parsed = parseEvent(m.message);
            const msgData = parseMsgData(m.message);
            const action = msgData ? extractAction(msgData) : '—';
            const server = msgData ? resolveServer(msgData) : '—';

            const row = document.createElement('div');
            row.className = 'msg-row' + (i === selectedIndex ? ' selected' : '');
            row.dataset.index = i;

            const dir = document.createElement('span');
            dir.className = 'msg-dir ' + m.direction;
            dir.textContent = m.direction === 'sent' ? '▲' : '▼';
            dir.title = m.direction;
            row.appendChild(dir);

            const time = document.createElement('span');
            time.className = 'msg-time';
            time.textContent = formatTime(m.timestamp);
            row.appendChild(time);

            const evt = document.createElement('span');
            evt.className = 'msg-event';
            evt.textContent = parsed.event;
            evt.title = parsed.event;
            row.appendChild(evt);

            const act = document.createElement('span');
            act.className = 'msg-action';
            act.textContent = action;
            act.title = action;
            row.appendChild(act);

            const srv = document.createElement('span');
            srv.className = 'msg-server';
            srv.textContent = server;
            srv.title = server;
            row.appendChild(srv);

            const preview = document.createElement('span');
            preview.className = 'msg-preview';
            let previewText = '';
            if (msgData) {
                try { previewText = JSON.stringify(msgData); } catch (e) { previewText = m.message || ''; }
            } else {
                previewText = m.message || '';
            }
            if (previewText.length > 200) previewText = previewText.substring(0, 200) + '…';
            preview.textContent = previewText;
            preview.title = previewText;
            row.appendChild(preview);

            const size = document.createElement('span');
            size.className = 'msg-size';
            size.textContent = formatSize(m.message);
            row.appendChild(size);

            row.addEventListener('click', () => selectMessage(i));
            fragment.appendChild(row);
        }

        messageList.replaceChildren(fragment);

        if (liveMode) {
            messageList.scrollTop = messageList.scrollHeight;
        }
    }

    // --- Select a message to show detail ---
    function selectMessage(index) {
        selectedIndex = index;
        const m = filteredMessages[index];
        if (!m) return;

        const rows = messageList.querySelectorAll('.msg-row');
        rows.forEach((r, i) => r.classList.toggle('selected', i === index));

        detailPanel.classList.add('open');

        const parsed = parseEvent(m.message);
        const msgData = parseMsgData(m.message);
        const action = msgData ? extractAction(msgData) : '—';
        const server = msgData ? resolveServer(msgData) : '—';
        const dirClass = m.direction === 'sent' ? 'dir-sent' : 'dir-received';
        const dirLabel = m.direction === 'sent' ? '▲ SENT' : '▼ RECEIVED';
        detailMeta.innerHTML = `<span class="${dirClass}">${dirLabel}</span>`
            + `<span>Time: ${formatTime(m.timestamp)}</span>`
            + `<span>Event: <strong>${escapeHtml(parsed.event)}</strong></span>`
            + `<span>Action: <strong>${escapeHtml(action)}</strong></span>`
            + `<span>Server: <strong>${escapeHtml(server)}</strong></span>`
            + `<span>Size: ${formatSize(m.message)}</span>`;

        selectedRawMessage = m.message;
        renderDetailBody();

        detailSearchInput.value = '';
        detailSearchMatches = [];
        detailSearchCurrent = -1;
        detailSearchQuery = '';
        detailSearchCount.textContent = '';
    }

    function renderDetailBody() {
        detailBody.innerHTML = '';
        if (detailFormat === 'tree') {
            const tree = buildTreeView(selectedRawMessage);
            if (tree) {
                detailBody.appendChild(tree);
            } else {
                detailBody.textContent = selectedRawMessage;
            }
        } else if (detailFormat === 'pretty') {
            detailBody.textContent = tryPrettyPrint(selectedRawMessage);
        } else {
            detailBody.textContent = selectedRawMessage;
        }
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function closeDetail() {
        detailPanel.classList.remove('open');
        selectedIndex = -1;
        const rows = messageList.querySelectorAll('.msg-row');
        rows.forEach(r => r.classList.remove('selected'));
    }

    // --- Stats ---
    function updateStats() {
        const sent = filteredMessages.filter(m => m.direction === 'sent').length;
        const recv = filteredMessages.filter(m => m.direction === 'received').length;
        statsLabel.textContent = `(▲${sent} ▼${recv})`;
    }

    function toggleLive() {
        liveMode = !liveMode;
        btnLive.classList.toggle('active', liveMode);
        btnLive.textContent = liveMode ? '● Live ON' : '● Live';

        if (liveMode) {
            lastLiveTimestamp = new Date().toISOString();
            allMessages = [];
            applyFilters();
            liveTimer = setInterval(pullLiveMessages, 1500);
            console.log('[COR3 Panel] Live mode ON from', lastLiveTimestamp);
        } else {
            if (liveTimer) clearInterval(liveTimer);
            liveTimer = null;
            console.log('[COR3 Panel] Live mode OFF');
            refreshPageSelector().then(() => loadCurrentPage());
        }
    }

    // --- Export ---
    function getPreviewText(msgData, raw) {
        let previewText = '';
        if (msgData) {
            try { previewText = JSON.stringify(msgData); } catch (e) { previewText = raw || ''; }
        } else {
            previewText = raw || '';
        }
        if (previewText.length > 200) previewText = previewText.substring(0, 200) + '…';
        return previewText;
    }

    function exportAsJson() {
        const data = filteredMessages.map(m => {
            const parsed = parseEvent(m.message);
            const msgData = parseMsgData(m.message);
            return {
                direction: m.direction,
                timestamp: m.timestamp,
                event: parsed.event,
                action: msgData ? extractAction(msgData) : '—',
                server: msgData ? resolveServer(msgData) : '—',
                preview: getPreviewText(msgData, m.message),
                raw: m.message,
                data: msgData
            };
        });
        downloadFile('cor3-ws-export.json', JSON.stringify(data, null, 2), 'application/json');
    }

    function exportAsMd() {
        let md = '| Dir | Time | Event | Action | Server | Preview | Size |\n';
        md += '|-----|------|-------|--------|--------|---------|------|\n';
        for (const m of filteredMessages) {
            const parsed = parseEvent(m.message);
            const msgData = parseMsgData(m.message);
            const action = msgData ? extractAction(msgData) : '—';
            const server = msgData ? resolveServer(msgData) : '—';
            const dir = m.direction === 'sent' ? '▲' : '▼';
            let preview = getPreviewText(msgData, m.message);
            preview = preview.replace(/\|/g, '\\|');
            md += `| ${dir} | ${formatTime(m.timestamp)} | ${parsed.event} | ${action} | ${server} | ${preview} | ${formatSize(m.message)} |\n`;
        }
        downloadFile('cor3-ws-export.md', md, 'text/markdown');
    }

    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function sendWsMessage() {
        const msg = sendInput.value.trim();
        if (!msg) return;

        try {
            const tabId = getInspectedTabId();
            await chrome.tabs.sendMessage(tabId, {
                action: 'devtoolsSendWs',
                message: msg
            });
            sendInput.value = '';
            console.log('[COR3 Panel] Sent WS message to tab', tabId);
        } catch (e) {
            console.error('[COR3 Panel] Failed to send WS message:', e);
            alert('Failed to send: ' + e.message);
        }
    }

    // --- Clear messages (deletes from IndexedDB) ---
    async function clearMessages() {
        allMessages = [];
        filteredMessages = [];
        selectedIndex = -1;
        lastLiveTimestamp = new Date().toISOString();
        closeDetail();
        await dbClear();
        await refreshPageSelector();
        applyFilters();
    }

    // --- Column resize logic ---
    const COL_VAR_MAP = {
        time: '--col-time',
        event: '--col-event',
        action: '--col-action',
        server: '--col-server'
    };

    let resizeState = null;

    function onResizeStart(e) {
        const col = e.target.dataset.col;
        if (!col || !COL_VAR_MAP[col]) return;
        e.preventDefault();
        e.stopPropagation();
        const cssVar = COL_VAR_MAP[col];
        const startX = e.clientX;
        const startWidth = parseInt(getComputedStyle(document.body).getPropertyValue(cssVar)) || 80;
        e.target.classList.add('active');
        resizeState = { cssVar, startX, startWidth, handle: e.target };
    }

    document.addEventListener('mousemove', (e) => {
        if (!resizeState) return;
        const diff = e.clientX - resizeState.startX;
        const newWidth = Math.max(40, resizeState.startWidth + diff);
        document.body.style.setProperty(resizeState.cssVar, newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
        if (!resizeState) return;
        if (resizeState.handle) resizeState.handle.classList.remove('active');
        resizeState = null;
    });

    listHeader.querySelectorAll('.col-resize').forEach(handle => {
        handle.addEventListener('mousedown', onResizeStart);
    });

    // --- Event Listeners ---
    btnLive.addEventListener('click', toggleLive);
    btnClear.addEventListener('click', clearMessages);
    detailClose.addEventListener('click', closeDetail);

    detailFormatSelect.addEventListener('change', () => {
        detailFormat = detailFormatSelect.value;
        if (selectedRawMessage) {
            renderDetailBody();
            if (detailSearchInput.value.trim()) performDetailSearch();
        }
    });

    detailSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); nextDetailMatch(); }
    });
    detailSearchInput.addEventListener('input', () => {
        performDetailSearch();
    });
    detailSearchBtn.addEventListener('click', () => {
        performDetailSearch();
    });

    pageSelector.addEventListener('change', () => {
        currentPage = parseInt(pageSelector.value) || 0;
        if (liveMode) {
            liveMode = false;
            btnLive.classList.remove('active');
            btnLive.textContent = '● Live';
            if (liveTimer) clearInterval(liveTimer);
            liveTimer = null;
        }
        loadCurrentPage();
    });

    btnExport.addEventListener('click', (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle('open');
    });
    btnExportJson.addEventListener('click', () => { exportMenu.classList.remove('open'); exportAsJson(); });
    btnExportMd.addEventListener('click', () => { exportMenu.classList.remove('open'); exportAsMd(); });
    document.addEventListener('click', () => exportMenu.classList.remove('open'));

    (function initDetailResize() {
        let startX, startW;
        function onMouseDown(e) {
            e.preventDefault();
            startX = e.clientX;
            startW = detailPanel.offsetWidth;
            detailPanel.classList.add('resizing');
            detailResizeHandle.classList.add('active');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
        function onMouseMove(e) {
            const dx = startX - e.clientX;
            const newW = Math.max(200, Math.min(startW + dx, window.innerWidth * 0.85));
            detailPanel.style.width = newW + 'px';
        }
        function onMouseUp() {
            detailPanel.classList.remove('resizing');
            detailResizeHandle.classList.remove('active');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
        detailResizeHandle.addEventListener('mousedown', onMouseDown);
    })();

    btnSendToggle.addEventListener('click', () => {
        const isOpen = sendPanel.classList.toggle('open');
        btnSendToggle.classList.toggle('active', isOpen);
        if (isOpen) sendInput.focus();
    });

    btnSend.addEventListener('click', sendWsMessage);
    sendInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendWsMessage();
        }
    });

    searchInput.addEventListener('input', applyFilters);
    filterSent.addEventListener('change', applyFilters);
    filterReceived.addEventListener('change', applyFilters);

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') { closeDetail(); return; }
        if (filteredMessages.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(selectedIndex + 1, filteredMessages.length - 1);
            selectMessage(next);
            const rows = messageList.querySelectorAll('.msg-row');
            if (rows[next]) rows[next].scrollIntoView({ block: 'nearest' });
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = Math.max(selectedIndex - 1, 0);
            selectMessage(prev);
            const rows = messageList.querySelectorAll('.msg-row');
            if (rows[prev]) rows[prev].scrollIntoView({ block: 'nearest' });
        }
    });

    // --- Initial load: populate page selector and load latest page ---
    (async function init() {
        console.log('[COR3 Panel] Initializing, inspected tab:', getInspectedTabId());
        await refreshPageSelector();
        await loadCurrentPage();
        console.log('[COR3 Panel] Init complete — totalCount:', totalCount, 'loaded:', allMessages.length);
    })();
})();
