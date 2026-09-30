// --- Pop Out / Side Panel ---
import { getCor3Tab } from './utils.js';

const statusDiv = document.getElementById('status');
const popOutBtn = document.getElementById('popOutBtn');
const sidePanelBtn = document.getElementById('sidePanelBtn');

// Detect if we're running inside a popout window (via ?mode=popout query param)
(function detectMode() {
    const params = new URLSearchParams(window.location.search);
    const isPopout = params.get('mode') === 'popout';
    const isSidePanel = params.get('mode') === 'sidepanel';
    if (!isPopout && !isSidePanel) return;
    document.body.classList.add(isPopout ? 'mode-popout' : 'mode-sidepanel');

    // --- Build popout multi-column grid dynamically ---
    const mainView = document.getElementById('mainView');
    if (!mainView) return;

    function makeCard(elements) {
        const card = document.createElement('div');
        card.className = 'popout-card';
        for (const el of elements) card.appendChild(el);
        return card;
    }

    const grid = document.createElement('div');
    grid.id = 'popoutGrid';

    const headerRow = mainView.querySelector('.header-row');
    const insertRef = headerRow ? headerRow.nextSibling : mainView.firstChild;
    const wrappedEls = new Set();

    function addCard(elements) {
        if (!elements || elements.length === 0) return;
        const filtered = elements.filter(Boolean);
        if (filtered.length === 0) return;
        const card = makeCard(filtered);
        grid.appendChild(card);
        for (const el of filtered) wrappedEls.add(el);
    }

    const helperDiv = mainView.querySelector('#helperModeToggle')?.closest('div[style*="justify-content"]');
    const pinned = document.getElementById('pinnedTimersSection');
    addCard([helperDiv, pinned].filter(Boolean));

    addCard([mainView.querySelector('.toggles-section')].filter(Boolean));

    addCard([document.getElementById('autoJobSolverSection')].filter(Boolean));

    addCard([document.getElementById('autoValuableSellerSection')].filter(Boolean));

    const allSections = mainView.querySelectorAll(':scope > .section');

    for (const s of allSections) {
        if (s.textContent.includes('Daily Ops') && !s.querySelector('#marketContainer')) {
            addCard([s]);
            break;
        }
    }

    let marketsSection = null;
    for (const s of allSections) {
        if (s.style.display === 'none') continue; // hidden by Info Panel toggle
        if (s.querySelector('#marketContainer')) { marketsSection = s; break; }
    }
    if (marketsSection) {
        // Keep all four markets grouped under one "Markets" card (each market is collapsible)
        wrappedEls.add(marketsSection);
        addCard([marketsSection]);
    }

    let expeditionsSection = null;
    for (const s of allSections) {
        if (s.querySelector('#expeditionInfoContainer') || s.querySelector('#activeExpeditionSection')) {
            expeditionsSection = s;
            break;
        }
    }
    if (expeditionsSection) {
        // Keep Expeditions (title + mode tabs + A/B layer panels) as ONE card
        wrappedEls.add(expeditionsSection);
        addCard([expeditionsSection]);
    }

    let inventorySection = null;
    for (const s of allSections) {
        if (s.id === 'inventoryPanelSection') { inventorySection = s; break; }
    }
    if (inventorySection) {
        wrappedEls.add(inventorySection);
        addCard([inventorySection]);
    }

    let loadoutSection = null;
    for (const s of allSections) {
        if (s.querySelector('#refreshLoadoutBtn') || s.querySelector('#loadoutHwContainer')) {
            loadoutSection = s;
            break;
        }
    }
    if (loadoutSection) {
        // Keep Loadout with its three sub-blocks (Hardwares / Softwares / System Overview) as ONE card
        wrappedEls.add(loadoutSection);
        addCard([loadoutSection]);
    }

    for (const s of allSections) {
        if (wrappedEls.has(s)) continue;
        if (s.querySelector('.alarm-section-title') || s.querySelector('#alarmList')) {
            addCard([s]);
        }
    }

    const versionEls = [];
    const vi = document.getElementById('versionInfoSection');
    if (vi) { const p = vi.closest('div[style*="border-top"]'); if (p) versionEls.push(p); }
    const cb = document.getElementById('checkUpdateBtn');
    if (cb) { const p = cb.closest('div[style*="text-align:center"]'); if (p) versionEls.push(p); }
    const st = document.getElementById('status');
    if (st) versionEls.push(st);
    addCard(versionEls);

    // Markets, Expeditions, Inventory and Loadout were moved whole into cards above.

    const remaining = Array.from(mainView.children).filter(
        el => !wrappedEls.has(el) && el !== headerRow && !el.classList.contains('theme-dropdown') && el !== grid
    );
    for (const el of remaining) {
        if (el.nodeType !== 1) continue;
        if (el.id === 'popoutGrid') continue;
        const card = document.createElement('div');
        card.className = 'popout-card';
        card.appendChild(el);
        grid.appendChild(card);
    }

    mainView.insertBefore(grid, insertRef);
})();

if (popOutBtn) {
    popOutBtn.addEventListener('click', () => {
        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html?mode=popout'),
            type: 'popup',
            width: 360,
            height: 700
        });
        window.close();
    });
}

if (sidePanelBtn) {
    sidePanelBtn.addEventListener('click', async () => {
        try {
            const tab = await getCor3Tab();
            if (!tab) { statusDiv.textContent = 'No cor3.gg tab found.'; return; }
            await chrome.sidePanel.open({ tabId: tab.id });
            window.close();
        } catch (e) {
            statusDiv.textContent = 'Side panel not supported in this browser.';
        }
    });
}
