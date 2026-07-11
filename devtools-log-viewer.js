// devtools-log-viewer.js — Offline log viewer (popout window)
// Supports importing JSON, MD table, and Discord clipboard formats exported by the extension.

(function () {
    'use strict';

    const SERVER_ID_MAP = {
        '019e4052-c316-73aa-81f6-567c9a8f5738': 'B43271N',
        '019e4052-c316-73aa-81f6-5aa82fc72bdd': 'B43272N',
        '019e4052-c316-73aa-81f6-60ec61b61f0a': 'B43274N',
        '019e4052-c317-7388-9d71-8044f31bdc0d': 'D4RK 2IV0/3',
        '019d29c5-4b37-7de9-b46c-022179bcb5eb': 'D4RK 2IV2',
        '019d29c5-4b37-7436-aef9-89af09560af3': 'D4RK RM7CE',
        '019e4052-c316-73aa-81f6-483e50247e61': 'D4RK RM7EG',
        '019d29c5-4b37-79bf-b23e-304d8ea03c15': 'D4RK RM7MI',
        '019e4052-c316-73aa-81f6-4da2a3e8df51': 'D4RK T43272',
        '019e4052-c316-73aa-81f6-53432dbee49d': 'D4RK T43274',
        '019dbe42-7a63-7a11-9f4d-8a6a61d2a201': 'EM[RM7-E2L2]',
        '019dbe42-7a63-7a11-9f4d-8a6a61d2a202': 'EM[undefined]',
        '019c0a5b-eeeb-7d3e-b9c9-fd5c2ba7d399': 'HOME',
        '019d53aa-5101-7f08-b3dd-378b0ddcf7d0': 'RM7-E1L2CT',
        '019d1b0a-13a9-77dd-b41f-33f06f2df284': 'RM7-E1L3',
        '019d1b0a-13a9-77dd-b41f-374ee144bd07': 'RM7-E1L5',
        '019d1b0a-13a9-77dd-b41f-3a21d490cb2d': 'RM7-E1SCP',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a104': 'RM7-N1L1',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a105': 'RM7-N2ECP',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a101': 'RM7-N2L2',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a102': 'RM7-N2L3',
        '019e4052-c315-71df-80da-4e334b96c9e6': 'RM7-S4L1',
        '019e4052-c316-73aa-81f6-38c323c58eb2': 'RM7-S4L2',
        '019e4052-c316-73aa-81f6-3dcef4d6873e': 'RM7-S4L3',
        '019d1b0a-13a9-77dd-b41f-3ffb5f671742': 'RM7-S4L4',
        '019e4052-c316-73aa-81f6-448645a38c9e': 'RM7-S4WCP',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a103': 'RM7-W3L2',
        '019e4052-c316-73aa-81f6-4059ea0554e0': 'RM7-W3L4',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a106': 'RM7-W3NCP',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a10b': 'SPRM7-N4L3',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a108': 'SRM7-M',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a107': 'SRM7-N3L1',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a109': 'SRM7-N3L2',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a10a': 'SRM7-N4L2',
        '019da6f1-16f7-75a6-b6d3-0b1d5f92a10c': 'SRRM7',
        '019e4052-c317-7388-9d71-96d991fb4b99': 'UPRM7-S3L2',
        '019e4052-c317-7388-9d71-8fed6faaaf99': 'URM7-H',
        '019e4052-c317-7388-9d71-883ffb1560cd': 'URM7-M',
        '019e4052-c317-7388-9d71-85b98a02d5fb': 'URM7-S5L2',
        '019e4052-c317-7388-9d71-91d0758336ae': 'URM7-W4L2',
        '019e4052-c317-7388-9d71-9aadc2e7c42b': 'URRM7'
    };
    const MARKET_ID_MAP = {
        '019d3ea4-85bd-7389-904d-8f7c85841134': 'HOME',
        '019d3ea4-85bd-7389-904d-908ba9194aa0': 'D4RK',
        '019da731-2db5-7d76-9447-1ea3b9b78001': 'SOYUZ',
        '019e4065-6ae8-760d-8724-58ab4f2cf7d7': 'USOL'
    };

    const NO_SERVER_ACTIONS = new Set(['get.map', 'network-map']);
    const PAGE_SIZE = 1000;

    // --- State ---
    let importedData = {
        wsLogs: [],
        autoJobSolverLogs: [],
        autoValuableSellerLogs: [],
        extensionErrors: [],
        pageConsoleLogs: [],
        extensionConsoleLogs: []
    };
    let allMessages = [];
    let filteredMessages = [];
    let selectedIndex = -1;
    let detailFormat = 'pretty';
    let selectedRawMessage = '';
    let currentPage = 0;
    let totalCount = 0;
    let currentCategory = 'ws-messages';

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
    const categorySelect = document.getElementById('categorySelect');
    const listHeader = document.getElementById('listHeader');
    const btnImport = document.getElementById('btnImport');
    const importFileInput = document.getElementById('importFileInput');

    // --- Helpers (same as devtools-panel.js) ---
    function formatTime(isoStr) {
        try {
            const d = new Date(isoStr);
            return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })
                + '.' + String(d.getUTCMilliseconds()).padStart(3, '0');
        } catch (e) { return '??:??:??'; }
    }

    function formatSize(str) {
        const len = str ? str.length : 0;
        if (len < 1024) return len + ' B';
        return (len / 1024).toFixed(1) + ' KB';
    }

    function parseEvent(msg) {
        if (!msg || typeof msg !== 'string') return { event: '—', payload: null };
        const match = msg.match(/^42(?:\/[^,]*,)?\["([^"]+)"/);
        if (match) return { event: match[1], payload: msg };
        if (msg === '2') return { event: 'ping', payload: null };
        if (msg === '3') return { event: 'pong', payload: null };
        if (msg.startsWith('0{')) return { event: 'handshake', payload: msg };
        if (msg === '40') return { event: 'connect', payload: null };
        return { event: '—', payload: msg };
    }

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

    function extractAction(data) {
        if (!data || typeof data !== 'object') return '—';
        if (data.event && data.event.action) return data.event.action;
        if (data.action) return data.action;
        return '—';
    }

    function resolveServer(data) {
        if (!data || typeof data !== 'object') return '—';
        const action = extractAction(data);
        if (NO_SERVER_ACTIONS.has(action)) return '—';
        if (data.serverId && SERVER_ID_MAP[data.serverId]) return SERVER_ID_MAP[data.serverId];
        if (data.serverId) return data.serverId.substring(0, 8) + '…';
        if (data.data && data.data.serverId && SERVER_ID_MAP[data.data.serverId]) return SERVER_ID_MAP[data.data.serverId];
        if (data.data && data.data.serverId) return data.data.serverId.substring(0, 8) + '…';
        if (data.data && data.data.currentEndpointId && SERVER_ID_MAP[data.data.currentEndpointId]) return SERVER_ID_MAP[data.data.currentEndpointId];
        if (data.data && data.data.currentEndpointId) return data.data.currentEndpointId.substring(0, 8) + '…';
        if (data.marketId && MARKET_ID_MAP[data.marketId]) return MARKET_ID_MAP[data.marketId];
        if (data.data && data.data.marketId && MARKET_ID_MAP[data.data.marketId]) return MARKET_ID_MAP[data.data.marketId];
        if (data.data && data.data.market && data.data.market.id && MARKET_ID_MAP[data.data.market.id]) return MARKET_ID_MAP[data.data.market.id];
        return '—';
    }

    function tryPrettyPrint(raw) {
        if (!raw) return '';
        const match = raw.match(/^42(?:\/[^,]*,)?(\[.+)$/s);
        if (match) {
            try {
                const parsed = JSON.parse(match[1]);
                const event = parsed[0];
                const data = parsed.length > 1 ? parsed.slice(1) : [];
                let result = 'Event: ' + event + '\n';
                if (data.length === 1) result += '\n' + JSON.stringify(data[0], null, 2);
                else if (data.length > 1) result += '\n' + JSON.stringify(data, null, 2);
                return result;
            } catch (e) { /* fall through */ }
        }
        if (raw.startsWith('0{')) {
            try { return 'Handshake\n\n' + JSON.stringify(JSON.parse(raw.substring(1)), null, 2); }
            catch (e) { /* fall through */ }
        }
        try { return JSON.stringify(JSON.parse(raw), null, 2); }
        catch (e) { /* fall through */ }
        return raw;
    }

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
            bracket.textContent = entries.length === 0 ? openBracket + closeBracket : openBracket;
            node.appendChild(bracket);
            const previewSpan = document.createElement('span');
            previewSpan.className = 'tree-preview';
            previewSpan.style.color = '#6c7086';
            if (entries.length > 0) previewSpan.textContent = expanded ? '' : ' ' + objectPreview(value, 120);
            node.appendChild(previewSpan);
            const children = document.createElement('div');
            children.className = 'tree-children' + (expanded ? '' : ' collapsed');
            for (const [k, v] of entries) renderTreeNode(children, v, k, false);
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
            if (typeof value === 'string') { valSpan.className = 'tree-string'; valSpan.textContent = JSON.stringify(value); }
            else if (typeof value === 'number') { valSpan.className = 'tree-number'; valSpan.textContent = String(value); }
            else if (typeof value === 'boolean') { valSpan.className = 'tree-boolean'; valSpan.textContent = String(value); }
            else { valSpan.className = 'tree-null'; valSpan.textContent = 'null'; }
            node.appendChild(valSpan);
            parent.appendChild(node);
        }
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function isLogCategory() { return currentCategory !== 'ws-messages'; }

    // --- Import / Parse ---
    function stripCodeFences(text) {
        text = text.trim();
        if (text.startsWith('```')) {
            const firstNewline = text.indexOf('\n');
            if (firstNewline !== -1) text = text.substring(firstNewline + 1);
        }
        if (text.endsWith('```')) {
            text = text.substring(0, text.lastIndexOf('```'));
        }
        return text.trim();
    }

    function detectAndParse(rawText) {
        const stripped = stripCodeFences(rawText);

        // Try JSON parse first
        try {
            const parsed = JSON.parse(stripped);
            if (parsed && typeof parsed === 'object') {
                return parseJsonExport(parsed);
            }
        } catch (e) { /* not JSON */ }

        // Try MD table
        if (stripped.includes('|') && stripped.includes('---')) {
            return parseMdExport(stripped);
        }

        return null;
    }

    function parseJsonExport(data) {
        const result = {
            wsLogs: [],
            autoJobSolverLogs: [],
            autoValuableSellerLogs: [],
            extensionErrors: [],
            pageConsoleLogs: [],
            extensionConsoleLogs: []
        };

        // Check if it's the copyAllLogs format (has named keys)
        if (data.wsLogs || data.autoJobSolverLogs || data.autoValuableSellerLogs ||
            data.extensionErrors || data.pageConsoleLogs || data.extensionConsoleLogs) {
            if (Array.isArray(data.wsLogs)) {
                result.wsLogs = data.wsLogs.map(e => ({
                    timestamp: e.timestamp,
                    direction: e.direction || 'received',
                    message: e.message || e.raw || ''
                }));
            }
            if (Array.isArray(data.autoJobSolverLogs)) {
                result.autoJobSolverLogs = data.autoJobSolverLogs.map(e => ({
                    timestamp: e.timestamp,
                    level: e.level || 'info',
                    message: e.message || e.args || '',
                    category: 'auto-jobs'
                }));
            }
            if (Array.isArray(data.autoValuableSellerLogs)) {
                result.autoValuableSellerLogs = data.autoValuableSellerLogs.map(e => ({
                    timestamp: e.timestamp,
                    level: e.level || 'info',
                    message: e.message || e.args || '',
                    category: 'auto-valuable'
                }));
            }
            if (Array.isArray(data.extensionErrors)) {
                result.extensionErrors = data.extensionErrors.map(e => ({
                    timestamp: e.timestamp || e.ts,
                    level: 'error',
                    message: (e.source ? '[' + e.source + '] ' : '') + (e.message || e.msg || ''),
                    category: 'error-logs'
                }));
            }
            if (Array.isArray(data.pageConsoleLogs)) {
                result.pageConsoleLogs = data.pageConsoleLogs.map(e => ({
                    timestamp: e.timestamp,
                    level: e.level || 'log',
                    message: e.args || e.message || '',
                    category: 'page-console'
                }));
            }
            if (Array.isArray(data.extensionConsoleLogs)) {
                result.extensionConsoleLogs = data.extensionConsoleLogs.map(e => ({
                    timestamp: e.timestamp,
                    level: e.level || 'log',
                    message: '[' + (e.source || 'unknown') + '] ' + (e.args || e.message || ''),
                    category: 'ext-console'
                }));
            }
            return result;
        }

        // Check if it's a DevTools export (flat array)
        if (Array.isArray(data)) {
            // Detect type by shape
            const sample = data[0];
            if (!sample) return result;
            if (sample.direction !== undefined && sample.raw !== undefined) {
                // WS export from DevTools
                result.wsLogs = data.map(e => ({
                    timestamp: e.timestamp,
                    direction: e.direction || 'received',
                    message: e.raw || e.message || ''
                }));
            } else if (sample.level !== undefined || sample.category !== undefined) {
                // Log export from DevTools
                const cat = sample.category || 'auto-jobs';
                const key = cat === 'auto-valuable' ? 'autoValuableSellerLogs'
                    : cat === 'error-logs' ? 'extensionErrors'
                    : cat === 'page-console' ? 'pageConsoleLogs'
                    : cat === 'ext-console' ? 'extensionConsoleLogs'
                    : 'autoJobSolverLogs';
                result[key] = data.map(e => ({
                    timestamp: e.timestamp,
                    level: e.level || 'info',
                    message: e.message || '',
                    category: cat
                }));
            }
            return result;
        }

        return result;
    }

    function parseMdExport(text) {
        const result = {
            wsLogs: [],
            autoJobSolverLogs: [],
            autoValuableSellerLogs: [],
            extensionErrors: [],
            pageConsoleLogs: [],
            extensionConsoleLogs: []
        };

        const lines = text.split('\n').filter(l => l.trim().startsWith('|'));
        if (lines.length < 3) return result;

        const headerLine = lines[0];
        const headerCells = headerLine.split('|').map(c => c.trim()).filter(c => c);
        const isWsFormat = headerCells.some(h => h === 'Dir');

        const dataLines = lines.slice(2); // skip header + separator

        if (isWsFormat) {
            for (const line of dataLines) {
                const cells = line.split('|').map(c => c.trim()).filter(c => c);
                if (cells.length < 3) continue;
                const dir = cells[0] === '▲' ? 'sent' : 'received';
                const timeStr = cells[1] || '';
                const raw = cells.length >= 7 ? (cells[5] || '').replace(/\\\|/g, '|') : '';
                result.wsLogs.push({
                    timestamp: timeStr,
                    direction: dir,
                    message: raw
                });
            }
        } else {
            // Log format: Time | Level | Message
            for (const line of dataLines) {
                const cells = line.split('|').map(c => c.trim()).filter(c => c);
                if (cells.length < 3) continue;
                result.autoJobSolverLogs.push({
                    timestamp: cells[0] || '',
                    level: (cells[1] || 'info').toLowerCase(),
                    message: (cells[2] || '').replace(/\\\|/g, '|'),
                    category: 'auto-jobs'
                });
            }
        }
        return result;
    }

    function loadImportedData() {
        const catMap = {
            'ws-messages': importedData.wsLogs,
            'auto-jobs': importedData.autoJobSolverLogs,
            'auto-valuable': importedData.autoValuableSellerLogs,
            'error-logs': importedData.extensionErrors,
            'page-console': importedData.pageConsoleLogs,
            'ext-console': importedData.extensionConsoleLogs
        };

        const catData = catMap[currentCategory] || [];
        totalCount = catData.length;
        const pages = Math.ceil(totalCount / PAGE_SIZE) || 1;

        pageSelector.innerHTML = '';
        for (let i = 0; i < pages; i++) {
            const start = i * PAGE_SIZE;
            const isLast = i === pages - 1;
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = isLast ? `${start}-${totalCount}` : `${start}-${start + PAGE_SIZE}`;
            pageSelector.appendChild(opt);
        }
        if (currentPage >= pages) currentPage = Math.max(0, pages - 1);
        pageSelector.value = String(currentPage);

        const start = currentPage * PAGE_SIZE;
        allMessages = catData.slice(start, start + PAGE_SIZE);
        applyFilters();
    }

    // --- Filtering ---
    function applyFilters() {
        const search = searchInput.value.toLowerCase().trim();
        const showSent = filterSent.checked;
        const showReceived = filterReceived.checked;

        if (isLogCategory()) {
            filteredMessages = allMessages.filter(m => {
                if (search && !(m.message || '').toLowerCase().includes(search)) return false;
                return true;
            });
        } else {
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
        }
        renderList();
        updateStats();
    }

    // --- Render ---
    function renderList() {
        if (filteredMessages.length === 0) {
            messageList.innerHTML = '';
            messageList.appendChild(emptyState);
            emptyState.style.display = '';
            return;
        }
        emptyState.style.display = 'none';
        const fragment = document.createDocumentFragment();

        if (isLogCategory()) {
            for (let i = 0; i < filteredMessages.length; i++) {
                const m = filteredMessages[i];
                const row = document.createElement('div');
                row.className = 'log-row' + (i === selectedIndex ? ' selected' : '');
                row.dataset.index = i;
                const time = document.createElement('span');
                time.className = 'msg-time';
                time.textContent = formatTime(m.timestamp);
                row.appendChild(time);
                const lvl = document.createElement('span');
                lvl.className = 'log-level ' + (m.level || 'info');
                lvl.textContent = (m.level || 'info').toUpperCase();
                row.appendChild(lvl);
                const msg = document.createElement('span');
                msg.className = 'log-message';
                msg.textContent = m.message || '';
                msg.title = m.message || '';
                row.appendChild(msg);
                row.addEventListener('click', () => selectMessage(i));
                fragment.appendChild(row);
            }
        } else {
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
        }
        messageList.replaceChildren(fragment);
    }

    function selectMessage(index) {
        selectedIndex = index;
        const m = filteredMessages[index];
        if (!m) return;
        const rows = messageList.querySelectorAll('.msg-row, .log-row');
        rows.forEach((r, i) => r.classList.toggle('selected', i === index));
        detailPanel.classList.add('open');
        if (isLogCategory()) {
            detailMeta.innerHTML = `<span>Time: ${formatTime(m.timestamp)}</span>`
                + `<span>Level: <strong class="log-level ${m.level || 'info'}">${(m.level || 'info').toUpperCase()}</strong></span>`
                + `<span>Category: <strong>${escapeHtml(m.category || currentCategory)}</strong></span>`;
            selectedRawMessage = m.message || '';
        } else {
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
        }
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
            if (tree) detailBody.appendChild(tree);
            else detailBody.textContent = selectedRawMessage;
        } else if (detailFormat === 'pretty') {
            detailBody.textContent = tryPrettyPrint(selectedRawMessage);
        } else {
            detailBody.textContent = selectedRawMessage;
        }
    }

    function closeDetail() {
        detailPanel.classList.remove('open');
        selectedIndex = -1;
        const rows = messageList.querySelectorAll('.msg-row, .log-row');
        rows.forEach(r => r.classList.remove('selected'));
    }

    function updateStats() {
        if (isLogCategory()) {
            statsLabel.textContent = `(${filteredMessages.length} entries)`;
        } else {
            const sent = filteredMessages.filter(m => m.direction === 'sent').length;
            const recv = filteredMessages.filter(m => m.direction === 'received').length;
            statsLabel.textContent = `(▲${sent} ▼${recv})`;
        }
    }

    // --- Detail Search ---
    function performDetailSearch() {
        const query = detailSearchInput.value.trim();
        detailSearchQuery = query;
        detailSearchMatches = [];
        detailSearchCurrent = -1;
        detailSearchCount.textContent = '';
        if (!query) return;
        if (detailFormat === 'tree') { performTreeSearch(query); return; }
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
        if (detailSearchMatches.length === 0) { detailSearchCount.textContent = '0 matches'; return; }
        detailSearchCurrent = 0;
        highlightDetailMatches();
    }

    function performTreeSearch(query) {
        const queryLower = query.toLowerCase();
        const nodes = detailBody.querySelectorAll('.tree-node');
        detailSearchMatches = [];
        nodes.forEach(node => {
            if (node.textContent.toLowerCase().includes(queryLower)) detailSearchMatches.push({ node });
        });
        if (detailSearchMatches.length === 0) { detailSearchCount.textContent = '0 matches'; return; }
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
            if (m.start > lastEnd) fragment.appendChild(document.createTextNode(text.substring(lastEnd, m.start)));
            const span = document.createElement('span');
            span.className = 'search-highlight' + (i === detailSearchCurrent ? ' current' : '');
            span.textContent = text.substring(m.start, m.end);
            if (i === detailSearchCurrent) span.id = 'currentSearchMatch';
            fragment.appendChild(span);
            lastEnd = m.end;
        }
        if (lastEnd < text.length) fragment.appendChild(document.createTextNode(text.substring(lastEnd)));
        detailBody.innerHTML = '';
        detailBody.appendChild(fragment);
        detailSearchCount.textContent = `${detailSearchCurrent + 1}/${detailSearchMatches.length}`;
        const current = document.getElementById('currentSearchMatch');
        if (current) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function nextDetailMatch() {
        if (detailSearchMatches.length === 0) { performDetailSearch(); return; }
        detailSearchCurrent = (detailSearchCurrent + 1) % detailSearchMatches.length;
        if (detailFormat === 'tree') highlightTreeMatch();
        else highlightDetailMatches();
    }

    // --- Auto-select first non-empty category after import ---
    function autoSelectCategory() {
        const priority = ['ws-messages', 'auto-jobs', 'auto-valuable', 'error-logs', 'page-console', 'ext-console'];
        const catMap = {
            'ws-messages': importedData.wsLogs,
            'auto-jobs': importedData.autoJobSolverLogs,
            'auto-valuable': importedData.autoValuableSellerLogs,
            'error-logs': importedData.extensionErrors,
            'page-console': importedData.pageConsoleLogs,
            'ext-console': importedData.extensionConsoleLogs
        };
        for (const cat of priority) {
            if (catMap[cat] && catMap[cat].length > 0) {
                currentCategory = cat;
                categorySelect.value = cat;
                break;
            }
        }
    }

    // --- Event listeners ---
    btnImport.addEventListener('click', () => importFileInput.click());

    importFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = detectAndParse(text);
            if (!parsed) {
                alert('Could not parse the imported file. Supported formats: JSON (Export or Copy-All-Logs), MD table, Discord clipboard format.');
                return;
            }
            importedData = parsed;
            currentPage = 0;
            autoSelectCategory();
            const logMode = isLogCategory();
            document.body.classList.toggle('log-mode', logMode);
            filterSent.parentElement.style.display = logMode ? 'none' : '';
            filterReceived.parentElement.style.display = logMode ? 'none' : '';
            loadImportedData();
        } catch (err) {
            alert('Error reading file: ' + err.message);
        }
        importFileInput.value = '';
    });

    categorySelect.addEventListener('change', () => {
        currentCategory = categorySelect.value;
        const logMode = isLogCategory();
        document.body.classList.toggle('log-mode', logMode);
        filterSent.parentElement.style.display = logMode ? 'none' : '';
        filterReceived.parentElement.style.display = logMode ? 'none' : '';
        currentPage = 0;
        selectedIndex = -1;
        closeDetail();
        loadImportedData();
    });

    pageSelector.addEventListener('change', () => {
        currentPage = parseInt(pageSelector.value) || 0;
        loadImportedData();
    });

    searchInput.addEventListener('input', applyFilters);
    filterSent.addEventListener('change', applyFilters);
    filterReceived.addEventListener('change', applyFilters);

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
    detailSearchInput.addEventListener('input', () => performDetailSearch());
    detailSearchBtn.addEventListener('click', () => performDetailSearch());

    // --- Column resize ---
    const COL_VAR_MAP = { time: '--col-time', event: '--col-event', action: '--col-action', server: '--col-server' };
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

    // --- Detail panel resize ---
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

    // --- Keyboard navigation ---
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.key === 'Escape') { closeDetail(); return; }
        if (filteredMessages.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.min(selectedIndex + 1, filteredMessages.length - 1);
            selectMessage(next);
            const rows = messageList.querySelectorAll('.msg-row, .log-row');
            if (rows[next]) rows[next].scrollIntoView({ block: 'nearest' });
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = Math.max(selectedIndex - 1, 0);
            selectMessage(prev);
            const rows = messageList.querySelectorAll('.msg-row, .log-row');
            if (rows[prev]) rows[prev].scrollIntoView({ block: 'nearest' });
        }
    });

    // --- Init: show empty page selector ---
    pageSelector.innerHTML = '<option value="0">0-0</option>';
})();
