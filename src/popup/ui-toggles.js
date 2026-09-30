import { _h, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab } from './utils.js';

const autoDecryptToggle = document.getElementById('autoDecryptToggle');
const decryptStatus = document.getElementById('decryptStatus');
const autoIceWallToggle = document.getElementById('autoIceWallToggle');
const iceWallStatus = document.getElementById('iceWallStatus');
const iceWallSolverStatusLine = document.getElementById('iceWallSolverStatusLine');
const autoSimpleDecryptToggle = document.getElementById('autoSimpleDecryptToggle');
const simpleDecryptStatus = document.getElementById('simpleDecryptStatus');
const simpleDecryptSolverStatusLine = document.getElementById('simpleDecryptSolverStatusLine');
const autoDailyHackToggle = document.getElementById('autoDailyHackToggle');
const dailyHackStatus = document.getElementById('dailyHackStatus');
const dailyHackLogEl = document.getElementById('dailyHackLog');
const disableBackgroundToggle = document.getElementById('disableBackgroundToggle');
const backgroundStatus = document.getElementById('backgroundStatus');
const disableNetworkFogToggle = document.getElementById('disableNetworkFogToggle');
const networkFogStatus = document.getElementById('networkFogStatus');
const moveNotificationsToggle = document.getElementById('moveNotificationsToggle');
const moveNotificationsStatus = document.getElementById('moveNotificationsStatus');
const autoUpdateMarketsToggle = document.getElementById('autoUpdateMarketsToggle');
const autoUpdateMarketsStatus = document.getElementById('autoUpdateMarketsStatus');
const secretFinderToggle = document.getElementById('secretFinderToggle');
const secretFinderStatus = document.getElementById('secretFinderStatus');
const secretFinderLogEl = document.getElementById('secretFinderLog');
const togglesBody = document.getElementById('togglesBody');
const togglesShowMoreBtn = document.getElementById('togglesShowMoreBtn');

function statusLabel(el, enabled) {
    if (!el) return;
    el.textContent = enabled ? 'Active' : 'Off';
    el.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
}

function renderSolverStatus(el, statusObj) {
    if (!el) return;
    if (!statusObj || !statusObj.message || Date.now() - statusObj.timestamp > 5 * 60 * 1000) {
        el.style.display = 'none';
        return;
    }
    const colorMap = { success: 'var(--accent-green)', error: 'var(--accent-red, #ff5555)', warn: 'var(--accent-orange)', info: 'var(--accent-cyan)' };
    el.textContent = statusObj.message;
    el.style.color = colorMap[statusObj.level] || 'var(--text-dim)';
    el.style.display = '';
}

function updateDecryptStatusLabel(enabled) { statusLabel(decryptStatus, enabled); }
function updateIceWallStatusLabel(enabled) { statusLabel(iceWallStatus, enabled); }
function updateSimpleDecryptStatusLabel(enabled) { statusLabel(simpleDecryptStatus, enabled); }
function updateDailyHackStatusLabel(enabled) { statusLabel(dailyHackStatus, enabled); }
function updateBackgroundStatus() { if (disableBackgroundToggle) statusLabel(backgroundStatus, disableBackgroundToggle.checked); }
function updateNetworkFogStatus() { if (disableNetworkFogToggle) statusLabel(networkFogStatus, disableNetworkFogToggle.checked); }
function updateMoveNotificationsStatus() { if (moveNotificationsToggle) statusLabel(moveNotificationsStatus, moveNotificationsToggle.checked); }
export function updateAutoUpdateMarketsStatus() { if (autoUpdateMarketsToggle) statusLabel(autoUpdateMarketsStatus, autoUpdateMarketsToggle.checked); }
function updateSecretFinderStatusLabel(enabled) { statusLabel(secretFinderStatus, enabled); }

function initAutoDecrypt() {
    chrome.storage.sync.get('autoDecryptEnabled', (data) => {
        autoDecryptToggle.checked = !!data.autoDecryptEnabled;
        updateDecryptStatusLabel(autoDecryptToggle.checked);
    });
    autoDecryptToggle.addEventListener('change', async () => {
        const enabled = autoDecryptToggle.checked;
        await chrome.storage.sync.set({ autoDecryptEnabled: enabled });
        updateDecryptStatusLabel(enabled);
        const tab = await getCor3Tab();
        if (tab) chrome.tabs.sendMessage(tab.id, { action: "toggleDecryptSolver", enabled }).catch(() => {});
    });
}

function initAutoIceWall() {
    chrome.storage.sync.get('autoIceWallEnabled', (data) => {
        autoIceWallToggle.checked = !!data.autoIceWallEnabled;
        updateIceWallStatusLabel(autoIceWallToggle.checked);
    });
    autoIceWallToggle.addEventListener('change', async () => {
        const enabled = autoIceWallToggle.checked;
        await chrome.storage.sync.set({ autoIceWallEnabled: enabled });
        updateIceWallStatusLabel(enabled);
        const tab = await getCor3Tab();
        if (tab) chrome.tabs.sendMessage(tab.id, { action: "toggleIceWallSolver", enabled }).catch(() => {});
    });
    chrome.storage.local.get('iceWallSolverStatus', (data) => {
        renderSolverStatus(iceWallSolverStatusLine, data.iceWallSolverStatus);
    });
}

