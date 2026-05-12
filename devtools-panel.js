// devtools-panel.js — CORE Helper DevTools panel logic

(function () {
    'use strict';

    // --- Server/Market ID → Name lookup ---
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

    // Actions that are map/network requests (no meaningful server to show)
    const NO_SERVER_ACTIONS = new Set(['get.map', 'network-map']);

    // --- State ---
    let allMessages = [];
    let filteredMessages = [];
    let selectedIndex = -1;
    let liveMode = false;
    let liveTimer = null;
    let lastLiveTimestamp = null; // ISO string of last message seen in live mode
    let displayCleared = false; // true when user clicked Clear (display only, storage still has data)
    let detailFormat = 'pretty'; // 'raw' | 'pretty' | 'tree'
    let selectedRawMessage = ''; // raw message for the currently selected detail

    // Detail search state
    let detailSearchMatches = [];
    let detailSearchCurrent = -1;

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
    const btnRefresh = document.getElementById('btnRefresh');
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

    // --- Tree View Renderer ---
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
            bracket.textContent = openBracket + (entries.length === 0 ? closeBracket : ` (${entries.length})`);
            node.appendChild(bracket);

            const children = document.createElement('div');
            children.className = 'tree-children' + (expanded ? '' : ' collapsed');

            for (const [k, v] of entries) {
                renderTreeNode(children, v, k, false);
            }

            // Closing bracket
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
            });
        } else {
            // Leaf node
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

    // --- Detail Search ---
    function performDetailSearch() {
        const query = detailSearchInput.value.trim();
        detailSearchMatches = [];
        detailSearchCurrent = -1;
        detailSearchCount.textContent = '';

        if (!query || detailFormat === 'tree') {
            // For tree view, use browser-native text search; we don't highlight manually
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

        // Scroll to current match
        const current = document.getElementById('currentSearchMatch');
        if (current) current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function nextDetailMatch() {
        if (detailSearchMatches.length === 0) {
            performDetailSearch();
            return;
        }
        detailSearchCurrent = (detailSearchCurrent + 1) % detailSearchMatches.length;
        highlightDetailMatches();
    }

    // --- Pull messages from extension storage ---
    async function pullMessages() {
        try {
            const data = await chrome.storage.local.get('cor3_ws_messages');
            const msgs = data.cor3_ws_messages || [];
            allMessages = msgs;
            displayCleared = false; // Pull History restores full view
            applyFilters();
        } catch (e) {
            console.error('[CORE Helper] Failed to pull WS messages:', e);
        }
    }

    // Pull only new messages since lastLiveTimestamp (for efficient live mode)
    async function pullNewMessages() {
        try {
            const data = await chrome.storage.local.get('cor3_ws_messages');
            const msgs = data.cor3_ws_messages || [];

            if (!lastLiveTimestamp || allMessages.length === 0) {
                // First pull in live mode — load everything
                allMessages = msgs;
                if (msgs.length > 0) {
                    lastLiveTimestamp = msgs[msgs.length - 1].timestamp;
                }
            } else {
                // Only add messages newer than our last seen timestamp
                const newMsgs = msgs.filter(m => m.timestamp > lastLiveTimestamp);
                if (newMsgs.length > 0) {
                    allMessages = allMessages.concat(newMsgs);
                    lastLiveTimestamp = newMsgs[newMsgs.length - 1].timestamp;
                } else {
                    return; // No new messages — skip re-render
                }
            }
            applyFilters();
        } catch (e) {
            console.error('[CORE Helper] Failed to pull new WS messages:', e);
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

            // Direction arrow
            const dir = document.createElement('span');
            dir.className = 'msg-dir ' + m.direction;
            dir.textContent = m.direction === 'sent' ? '▲' : '▼';
            dir.title = m.direction;
            row.appendChild(dir);

            // Time
            const time = document.createElement('span');
            time.className = 'msg-time';
            time.textContent = formatTime(m.timestamp);
            row.appendChild(time);

            // Event
            const evt = document.createElement('span');
            evt.className = 'msg-event';
            evt.textContent = parsed.event;
            evt.title = parsed.event;
            row.appendChild(evt);

            // Action
            const act = document.createElement('span');
            act.className = 'msg-action';
            act.textContent = action;
            act.title = action;
            row.appendChild(act);

            // Server
            const srv = document.createElement('span');
            srv.className = 'msg-server';
            srv.textContent = server;
            srv.title = server;
            row.appendChild(srv);

            // Preview — show a compact JSON-ish summary, not raw frame
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

            // Size
            const size = document.createElement('span');
            size.className = 'msg-size';
            size.textContent = formatSize(m.message);
            row.appendChild(size);

            row.addEventListener('click', () => selectMessage(i));
            fragment.appendChild(row);
        }

        messageList.replaceChildren(fragment);

        // Auto-scroll to bottom if live mode
        if (liveMode) {
            messageList.scrollTop = messageList.scrollHeight;
        }
    }

    // --- Select a message to show detail ---
    function selectMessage(index) {
        selectedIndex = index;
        const m = filteredMessages[index];
        if (!m) return;

        // Highlight selected row
        const rows = messageList.querySelectorAll('.msg-row');
        rows.forEach((r, i) => r.classList.toggle('selected', i === index));

        // Show detail panel
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

        // Clear search state
        detailSearchInput.value = '';
        detailSearchMatches = [];
        detailSearchCurrent = -1;
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
        const total = allMessages.length;
        const shown = filteredMessages.length;
        const sent = allMessages.filter(m => m.direction === 'sent').length;
        const recv = allMessages.filter(m => m.direction === 'received').length;
        statsLabel.textContent = `${shown}/${total} shown (▲${sent} ▼${recv})`;
    }

    // --- Live mode (timestamp-based incremental pull) ---
    function toggleLive() {
        liveMode = !liveMode;
        btnLive.classList.toggle('active', liveMode);
        btnLive.textContent = liveMode ? '● Live ON' : '● Live';

        if (liveMode) {
            // Set initial timestamp from existing messages
            if (allMessages.length > 0) {
                lastLiveTimestamp = allMessages[allMessages.length - 1].timestamp;
            } else {
                lastLiveTimestamp = null;
            }
            pullNewMessages();
            liveTimer = setInterval(pullNewMessages, 1500);
        } else {
            if (liveTimer) clearInterval(liveTimer);
            liveTimer = null;
        }
    }

    // --- Export ---
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
                raw: m.message,
                data: msgData
            };
        });
        downloadFile('cor3-ws-export.json', JSON.stringify(data, null, 2), 'application/json');
    }

    function exportAsMd() {
        let md = '| Dir | Time | Event | Action | Server | Size |\n';
        md += '|-----|------|-------|--------|--------|------|\n';
        for (const m of filteredMessages) {
            const parsed = parseEvent(m.message);
            const msgData = parseMsgData(m.message);
            const action = msgData ? extractAction(msgData) : '—';
            const server = msgData ? resolveServer(msgData) : '—';
            const dir = m.direction === 'sent' ? '▲' : '▼';
            md += `| ${dir} | ${formatTime(m.timestamp)} | ${parsed.event} | ${action} | ${server} | ${formatSize(m.message)} |\n`;
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

    // --- Send WS message ---
    async function sendWsMessage() {
        const msg = sendInput.value.trim();
        if (!msg) return;

        try {
            // Find the cor3.gg tab
            const tabs = await chrome.tabs.query({ url: ['https://cor3.gg/*', 'https://os.cor3.gg/*'] });
            if (tabs.length === 0) {
                alert('No cor3.gg tab found. Please open cor3.gg first.');
                return;
            }
            const tab = tabs[0];
            await chrome.tabs.sendMessage(tab.id, {
                action: 'devtoolsSendWs',
                message: msg
            });
            sendInput.value = '';
            // Pull immediately to see the sent message
            setTimeout(pullMessages, 500);
        } catch (e) {
            console.error('[CORE Helper] Failed to send WS message:', e);
            alert('Failed to send: ' + e.message);
        }
    }

    // --- Clear display (does NOT delete from storage — Pull History can restore) ---
    function clearMessages() {
        allMessages = [];
        filteredMessages = [];
        selectedIndex = -1;
        displayCleared = true;
        lastLiveTimestamp = new Date().toISOString(); // Reset live baseline to now
        closeDetail();
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

    // Attach resize handlers to all .col-resize elements
    listHeader.querySelectorAll('.col-resize').forEach(handle => {
        handle.addEventListener('mousedown', onResizeStart);
    });

    // --- Event Listeners ---
    btnRefresh.addEventListener('click', pullMessages);
    btnLive.addEventListener('click', toggleLive);
    btnClear.addEventListener('click', clearMessages);
    detailClose.addEventListener('click', closeDetail);

    // Detail format dropdown
    detailFormatSelect.addEventListener('change', () => {
        detailFormat = detailFormatSelect.value;
        if (selectedRawMessage) {
            renderDetailBody();
            // Re-apply search if active
            if (detailSearchInput.value.trim()) performDetailSearch();
        }
    });

    // Detail search
    detailSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); nextDetailMatch(); }
    });
    detailSearchBtn.addEventListener('click', nextDetailMatch);

    // Export dropdown
    btnExport.addEventListener('click', (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle('open');
    });
    btnExportJson.addEventListener('click', () => { exportMenu.classList.remove('open'); exportAsJson(); });
    btnExportMd.addEventListener('click', () => { exportMenu.classList.remove('open'); exportAsMd(); });
    document.addEventListener('click', () => exportMenu.classList.remove('open'));

    // Detail panel resize (drag left edge)
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

    // Keyboard navigation
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

    // Listen for storage changes for live updates
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.cor3_ws_messages && liveMode && !displayCleared) {
            // Use incremental approach: only add genuinely new messages
            const newAll = changes.cor3_ws_messages.newValue || [];
            if (lastLiveTimestamp) {
                const fresh = newAll.filter(m => m.timestamp > lastLiveTimestamp);
                if (fresh.length > 0) {
                    allMessages = allMessages.concat(fresh);
                    lastLiveTimestamp = fresh[fresh.length - 1].timestamp;
                    applyFilters();
                }
            } else {
                allMessages = newAll;
                if (newAll.length > 0) lastLiveTimestamp = newAll[newAll.length - 1].timestamp;
                applyFilters();
            }
        }
    });

    // Initial pull
    pullMessages();
})();
