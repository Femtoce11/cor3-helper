// Info Panel visibility toggles (Daily Ops / Markets) — information panels, not automation.
const dailyOpsPanelToggle = document.getElementById('dailyOpsPanelToggle');
const dailyOpsPanelStatus = document.getElementById('dailyOpsPanelStatus');
const dailyOpsPanelSection = document.getElementById('dailyOpsPanelSection');
const marketsPanelToggle = document.getElementById('marketsPanelToggle');
const marketsPanelStatus = document.getElementById('marketsPanelStatus');
const marketsPanelSection = document.getElementById('marketsPanelSection');

function applyPanelVisibility(toggleEl, statusEl, section, key) {
    const enabled = toggleEl.checked;
    if (statusEl) {
        statusEl.textContent = enabled ? 'On' : 'Off';
        statusEl.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
    }
    if (section) {
        section.style.display = enabled ? '' : 'none';
        const card = section.closest('.popout-card');
        if (card) card.style.display = enabled ? '' : 'none';
    }
    chrome.storage.sync.set({ [key]: enabled });
}

chrome.storage.sync.get(['dailyOpsPanelEnabled', 'marketsPanelEnabled'], (data) => {
    if (dailyOpsPanelToggle) dailyOpsPanelToggle.checked = data.dailyOpsPanelEnabled !== false;
    if (marketsPanelToggle) marketsPanelToggle.checked = data.marketsPanelEnabled !== false;
    if (dailyOpsPanelToggle && dailyOpsPanelStatus && dailyOpsPanelSection) {
        applyPanelVisibility(dailyOpsPanelToggle, dailyOpsPanelStatus, dailyOpsPanelSection, 'dailyOpsPanelEnabled');
    }
    if (marketsPanelToggle && marketsPanelStatus && marketsPanelSection) {
        applyPanelVisibility(marketsPanelToggle, marketsPanelStatus, marketsPanelSection, 'marketsPanelEnabled');
    }
});

if (dailyOpsPanelToggle && dailyOpsPanelStatus && dailyOpsPanelSection) {
    dailyOpsPanelToggle.addEventListener('change', () =>
        applyPanelVisibility(dailyOpsPanelToggle, dailyOpsPanelStatus, dailyOpsPanelSection, 'dailyOpsPanelEnabled'));
}
if (marketsPanelToggle && marketsPanelStatus && marketsPanelSection) {
    marketsPanelToggle.addEventListener('change', () =>
        applyPanelVisibility(marketsPanelToggle, marketsPanelStatus, marketsPanelSection, 'marketsPanelEnabled'));
}