function initAutoSimpleDecrypt() {
    chrome.storage.sync.get('autoSimpleDecryptEnabled', (data) => {
        autoSimpleDecryptToggle.checked = !!data.autoSimpleDecryptEnabled;
        updateSimpleDecryptStatusLabel(autoSimpleDecryptToggle.checked);
    });
    autoSimpleDecryptToggle.addEventListener('change', async () => {
        const enabled = autoSimpleDecryptToggle.checked;
        await chrome.storage.sync.set({ autoSimpleDecryptEnabled: enabled });
        updateSimpleDecryptStatusLabel(enabled);
        const tab = await getCor3Tab();
        if (tab) chrome.tabs.sendMessage(tab.id, { action: "toggleSimpleDecryptSolver", enabled }).catch(() => {});
    });
    chrome.storage.local.get('simpleDecryptSolverStatus', (data) => {
        renderSolverStatus(simpleDecryptSolverStatusLine, data.simpleDecryptSolverStatus);
    });
}


function initAutoDailyHack() {
    chrome.storage.sync.get('autoDailyHackEnabled', (data) => {
        autoDailyHackToggle.checked = !!data.autoDailyHackEnabled;
        updateDailyHackStatusLabel(autoDailyHackToggle.checked);
    });
    chrome.storage.local.get(['dailyHackLog', 'dailyHackLogUpdatedAt'], (data) => {
        if (data.dailyHackLog && dailyHackLogEl && autoDailyHackToggle.checked) {
            dailyHackLogEl.textContent = data.dailyHackLog;
            dailyHackLogEl.style.display = '';
        }
    });
    autoDailyHackToggle.addEventListener('change', async () => {
        const enabled = autoDailyHackToggle.checked;
        await chrome.storage.sync.set({ autoDailyHackEnabled: enabled });
        updateDailyHackStatusLabel(enabled);

        if (enabled && dailyHackLogEl) {
            dailyHackLogEl.textContent = 'Starting daily hack solver...';
            dailyHackLogEl.style.display = '';
        }

        const tab = await getCor3Tab();
        if (tab) chrome.tabs.sendMessage(tab.id, { action: "toggleDailyHackSolver", enabled }).catch(() => {});
    });
}

function initBackgroundToggle() {
    if (!disableBackgroundToggle) return;
    disableBackgroundToggle.addEventListener('change', async () => {
        const isEnabled = disableBackgroundToggle.checked;
        chrome.storage.sync.set({ disableBackground: isEnabled });
        updateBackgroundStatus();
        try {
            const tab = await getCor3Tab();
            if (tab) await chrome.tabs.sendMessage(tab.id, { action: isEnabled ? "disableBackground" : "enableBackground" });
        } catch (e) {
            cor3LogError('popup.js', e, { action: 'toggleBackground' });
        }
    });
}

function initNetworkFogToggle() {
    if (!disableNetworkFogToggle) return;
    disableNetworkFogToggle.addEventListener('change', async () => {
        const isEnabled = disableNetworkFogToggle.checked;
        chrome.storage.sync.set({ disableNetworkFog: isEnabled });
        updateNetworkFogStatus();
        try {
            const tab = await getCor3Tab();
            if (tab) await chrome.tabs.sendMessage(tab.id, { action: isEnabled ? "disableNetworkFog" : "enableNetworkFog" });
        } catch (e) {
            cor3LogError('popup.js', e, { action: 'toggleNetworkFog' });
        }
    });
}

function initMoveNotificationsToggle() {
    if (!moveNotificationsToggle) return;
    moveNotificationsToggle.addEventListener('change', async () => {
        const isEnabled = moveNotificationsToggle.checked;
        chrome.storage.sync.set({ moveNotificationsLeft: isEnabled });
        updateMoveNotificationsStatus();
        try {
            const tab = await getCor3Tab();
            if (tab) await chrome.tabs.sendMessage(tab.id, { action: isEnabled ? "moveNotificationsLeft" : "moveNotificationsRight" });
        } catch (e) {
            cor3LogError('popup.js', e, { action: 'toggleNotificationPosition' });
        }
    });
}


function initAutoUpdateMarketsToggle() {
    if (!autoUpdateMarketsToggle) return;
    autoUpdateMarketsToggle.addEventListener('change', () => {
        const isEnabled = autoUpdateMarketsToggle.checked;
        chrome.storage.sync.set({ autoUpdateMarkets: isEnabled });
        updateAutoUpdateMarketsStatus();
    });
}

