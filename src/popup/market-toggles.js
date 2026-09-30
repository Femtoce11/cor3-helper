// Collapsible market panels (fold arrows like the loadout sub-blocks).
import { refreshMarket1Only, refreshMarket2Only, refreshMarket3Only, refreshMarket4Only } from './markets.js';

function wireMarketToggle(toggleId, bodyId, containerId, onExpand) {
    const toggle = document.getElementById(toggleId);
    const body = document.getElementById(bodyId);
    const container = document.getElementById(containerId);
    if (!toggle || !body) return;
    toggle.addEventListener('click', () => {
        const wasOpen = body.classList.contains('open');
        toggle.classList.toggle('open');
        body.classList.toggle('open');
        // If expanding an empty panel, fetch its data
        if (!wasOpen && container && container.innerText.indexOf('No market data cached') !== -1) {
            onExpand();
        }
    });
}

wireMarketToggle('coreMarketToggle', 'coreMarketBody', 'marketContainer', () => refreshMarket1Only());
wireMarketToggle('darkMarketToggle', 'darkMarketBody', 'darkMarketContainer', () => refreshMarket2Only());
wireMarketToggle('soyuzMarketToggle', 'soyuzMarketBody', 'soyuzMarketContainer', () => refreshMarket3Only());
wireMarketToggle('usolMarketToggle', 'usolMarketBody', 'usolMarketContainer', () => refreshMarket4Only());