function initSecretFinder() {
    chrome.storage.sync.get('secretFinderEnabled', (data) => {
        secretFinderToggle.checked = !!data.secretFinderEnabled;
        updateSecretFinderStatusLabel(secretFinderToggle.checked);
    });
    chrome.storage.local.get('secretFinderLog', (data) => {
        if (data.secretFinderLog && secretFinderLogEl && secretFinderToggle.checked) {
            _safeSetHtml(secretFinderLogEl, data.secretFinderLog);
            secretFinderLogEl.style.display = '';
        }
    });
    secretFinderToggle.addEventListener('change', async () => {
        const enabled = secretFinderToggle.checked;
        await chrome.storage.sync.set({ secretFinderEnabled: enabled });
        updateSecretFinderStatusLabel(enabled);
        if (enabled) {
            if (secretFinderLogEl) {
                secretFinderLogEl.replaceChildren(_h('span', {style: 'color:var(--accent-cyan);'}, 'Starting search...'));
                secretFinderLogEl.style.display = '';
            }
            try {
                const tab = await getCor3Tab();
                if (tab) {
                    await chrome.tabs.sendMessage(tab.id, { action: "startIpSearch" });
                } else {
                    if (secretFinderLogEl) secretFinderLogEl.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, 'No cor3.gg tab found'));
                    secretFinderToggle.checked = false;
                    await chrome.storage.sync.set({ secretFinderEnabled: false });
                    updateSecretFinderStatusLabel(false);
                }
            } catch (e) {
                if (secretFinderLogEl) secretFinderLogEl.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, 'Error: ' + e.message));
                secretFinderToggle.checked = false;
                await chrome.storage.sync.set({ secretFinderEnabled: false });
                updateSecretFinderStatusLabel(false);
            }
        }
    });
}

function initTogglesShowMore() {
    if (togglesShowMoreBtn && togglesBody) {
        const update = () => {
            togglesShowMoreBtn.textContent = togglesBody.style.display === 'none' ? 'Show toggles ▾' : 'Hide toggles ▴';
        };
        togglesShowMoreBtn.addEventListener('click', () => {
            togglesBody.style.display = togglesBody.style.display === 'none' ? '' : 'none';
            update();
        });
        update();
    }
}

function initSettingsLoad() {
    chrome.storage.sync.get(['disableBackground', 'disableNetworkFog', 'moveNotificationsLeft', 'autoUpdateMarkets'], (result) => {
        if (disableBackgroundToggle) { disableBackgroundToggle.checked = result.disableBackground || false; updateBackgroundStatus(); }
        if (disableNetworkFogToggle) { disableNetworkFogToggle.checked = result.disableNetworkFog || false; updateNetworkFogStatus(); }
        if (moveNotificationsToggle) { moveNotificationsToggle.checked = result.moveNotificationsLeft || false; updateMoveNotificationsStatus(); }
        if (autoUpdateMarketsToggle) { autoUpdateMarketsToggle.checked = result.autoUpdateMarkets || false; updateAutoUpdateMarketsStatus(); }
    });
}

function initToggleStorageListeners() {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.dailyHackLog) {
            const msg = changes.dailyHackLog.newValue;
            if (msg && dailyHackLogEl) { dailyHackLogEl.textContent = msg; dailyHackLogEl.style.display = ''; }
        }
        if (area === 'sync' && changes.autoDailyHackEnabled) {
            autoDailyHackToggle.checked = !!changes.autoDailyHackEnabled.newValue;
            updateDailyHackStatusLabel(autoDailyHackToggle.checked);
        }
        if (area === 'sync' && changes.autoIceWallEnabled) {
            autoIceWallToggle.checked = !!changes.autoIceWallEnabled.newValue;
            updateIceWallStatusLabel(autoIceWallToggle.checked);
        }
        if (area === 'local' && changes.iceWallSolverStatus) {
            renderSolverStatus(iceWallSolverStatusLine, changes.iceWallSolverStatus.newValue);
        }
        if (area === 'sync' && changes.autoSimpleDecryptEnabled) {
            autoSimpleDecryptToggle.checked = !!changes.autoSimpleDecryptEnabled.newValue;
            updateSimpleDecryptStatusLabel(autoSimpleDecryptToggle.checked);
        }
        if (area === 'local' && changes.simpleDecryptSolverStatus) {
            renderSolverStatus(simpleDecryptSolverStatusLine, changes.simpleDecryptSolverStatus.newValue);
        }
        if (area === 'local' && changes.secretFinderLog) {
            const msg = changes.secretFinderLog.newValue;
            if (msg && secretFinderLogEl) { _safeSetHtml(secretFinderLogEl, msg); secretFinderLogEl.style.display = ''; }
        }
        if (area === 'sync' && changes.secretFinderEnabled) {
            secretFinderToggle.checked = !!changes.secretFinderEnabled.newValue;
            updateSecretFinderStatusLabel(secretFinderToggle.checked);
        }
    });
}

initAutoDecrypt();
initAutoIceWall();
initAutoSimpleDecrypt();
initAutoDailyHack();
initSettingsLoad();
initBackgroundToggle();
initNetworkFogToggle();
initMoveNotificationsToggle();
initAutoUpdateMarketsToggle();
initSecretFinder();
initTogglesShowMore();
initToggleStorageListeners();
